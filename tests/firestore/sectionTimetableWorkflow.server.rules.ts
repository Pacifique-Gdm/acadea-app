import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { executeTimetableWorkflow } from "../../api/_lib/timetableWorkflow.js";
import { readPublishedTimetable } from "../../api/_lib/publishedTimetableRead.js";

// Lot R5 : horaire par section (brouillon, validation, publication) sur Firestore émulé.
const projectId = `demo-timetable-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, projectId), db = getFirestore(app);
const scope = { schoolId: "school", schoolYearId: "year" };
const primary = { uid: "primary", role: "study_director", schoolId: "school" };
const secondary = { uid: "secondary", role: "study_director", schoolId: "school" };
const whole = { uid: "whole", role: "study_director", schoolId: "school" };
const names = ["sectionSettingsManagers", "schools", "schoolYears", "users", "teachers", "classes", "subjects", "pedagogicalAssignments", "schedulePeriods", "teacherAvailabilities", "rooms", "attendanceSettings", "timetables", "timetableEntries", "timetablePublicationStates", "rateLimits"];
function guard() { if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(localhost|127\.0\.0\.1):\d+$/) || !projectId.startsWith("demo-timetable-")) throw Error("Émulateur local requis"); }
async function cleanup() {
  guard();
  for (const name of names) { const snapshot = await db.collection(name).get(), batch = db.batch(); snapshot.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); }
}
const entry = (scheduleId: string, classId: string, assignmentId: string, periodId: string, teacherId = "teacher") =>
  ({ ...scope, scheduleId, teacherId, classId, subjectId: "math", assignmentId, periodId, dayOfWeek: "monday", roomId: null });
beforeAll(guard);
beforeEach(async () => {
  await cleanup(); const batch = db.batch();
  const fixtures: Record<string, Record<string, unknown>> = {
    "schools/school": { status: "active", educationLevels: ["Primaire", "Secondaire"] }, "schoolYears/year": { schoolId: "school", status: "active" },
    "users/primary": { ...primary, active: true, sectionIds: ["Primaire"] },
    "users/secondary": { ...secondary, active: true, sectionIds: ["Secondaire"] },
    "users/whole": { ...whole, active: true },
    "teachers/teacher": { ...scope, status: "active", fullName: "Enseignant partagé" },
    "teachers/other": { ...scope, status: "active", fullName: "Autre enseignant" },
    "classes/p1": { ...scope, name: "1ère Primaire", section: "Primaire", active: true },
    "classes/h1": { ...scope, name: "1ère Humanité", section: "Secondaire", active: true },
    "subjects/math": { ...scope, name: "Mathématiques", active: true },
    "pedagogicalAssignments/ap": { ...scope, teacherId: "teacher", classId: "p1", subjectId: "math", weeklyPeriods: 1, active: true },
    "pedagogicalAssignments/ah": { ...scope, teacherId: "teacher", classId: "h1", subjectId: "math", weeklyPeriods: 1, active: true },
    "schedulePeriods/p8": { ...scope, label: "Première", startTime: "08:00", endTime: "09:00", order: 1, type: "course", active: true },
    "schedulePeriods/p9": { ...scope, label: "Deuxième", startTime: "09:00", endTime: "10:00", order: 2, type: "course", active: true },
    // Horaire publié pour toute l'école (existant) : les deux sections.
    "timetables/school": { ...scope, id: "school", version: 1, status: "PUBLISHED", activeDraft: false, activePublished: true, updatedAt: "old" },
    "timetableEntries/school-p": entry("school", "p1", "ap", "p8"),
    "timetableEntries/school-h": entry("school", "h1", "ah", "p9"),
    // Brouillon de la section Primaire.
    "timetables/prim": { ...scope, id: "prim", version: 2, status: "DRAFT", activeDraft: true, sectionId: "Primaire", updatedAt: "n" },
    "timetableEntries/prim-p": entry("prim", "p1", "ap", "p8"),
  };
  for (const [path, value] of Object.entries(fixtures)) batch.set(db.doc(path), value);
  await batch.commit();
}, 30000);
afterAll(async () => { await cleanup(); await deleteApp(app); }, 30000);

const validate = (caller: typeof primary, scheduleId = "prim", requestId = "v-1") =>
  executeTimetableWorkflow({ db, caller, body: { ...scope, action: "timetable-validate", scheduleId, expectedUpdatedAt: "n", requestId } });
async function publish(caller: typeof primary, scheduleId = "prim", expectedPublishedIds = ["school"]) {
  await validate(caller, scheduleId);
  const expectedUpdatedAt = (await db.doc(`timetables/${scheduleId}`).get()).data()!.updatedAt;
  return executeTimetableWorkflow({ db, caller, body: { ...scope, action: "timetable-publish", scheduleId, expectedUpdatedAt, requestId: "p-1", expectedPublishedIds } });
}
const activeIds = async () => (await db.collection("timetables").where("activePublished", "==", true).get()).docs.map((doc) => doc.id).sort();

describe("horaire par section (R5) sur Firestore émulé", () => {
  it("la section publie son horaire ; l'horaire de l'école reste publié pour les autres sections", async () => {
    expect(await publish(primary)).toMatchObject({ status: "PUBLISHED", replayed: false });
    expect(await activeIds()).toEqual(["prim", "school"]);
    const read = await readPublishedTimetable({ db, caller: whole, schoolYearId: "year" });
    expect(read!.version).toBe(1);
    expect(read!.rows.map((row: { classLabel: string; startTime: string }) => `${row.classLabel}:${row.startTime}`)).toEqual(["1ère Primaire:08:00", "1ère Humanité:09:00"]);
  });

  it("une nouvelle publication de la section remplace seulement la sienne", async () => {
    await publish(primary);
    await db.doc("timetables/prim2").set({ ...scope, id: "prim2", version: 3, status: "DRAFT", activeDraft: true, sectionId: "Primaire", updatedAt: "n" });
    await db.doc("timetableEntries/prim2-p").set(entry("prim2", "p1", "ap", "p8"));
    await publish(primary, "prim2", ["prim", "school"]);
    expect(await activeIds()).toEqual(["prim2", "school"]);
  });

  it("refuse la section d'un autre compte et un enseignant déjà en cours dans une autre section", async () => {
    await expect(validate(secondary)).rejects.toMatchObject({ status: 403 });
    await db.doc("timetableEntries/prim-p").update({ periodId: "p9" });
    await expect(validate(primary)).rejects.toMatchObject({ status: 409, code: "invalid-timetable" });
    expect(await activeIds()).toEqual(["school"]);
  });

  it("un compte qui agit pour toute l'école peut publier l'horaire d'une section", async () => {
    expect(await publish(whole)).toMatchObject({ status: "PUBLISHED" });
    expect(await activeIds()).toEqual(["prim", "school"]);
  });

  it("une publication de toute l'école remplace aussi les horaires de section (comme avant)", async () => {
    await publish(primary);
    await db.doc("timetables/all").set({ ...scope, id: "all", version: 4, status: "DRAFT", activeDraft: true, updatedAt: "n" });
    await db.doc("timetableEntries/all-p").set(entry("all", "p1", "ap", "p8"));
    await db.doc("timetableEntries/all-h").set(entry("all", "h1", "ah", "p9"));
    await expect(publish(whole, "all", ["school"])).rejects.toMatchObject({ code: "publication-conflict" });
    await db.doc("timetables/all").update({ status: "VALID" });
    const expectedUpdatedAt = (await db.doc("timetables/all").get()).data()!.updatedAt;
    await expect(executeTimetableWorkflow({ db, caller: whole, body: { ...scope, action: "timetable-publish", scheduleId: "all", expectedUpdatedAt, requestId: "p-2", expectedPublishedIds: ["prim", "school"] } })).resolves.toMatchObject({ status: "PUBLISHED" });
    expect(await activeIds()).toEqual(["all"]);
  });

  it("un compte limité à une section reste bloqué pour l'horaire de toute l'école", async () => {
    await db.doc("timetables/all").set({ ...scope, id: "all", version: 4, status: "DRAFT", activeDraft: true, updatedAt: "n" });
    await db.doc("timetableEntries/all-p").set(entry("all", "p1", "ap", "p8"));
    await db.doc("timetableEntries/all-h").set(entry("all", "h1", "ah", "p9"));
    await expect(validate(primary, "all")).rejects.toMatchObject({ status: 403 });
  });
  it("R6 : une section confiée à un responsable désigné n'est validée que par lui", async () => {
    await db.doc("users/secondary2").set({ uid: "secondary2", role: "study_director", schoolId: "school", active: true, sectionIds: ["Secondaire"] });
    await db.doc("timetables/sec").set({ ...scope, id: "sec", version: 3, status: "DRAFT", activeDraft: true, sectionId: "Secondaire", updatedAt: "n" });
    await db.doc("timetableEntries/sec-h").set(entry("sec", "h1", "ah", "p9"));
    await db.doc("sectionSettingsManagers/school").set({ schoolId: "school", managers: { Secondaire: { userId: "secondary2" } } });
    await expect(validate(secondary, "sec")).rejects.toMatchObject({ status: 403 });
    await expect(validate({ uid: "secondary2", role: "study_director", schoolId: "school" }, "sec")).resolves.toBeTruthy();
    // Une désignation d'une autre école est ignorée.
    await db.doc("sectionSettingsManagers/school").set({ schoolId: "autre", managers: { Secondaire: { userId: "secondary2" } } });
    await db.doc("timetables/sec2").set({ ...scope, id: "sec2", version: 4, status: "DRAFT", activeDraft: true, sectionId: "Secondaire", updatedAt: "n" });
    await db.doc("timetableEntries/sec2-h").set(entry("sec2", "h1", "ah", "p9"));
    await expect(validate(secondary, "sec2", "v-2")).resolves.toBeTruthy();
  });
});
