import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment;
const database = (uid: string, role: string, schoolId = "school-a") => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const day = (value: string) => Timestamp.fromDate(new Date(`${value}T00:00:00Z`));
const metadata = (schoolId = "school-a", schoolYearId = "year-a", updatedBy = "director", updatedAt = "v1") => ({ schoolId, schoolYearId, status: "validated", updatedAt, updatedBy });
const event = (extra: Record<string, unknown> = {}) => ({
  id: "event-a", schoolId: "school-a", schoolYearId: "year-a", title: "Congé scolaire",
  kind: "holiday", startsAt: day("2026-10-14"), endsAt: day("2026-10-15"), origin: "local", ...extra,
});

function writeEvent(uid = "director", role = "study_director", value: Record<string, unknown> = event(), schoolId = "school-a", schoolYearId = "year-a", version = "v1") {
  const db = database(uid, role, schoolId);
  const batch = writeBatch(db);
  batch.set(doc(db, "schoolCalendars", schoolYearId), metadata(schoolId, schoolYearId, uid, version));
  batch.set(doc(db, "schoolCalendars", schoolYearId, "events", String(value.id)), value);
  return batch.commit();
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-school-calendars", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 60000);
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools/school-a"), { status: "active" });
    await setDoc(doc(db, "schools/school-b"), { status: "active" });
    await setDoc(doc(db, "schoolYears/year-a"), { schoolId: "school-a", status: "active" });
    await setDoc(doc(db, "schoolYears/year-b"), { schoolId: "school-b", status: "active" });
    await setDoc(doc(db, "users/director"), { schoolId: "school-a", role: "study_director", status: "active", active: true });
    await setDoc(doc(db, "users/teacher"), { schoolId: "school-a", role: "teacher", status: "active", active: true });
    await setDoc(doc(db, "users/other"), { schoolId: "school-b", role: "study_director", status: "active", active: true });
    await setDoc(doc(db, "users/admin"), { schoolId: "school-a", role: "school_admin", status: "active", active: true });
  });
});
afterAll(async () => environment?.cleanup(), 30000);

