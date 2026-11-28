import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Calendrier par section (R4) + responsable désigné de la section (R6) :
// dans une section qui a un responsable désigné, seuls ce responsable et les comptes
// « toute l'école » enregistrent le calendrier de cette section.
let environment: RulesTestEnvironment;
const database = (uid: string) => environment.authenticatedContext(uid, { role: "study_director", schoolId: "school-a" }).firestore();
const day = (value: string) => Timestamp.fromDate(new Date(`${value}T00:00:00Z`));
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, schoolId: "school-a", schoolYearId: "year-a", title: "Congé", kind: "holiday", startsAt: day("2026-10-14"), endsAt: day("2026-10-14"), origin: "local", ...extra,
});
const baseMetadata = { schoolId: "school-a", schoolYearId: "year-a", status: "validated", updatedAt: "v1", updatedBy: "seed" };
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

function save(uid: string, metadata: Record<string, unknown>, events: Record<string, unknown>[] = [], deletes: string[] = []) {
  const db = database(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, "schoolCalendars/year-a"), { ...metadata, updatedBy: uid });
  for (const item of events) batch.set(doc(db, "schoolCalendars/year-a/events", String(item.id)), item);
  for (const id of deletes) batch.delete(doc(db, "schoolCalendars/year-a/events", id));
  return batch.commit();
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-school-calendar-manager", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 60000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed("schools/school-a", { status: "active", educationLevels: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
  await seed("schoolYears/year-a", { schoolId: "school-a", status: "active" });
  const director = { schoolId: "school-a", role: "study_director", status: "active", active: true };
  await seed("users/all", director);
  await seed("users/everything", { ...director, sectionIds: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
  await seed("users/prefect", { ...director, studyFunction: "prefect_of_studies", sectionIds: ["Secondaire"] });
  await seed("users/director", { ...director, sectionIds: ["Secondaire"] });
  await seed("users/both", { ...director, sectionIds: ["CTEB", "Secondaire"] });
  await seed("users/invalid", { ...director, sectionIds: ["Lycée"] });
  await seed("users/invalidLegacy", { ...director, section: "Lycée" });
  await seed("schoolCalendars/year-a", baseMetadata);
  await seed("schoolCalendars/year-a/events/ecole", event("ecole"));
  await seed("schoolCalendars/year-a/events/secondaire", event("secondaire", { sectionIds: ["Secondaire"] }));
  await seed("schoolCalendars/year-a/events/cteb", event("cteb", { sectionIds: ["CTEB"] }));
  await seed("sectionSettingsManagers/school-a", { schoolId: "school-a", managers: { Secondaire: { userId: "prefect", updatedAt: "t", updatedBy: "admin" } } });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("calendrier : responsable désigné de la section", () => {
  it("le responsable désigné règle le calendrier de sa section", async () => {
    await assertSucceeds(save("prefect", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Secondaire: "draft" } }, [event("secondaire", { title: "Corrigé", sectionIds: ["Secondaire"] }), event("nouveau", { sectionIds: ["Secondaire"] })]));
    await assertSucceeds(save("prefect", { ...baseMetadata, updatedAt: "v3", sectionStatus: { Secondaire: "validated" } }, [], ["secondaire"]));
  });

  it("un autre compte de la section est refusé (événements, suppression, statut)", async () => {
    await assertFails(save("director", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Secondaire: "draft" } }, [event("secondaire", { title: "x", sectionIds: ["Secondaire"] })]));
    await assertFails(save("director", { ...baseMetadata, updatedAt: "v2" }, [event("nouveau", { sectionIds: ["Secondaire"] })]));
    await assertFails(save("director", { ...baseMetadata, updatedAt: "v2" }, [], ["secondaire"]));
    await assertFails(save("director", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Secondaire: "validated" } }));
  });

  it("un compte de plusieurs sections garde ses sections sans responsable, pas celle confiée à un autre", async () => {
    await assertSucceeds(save("both", { ...baseMetadata, updatedAt: "v2", sectionStatus: { CTEB: "draft" } }, [event("cteb", { title: "x", sectionIds: ["CTEB"] })]));
    await assertFails(save("both", { ...baseMetadata, updatedAt: "v3", sectionStatus: { CTEB: "draft" } }, [event("mixte", { sectionIds: ["CTEB", "Secondaire"] })]));
    await assertFails(save("both", { ...baseMetadata, updatedAt: "v3", sectionStatus: { CTEB: "draft", Secondaire: "draft" } }));
  });

  it("les comptes « toute l'école » restent acceptés", async () => {
    await assertSucceeds(save("all", { ...baseMetadata, status: "draft", updatedAt: "v2" }, [event("secondaire", { title: "x", sectionIds: ["Secondaire"] })], ["ecole"]));
    await assertSucceeds(save("everything", { ...baseMetadata, updatedAt: "v3", updatedScope: "school" }, [event("secondaire", { title: "y", sectionIds: ["Secondaire"] }), event("ecole2")]));
  });

  it("un compte aux sections invalides est refusé", async () => {
    for (const uid of ["invalid", "invalidLegacy"]) {
      await assertFails(save(uid, { ...baseMetadata, status: "draft", updatedAt: "v2" }));
      await assertFails(save(uid, { ...baseMetadata, updatedAt: "v2" }, [event("ecole", { title: "x" })]));
      await assertFails(save(uid, { ...baseMetadata, updatedAt: "v2", updatedScope: "school" }, [event("ecole", { title: "x" })]));
      await assertFails(save(uid, { ...baseMetadata, updatedAt: "v2" }, [event("nouveau", { sectionIds: ["Secondaire"] })]));
    }
  });

  it("sans désignation, un compte de la section fonctionne comme avant", async () => {
    await seed("sectionSettingsManagers/school-a", { schoolId: "school-a", managers: {} });
    await assertSucceeds(save("director", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Secondaire: "draft" } }, [event("secondaire", { title: "x", sectionIds: ["Secondaire"] })]));
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = writeBatch(db);
      batch.delete(doc(db, "sectionSettingsManagers/school-a"));
      await batch.commit();
    });
    await assertSucceeds(save("director", { ...baseMetadata, updatedAt: "v3", sectionStatus: { Secondaire: "validated" } }, [event("nouveau", { sectionIds: ["Secondaire"] })]));
  });

  it("un compte sans section fonctionne comme avant, même avec un responsable désigné", async () => {
    await assertSucceeds(save("all", { ...baseMetadata, updatedAt: "v2" }, [event("ecole", { title: "Congé corrigé" }), event("cteb", { title: "z", sectionIds: ["CTEB"] })], ["secondaire"]));
  });
});
