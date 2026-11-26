import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, Timestamp, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot R4 : calendrier scolaire par section (règle unique des sections).
let environment: RulesTestEnvironment;
const database = (uid: string) => environment.authenticatedContext(uid, { role: "study_director", schoolId: "school-a" }).firestore();
const day = (value: string) => Timestamp.fromDate(new Date(`${value}T00:00:00Z`));
const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, schoolId: "school-a", schoolYearId: "year-a", title: "Congé", kind: "holiday", startsAt: day("2026-10-14"), endsAt: day("2026-10-14"), origin: "local", ...extra,
});
const baseMetadata = { schoolId: "school-a", schoolYearId: "year-a", status: "validated", updatedAt: "v1", updatedBy: "seed" };

function save(uid: string, metadata: Record<string, unknown>, events: Record<string, unknown>[] = [], deletes: string[] = []) {
  const db = database(uid);
  const batch = writeBatch(db);
  batch.set(doc(db, "schoolCalendars/year-a"), { ...metadata, updatedBy: uid });
  for (const item of events) batch.set(doc(db, "schoolCalendars/year-a/events", String(item.id)), item);
  for (const id of deletes) batch.delete(doc(db, "schoolCalendars/year-a/events", id));
  return batch.commit();
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-school-calendar-sections", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 60000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools/school-a"), { status: "active", educationLevels: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
    await setDoc(doc(db, "schools/school-b"), { status: "active", schoolType: "CTEB et Secondaire" });
    await setDoc(doc(db, "schoolYears/year-a"), { schoolId: "school-a", status: "active" });
    const director = { schoolId: "school-a", role: "study_director", status: "active", active: true };
    await setDoc(doc(db, "users/all"), director);
    await setDoc(doc(db, "users/primary"), { ...director, sectionIds: ["Primaire"] });
    await setDoc(doc(db, "users/primaryLegacy"), { ...director, section: "Primaire" });
    await setDoc(doc(db, "users/everything"), { ...director, sectionIds: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
    await setDoc(doc(db, "schoolCalendars/year-a"), baseMetadata);
    await setDoc(doc(db, "schoolCalendars/year-a/events/ecole"), event("ecole"));
    await setDoc(doc(db, "schoolCalendars/year-a/events/primaire"), event("primaire", { sectionIds: ["Primaire"] }));
    await setDoc(doc(db, "schoolCalendars/year-a/events/secondaire"), event("secondaire", { sectionIds: ["Secondaire"] }));
  });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("calendrier scolaire par section", () => {
  it("un compte sans section ou couvrant toutes les sections règle tout, comme avant", async () => {
    await assertSucceeds(save("all", { ...baseMetadata, status: "draft", updatedAt: "v2" }, [event("ecole", { title: "Congé corrigé" }), event("secondaire", { title: "x", sectionIds: ["Secondaire"] })], ["primaire"]));
    // Compte couvrant toutes les sections : il déclare « toute l'école », la règle le vérifie.
    await assertFails(save("everything", { ...baseMetadata, updatedAt: "v3" }, [event("ecole", { title: "Encore" })]));
    await assertSucceeds(save("everything", { ...baseMetadata, updatedAt: "v3", updatedScope: "school" }, [event("ecole", { title: "Encore" }), event("secondaire", { title: "y", sectionIds: ["Secondaire"] })]));
  });
  it("un compte Primaire modifie, ajoute et supprime les événements de sa section et le statut de sa section", async () => {
    await assertSucceeds(save("primary", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Primaire: "draft" } }, [event("primaire", { title: "Corrigé", sectionIds: ["Primaire"] }), event("nouveau", { sectionIds: ["Primaire"] })]));
    await assertSucceeds(save("primaryLegacy", { ...baseMetadata, updatedAt: "v3", sectionStatus: { Primaire: "validated" } }, [], ["primaire"]));
  });
  it("un compte Primaire ne touche ni aux événements de toute l'école ni à ceux d'une autre section", async () => {
    const metadata = { ...baseMetadata, updatedAt: "v2", sectionStatus: { Primaire: "draft" } };
    await assertFails(save("primary", metadata, [event("ecole", { title: "x" })]));
    await assertFails(save("primary", metadata, [event("secondaire", { title: "x", sectionIds: ["Secondaire"] })]));
    await assertFails(save("primary", metadata, [event("primaire", { sectionIds: ["Secondaire"] })]));
    await assertFails(save("primary", metadata, [event("mixte", { sectionIds: ["Primaire", "Secondaire"] })]));
    await assertFails(save("primary", metadata, [event("sans-section")]));
    await assertFails(save("primary", metadata, [], ["ecole"]));
    await assertFails(save("primary", metadata, [], ["secondaire"]));
  });
  it("un compte Primaire ne change ni le statut général, ni le statut d'une autre section, ni le PDF", async () => {
    await assertFails(save("primary", { ...baseMetadata, status: "draft", updatedAt: "v2" }));
    await assertFails(save("primary", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Secondaire: "draft" } }));
    await assertFails(save("primary", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Primaire: "publié" } }));
    await assertSucceeds(save("primary", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Primaire: "validated" } }));
  });
  it("un compte Primaire ne peut pas se déclarer « toute l'école »", async () => {
    await assertFails(save("primary", { ...baseMetadata, status: "draft", updatedAt: "v2", updatedScope: "school" }));
    await assertFails(save("primary", { ...baseMetadata, updatedAt: "v2", updatedScope: "school" }, [event("ecole", { title: "x" })]));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "schoolCalendars/year-a"), { ...baseMetadata, updatedScope: "school" });
    });
    // Une déclaration laissée par un autre compte ne lui sert à rien : il doit la retirer.
    await assertFails(save("primary", { ...baseMetadata, updatedAt: "v2", updatedScope: "school" }, [event("ecole", { title: "x" })]));
    await assertFails(save("primary", { ...baseMetadata, updatedAt: "v2" }, [event("ecole", { title: "x" })]));
    await assertSucceeds(save("primary", { ...baseMetadata, updatedAt: "v2", sectionStatus: { Primaire: "draft" } }, [event("primaire", { title: "z", sectionIds: ["Primaire"] })]));
  });
  it("accepte 30 événements d'un compte couvrant toutes les sections en un seul enregistrement", async () => {
    const events = Array.from({ length: 30 }, (_, index) => event(`e-${index}`, index % 2 ? { sectionIds: ["Primaire"] } : {}));
    await assertSucceeds(save("everything", { ...baseMetadata, updatedAt: "v2", updatedScope: "school" }, events));
  });
  it("un compte Primaire peut créer le calendrier en brouillon pour sa section seulement", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await environment.clearFirestore();
      await setDoc(doc(db, "schools/school-a"), { status: "active", educationLevels: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
      await setDoc(doc(db, "schoolYears/year-a"), { schoolId: "school-a", status: "active" });
      await setDoc(doc(db, "users/primary"), { schoolId: "school-a", role: "study_director", status: "active", active: true, sectionIds: ["Primaire"] });
    });
    await assertFails(save("primary", { schoolId: "school-a", schoolYearId: "year-a", status: "validated", updatedAt: "v1" }, [event("p", { sectionIds: ["Primaire"] })]));
    await assertSucceeds(save("primary", { schoolId: "school-a", schoolYearId: "year-a", status: "draft", updatedAt: "v1", sectionStatus: { Primaire: "validated" } }, [event("p", { sectionIds: ["Primaire"] })]));
  });
  it("dans une école d'une seule section, son responsable règle toute l'école", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "schools/school-a"), { status: "active", schoolType: "Primaire uniquement" });
    });
    await assertSucceeds(save("primary", { ...baseMetadata, status: "draft", updatedAt: "v2", updatedScope: "school" }, [event("ecole", { title: "x" })]));
  });
  it("refuse des sections d'événement invalides, même pour un compte sans section", async () => {
    for (const sectionIds of [[], ["Lycée"], "Primaire", ["Maternelle", "Primaire", "CTEB", "Secondaire", "Primaire"]]) {
      await assertFails(save("all", { ...baseMetadata, updatedAt: "v2" }, [event("bad", { sectionIds })]));
    }
  });
});
