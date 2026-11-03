import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeStudyPeriodMutation } from "../../api/_lib/studyPeriodMutations.js";

const projectId = `demo-period-mutation-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, projectId), db = getFirestore(app);
const scope = { schoolId: "school-a", schoolYearId: "year-a" };
const caller = { uid: "director", role: "study_director", schoolId: "school-a" };
const period = { ...scope, id: "school-a__year-a__p1", label: "Première", startTime: "08:00", endTime: "09:00", order: 1, type: "course", vacation: "morning", dayScope: "weekdays", targetPairs: ["class-a|monday"], active: true, createdBy: "director", createdAt: "n", updatedAt: "n" };
const collections = ["schools", "schoolYears", "users", "classes", "attendanceSettings", "schedulePeriods", "timetables", "timetableEntries"];
function guard() { if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(localhost|127\.0\.0\.1):\d+$/)) throw Error("Émulateur local requis"); }
async function cleanup() { guard(); for (const name of collections) { const docs = await db.collection(name).get(), batch = db.batch(); docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); expect((await db.collection(name).get()).empty).toBe(true); } }
beforeAll(guard);
beforeEach(async () => {
  await cleanup(); const batch = db.batch();
  for (const [path, data] of Object.entries({
    "schools/school-a": { status: "active" }, "schools/school-b": { status: "active" },
    "schoolYears/year-a": { schoolId: "school-a", status: "active" },
    "users/director": { ...caller, status: "active", sectionIds: ["Secondaire"] },
    "classes/class-a": { ...scope, name: "3ème Humanité", active: true, vacation: "morning" },
    "classes/class-b": { schoolId: "school-b", schoolYearId: "year-b", name: "Autre école", active: true },
    "attendanceSettings/settings": { ...scope, schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] },
  })) batch.set(db.doc(path), data);
  await batch.commit();
}, 30000);
afterAll(async () => { await cleanup(); await deleteApp(app); }, 30000);
const execute = (body: Record<string, unknown>, actor = caller) => executeStudyPeriodMutation({ db, caller: actor, body: { ...scope, ...body } });

describe("mutations de périodes sécurisées", () => {
  it("crée un groupe valide, puis refuse les classes étrangères et le samedi non scolaire", async () => {
    await expect(execute({ action: "study-period-save", item: period })).resolves.toMatchObject({ ok: true });
    expect((await db.doc(`schedulePeriods/${period.id}`).get()).data()?.targetPairs).toEqual(["class-a|monday"]);
    await expect(execute({ action: "study-period-save", item: { ...period, id: "school-a__year-a__foreign", targetPairs: ["class-b|monday"] } })).rejects.toMatchObject({ status: 403 });
    await expect(execute({ action: "study-period-save", item: { ...period, id: "school-a__year-a__saturday", targetPairs: ["class-a|saturday"] } })).rejects.toMatchObject({ status: 403 });
    expect((await db.collection("schedulePeriods").get()).size).toBe(1);
  });
  it("refuse un rôle ou une section sans autorisation", async () => {
    await expect(execute({ action: "study-period-save", item: period }, { ...caller, role: "secretary" })).rejects.toMatchObject({ status: 403 });
    await db.doc("users/director").update({ sectionIds: ["Primaire"] });
    await expect(execute({ action: "study-period-save", item: period })).rejects.toMatchObject({ status: 403 });
  });
  it("refuse la modification d'une période et d'une classe utilisées par un horaire validé", async () => {
    await execute({ action: "study-period-save", item: period });
    const expectedUpdatedAt = (await db.doc(`schedulePeriods/${period.id}`).get()).data()!.updatedAt;
    await db.doc("timetables/valid").set({ ...scope, id: "valid", status: "VALID" });
    await db.doc("timetableEntries/entry").set({ ...scope, scheduleId: "valid", classId: "class-a", periodId: period.id, active: true });
    await expect(execute({ action: "study-period-save", item: { ...period, label: "Nouvelle" }, expectedUpdatedAt })).rejects.toMatchObject({ code: "established-schedule" });
    await expect(execute({ action: "study-period-active", item: { ...scope, id: period.id, createdBy: "director", active: false }, expectedUpdatedAt })).rejects.toMatchObject({ code: "established-schedule" });
    await expect(execute({ action: "study-class-vacations", updates: [{ id: "class-a", dayVacations: { monday: "afternoon" } }] })).rejects.toMatchObject({ code: "established-schedule" });
    expect((await db.doc(`schedulePeriods/${period.id}`).get()).data()?.label).toBe("Première");
    expect((await db.doc("classes/class-a").get()).data()?.dayVacations).toBeUndefined();
  });
  it("met à jour des vacations de classe non utilisée sans toucher aux autres classes", async () => {
    await expect(execute({ action: "study-class-vacations", updates: [{ id: "class-a", dayVacations: { monday: "full", tuesday: "none" } }] })).resolves.toMatchObject({ updated: 1 });
    expect((await db.doc("classes/class-a").get()).data()?.dayVacations).toEqual({ monday: "full", tuesday: "none" });
    expect((await db.doc("classes/class-b").get()).data()?.dayVacations).toBeUndefined();
  });
});