describe("calendrier scolaire cloisonné et événements validés document par document", () => {
  it("autorise la lecture d'un calendrier absent pour l'école et l'année du Directeur, sans ouvrir l'autre école", async () => {
    const director = database("director", "study_director");
    const missing = await assertSucceeds(getDoc(doc(director, "schoolCalendars/year-a")));
    expect(missing.exists()).toBe(false);
    await assertFails(getDoc(doc(database("other", "study_director", "school-b"), "schoolCalendars/year-a")));
  });
  it("autorise le Directeur et la lecture de l'Enseignant, sans liste globale", async () => {
    await assertSucceeds(writeEvent());
    await assertSucceeds(getDoc(doc(database("teacher", "teacher"), "schoolCalendars/year-a")));
    await assertSucceeds(getDoc(doc(database("teacher", "teacher"), "schoolCalendars/year-a/events/event-a")));
    await assertSucceeds(getDocs(collection(database("teacher", "teacher"), "schoolCalendars/year-a/events")));
    await assertFails(getDocs(collection(database("teacher", "teacher"), "schoolCalendars")));
  });
  it("refuse l'anonyme, l'Enseignant écrivain et les accès d'une autre école ou année", async () => {
    await assertSucceeds(writeEvent());
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "schoolCalendars/year-a")));
    await assertFails(getDoc(doc(database("other", "study_director", "school-b"), "schoolCalendars/year-a/events/event-a")));
    await assertFails(writeEvent("teacher", "teacher", event(), "school-a", "year-a", "v2"));
    await assertFails(writeEvent("other", "study_director", event(), "school-b", "year-a", "v2"));
    await assertFails(writeEvent("director", "study_director", event({ schoolId: "school-b" })));
    await assertFails(writeEvent("admin", "school_admin", event(), "school-a", "year-a", "v2"));
  });
  it("refuse titre, début, fin et type absents ou invalides", async () => {
    const missing = ["title", "startsAt", "endsAt", "kind"].map((key) => {
      const value: Record<string, unknown> = { ...event() };
      delete value[key];
      return value;
    });
    for (const bad of [
      ...missing,
      event({ title: "" }), event({ title: "x".repeat(121) }),
      event({ startsAt: null }), event({ endsAt: null }),
      event({ kind: null }), event({ kind: "unknown" }),
      event({ startsAt: "2026-10-14" }), event({ endsAt: day("2026-10-13") }),
      event({ unexpected: true }),
    ]) await assertFails(writeEvent("director", "study_director", bad));
  });
  it("autorise la suspension explicite complète ou horaire et refuse les créneaux incohérents", async () => {
    await assertSucceeds(writeEvent("director", "study_director", event({ suspendsCourses: true })));
    await assertSucceeds(writeEvent("director", "study_director", event({ startsAt: day("2026-10-14"), endsAt: day("2026-10-14"), suspendsCourses: true, startTime: "09:00", endTime: "10:00" }), "school-a", "year-a", "v2"));
    await assertSucceeds(writeEvent("director", "study_director", event({ kind: "meeting", suspendsCourses: false }), "school-a", "year-a", "v3"));
    for (const bad of [
      { suspendsCourses: "true" }, { startTime: "09:00", endTime: "10:00" },
      { suspendsCourses: false, startTime: "09:00", endTime: "10:00" },
      { suspendsCourses: true, startTime: "10:00", endTime: "09:00" },
      { suspendsCourses: true, startTime: "09:00" },
      { suspendsCourses: true, startTime: "9:00", endTime: "10:00" },
      { kind: "resumption", suspendsCourses: true },
    ]) await assertFails(writeEvent("director", "study_director", event(bad), "school-a", "year-a", "v3"));
  });
  it("refuse la provenance officielle falsifiée et les données excessives", async () => {
    const official = { origin: "official-proposal", sourceUrl: "https://edu-nc.gouv.cd/calendrier-scolaire", educationLevel: "Secondaire" };
    await assertFails(writeEvent("director", "study_director", event({ ...official, sourceUrl: "https://edu-nc.gouv.cd.evil.example/" })));
    await assertFails(writeEvent("director", "study_director", event({ ...official, educationLevel: "" })));
    await assertFails(writeEvent("director", "study_director", event({ ...official, sourceUrl: "https://edu-nc.gouv.cd/" + "x".repeat(1100) })));
    await assertFails(writeEvent("director", "study_director", event({ ...official, publishedAt: "2026-10-01" })));
    await assertFails(writeEvent("director", "study_director", event({ origin: "local", sourceUrl: official.sourceUrl })));
    await assertSucceeds(writeEvent("director", "study_director", event(official)));
  });
  it("refuse une écriture directe d'événement sans mise à jour atomique du parent", async () => {
    await assertSucceeds(writeEvent());
    const db = database("director", "study_director");
    await assertFails(setDoc(doc(db, "schoolCalendars/year-a/events/event-a"), event({ title: "Modification directe" })));
    await assertFails(deleteDoc(doc(db, "schoolCalendars/year-a/events/event-a")));
    await assertFails(setDoc(doc(db, "schoolCalendars/year-a"), { ...metadata(), events: [{ bogus: true }], updatedAt: "v2" }));
    await assertFails(setDoc(doc(database("teacher", "teacher"), "schoolCalendars/year-a"), metadata("school-a", "year-a", "teacher", "v2")));
  });
  it("autorise la mise à jour atomique puis la suppression par le Directeur uniquement", async () => {
    await assertSucceeds(writeEvent());
    await assertSucceeds(writeEvent("director", "study_director", event({ title: "Congé corrigé" }), "school-a", "year-a", "v2"));
    const db = database("director", "study_director");
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolCalendars/year-a"), metadata("school-a", "year-a", "director", "v3"));
    batch.delete(doc(db, "schoolCalendars/year-a/events/event-a"));
    await assertSucceeds(batch.commit());
    await assertFails(deleteDoc(doc(db, "schoolCalendars/year-a")));
  });
  it("accepte un calendrier de 30 événements sans plafond arbitraire dans les Rules", async () => {
    const db = database("director", "study_director");
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolCalendars/year-a"), metadata());
    for (let index = 0; index < 30; index += 1) {
      const id = `event-${index}`;
      batch.set(doc(db, "schoolCalendars/year-a/events", id), event({ id }));
    }
    await assertSucceeds(batch.commit());
    const snapshot = await assertSucceeds(getDocs(collection(db, "schoolCalendars/year-a/events")));
    expect(snapshot.size).toBe(30);
  });
  it("conserve la lecture des calendriers historiques sans réécriture distante", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "schoolCalendars/year-a"), { ...metadata(), events: [{ id: "legacy", title: "Congé historique", kind: "holiday", startsAt: "2026-10-14", endsAt: "2026-10-14", origin: "local" }] });
    });
    await assertSucceeds(getDoc(doc(database("teacher", "teacher"), "schoolCalendars/year-a")));
    await assertFails(setDoc(doc(database("director", "study_director"), "schoolCalendars/year-a"), { ...metadata("school-a", "year-a", "director", "v2"), events: [{ bogus: true }] }));
  });
  it("lie les événements PDF à un document de l'école et de l'année active, sans substitution", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "schools/school-a"), { status: "active", activeSchoolYearId: "year-a" });
    });
    const path = "school-calendars/school-a/year-a/123e4567-e89b-12d3-a456-426614174000.pdf";
    const sourcePdf = { path, name: "calendrier.pdf", size: 2048, pageCount: 7, sha256: "a".repeat(64), uploadedAt: "2026-10-15T12:00:00Z", uploadedBy: "director" };
    const db = database("director", "study_director");
    const pdfEvent = event({ origin: "pdf-import", sourcePdfPath: path, sourcePage: 2, educationLevel: "Secondaire", suspendsCourses: false });
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolCalendars/year-a"), { ...metadata(), sourcePdf });
    batch.set(doc(db, "schoolCalendars/year-a/events/event-a"), pdfEvent);
    await assertSucceeds(batch.commit());
    const changed = writeBatch(db);
    changed.set(doc(db, "schoolCalendars/year-a"), { ...metadata("school-a", "year-a", "director", "v2"), sourcePdf });
    changed.set(doc(db, "schoolCalendars/year-a/events/event-a"), { ...pdfEvent, title: "Examen corrigé" });
    await assertSucceeds(changed.commit());
    await assertFails(writeEvent("director", "study_director", { ...pdfEvent, sourcePdfPath: "school-calendars/school-b/year-a/123e4567-e89b-12d3-a456-426614174000.pdf" }, "school-a", "year-a", "v3"));
    await assertFails(writeEvent("director", "study_director", { ...pdfEvent, sourcePage: 8 }, "school-a", "year-a", "v3"));
    await assertFails(setDoc(doc(db, "schoolCalendars/year-a"), { ...metadata("school-a", "year-a", "director", "v3"), sourcePdf: { ...sourcePdf, path: path.replace("123e4567", "223e4567") } }));
    await assertFails(writeEvent("teacher", "teacher", pdfEvent, "school-a", "year-a", "v3"));
    await assertFails(getDoc(doc(database("other", "study_director", "school-b"), "schoolCalendars/year-a/events/event-a")));
  });
  it("permet d'attacher le premier PDF à un calendrier brouillon existant", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "schools/school-a"), { status: "active", activeSchoolYearId: "year-a" });
      await setDoc(doc(context.firestore(), "schoolCalendars/year-a"), metadata());
    });
    const db = database("director", "study_director");
    const path = "school-calendars/school-a/year-a/123e4567-e89b-12d3-a456-426614174000.pdf";
    const sourcePdf = { path, name: "calendrier.pdf", size: 2048, pageCount: 7, sha256: "a".repeat(64), uploadedAt: "2026-10-15T12:00:00Z", uploadedBy: "director" };
    const batch = writeBatch(db);
    batch.set(doc(db, "schoolCalendars/year-a"), { ...metadata("school-a", "year-a", "director", "v2"), sourcePdf });
    batch.set(doc(db, "schoolCalendars/year-a/events/event-a"), event({ origin: "pdf-import", sourcePdfPath: path, sourcePage: 3, educationLevel: "Primaire" }));
    await assertSucceeds(batch.commit());
  });
});
