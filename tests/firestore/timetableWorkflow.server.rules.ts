import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { executeTimetableWorkflow } from "../../api/_lib/timetableWorkflow.js";

const projectId = `demo-timetable-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, projectId), db = getFirestore(app);
const scope = { schoolId: "school", schoolYearId: "year" };
const caller = { uid: "director", role: "study_director", schoolId: "school" };
const body = { ...scope, action: "timetable-validate", scheduleId: "new", expectedUpdatedAt: "n", requestId: "validation-1" };
const names = ["schools", "schoolYears", "users", "teachers", "classes", "subjects", "pedagogicalAssignments", "schedulePeriods", "teacherAvailabilities", "rooms", "attendanceSettings", "timetables", "timetableEntries", "timetablePublicationStates"];
function guard() { if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(localhost|127\.0\.0\.1):\d+$/) || !projectId.startsWith("demo-timetable-")) throw Error("Émulateur local requis"); }
async function cleanup() {
  guard();
  for (const name of names) { const snapshot = await db.collection(name).get(), batch = db.batch(); snapshot.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit(); expect((await db.collection(name).get()).empty).toBe(true); }
}
beforeAll(guard);
beforeEach(async () => {
  await cleanup(); const batch = db.batch();
  const fixtures = {
    "schools/school": { status: "active" }, "schoolYears/year": { schoolId: "school", status: "active" },
    "users/director": { ...caller, role: "study_director", active: true },
    "teachers/teacher": { ...scope, status: "active", fullName: "Enseignant fictif" },
    "classes/class": { ...scope, name: "Classe fictive", section: "Secondaire", active: true },
    "subjects/math": { ...scope, name: "Mathématiques", active: true },
    "pedagogicalAssignments/assignment": { ...scope, teacherId: "teacher", classId: "class", subjectId: "math", weeklyPeriods: 1, active: true },
    "schedulePeriods/period": { ...scope, label: "Première", startTime: "08:00", endTime: "09:00", order: 1, type: "course", active: true },
    "timetables/new": { ...scope, id: "new", version: 2, status: "DRAFT", activeDraft: true, updatedAt: "n" },
    "timetables/old": { ...scope, id: "old", version: 1, status: "PUBLISHED", activePublished: true, updatedAt: "old" },
    "timetableEntries/entry": { ...scope, scheduleId: "new", teacherId: "teacher", classId: "class", subjectId: "math", assignmentId: "assignment", periodId: "period", dayOfWeek: "monday", roomId: null },
  };
  for (const [path, value] of Object.entries(fixtures)) batch.set(db.doc(path), value);
  await batch.commit();
}, 30000);
afterAll(async () => { await cleanup(); await deleteApp(app); }, 30000);
const execute = (request = body) => executeTimetableWorkflow({ db, caller, body: request });
async function publicationRequest() {
  await execute();
  return { ...body, action: "timetable-publish", requestId: "publish-1", expectedUpdatedAt: (await db.doc("timetables/new").get()).data()!.updatedAt, expectedPublishedIds: ["old"] };
}
describe("workflow serveur atomique sur Firestore réel émulé", () => {
  it("valide sans publier, publie une seule version et répète sans nouvelle écriture", async () => {
    const request = await publicationRequest();
    expect((await db.doc("timetables/old").get()).data()!.activePublished).toBe(true);
    expect(await execute(request)).toMatchObject({ status: "PUBLISHED", replayed: false });
    const published = (await db.doc("timetables/new").get()).data();
    expect(await execute(request)).toMatchObject({ replayed: true });
    expect((await db.doc("timetables/new").get()).data()).toEqual(published);
    expect((await db.doc("timetables/old").get()).data()!.activePublished).toBe(false);
    expect((await db.collection("timetables").where("activePublished", "==", true).get()).size).toBe(1);
  });
  it.each(["teacher", "school_admin", "secretary", "parent"])("refuse le rôle %s", async (role) => {
    await expect(executeTimetableWorkflow({ db, caller: { ...caller, role }, body })).rejects.toMatchObject({ status: 403 });
  });
  it("refuse une autre école, année archivée et section non autorisée", async () => {
    await expect(executeTimetableWorkflow({ db, caller: { ...caller, schoolId: "other" }, body })).rejects.toMatchObject({ status: 403 });
    await db.doc("schoolYears/year").update({ status: "archived" }); await expect(execute()).rejects.toMatchObject({ status: 403 });
    await db.doc("schoolYears/year").update({ status: "active" }); await db.doc("users/director").update({ sectionIds: ["Primaire"] });
    await expect(execute()).rejects.toMatchObject({ status: 403 });
  });
  it.each([
    ["teacherAvailabilities/new", { ...scope, teacherId: "teacher", dayOfWeek: "monday", status: "rest", active: true }],
    ["schedulePeriods/period", { startTime: "08:15" }],
    ["subjects/math", { active: false }],
    ["teachers/teacher", { status: "inactive" }],
    ["pedagogicalAssignments/assignment", { weeklyPeriods: 2 }],
    ["classes/class", { active: false }],
    ["attendanceSettings/settings", { ...scope, schoolDays: ["tuesday"] }],
  ])("refuse les sources modifiées après validation : %s", async (path, patch) => {
    const request = await publicationRequest(); await db.doc(path as string).set(patch as Record<string, unknown>, { merge: true });
    await expect(execute(request)).rejects.toMatchObject({ status: 409 });
    expect((await db.doc("timetables/old").get()).data()!.activePublished).toBe(true);
  });
  it("refuse une liste client mensongère et laisse la publication intacte", async () => {
    const request = await publicationRequest(); await expect(execute({ ...request, expectedPublishedIds: [] })).rejects.toMatchObject({ code: "publication-conflict" });
    expect((await db.doc("timetables/old").get()).data()!.activePublished).toBe(true);
  });
  it("deux publications simultanées ne peuvent remplacer successivement la même référence", async () => {
    const first = await publicationRequest();
    await db.doc("timetables/second").set({ ...(await db.doc("timetables/new").get()).data(), id: "second", status: "DRAFT", updatedAt: "n" });
    await db.doc("timetableEntries/second").set({ ...(await db.doc("timetableEntries/entry").get()).data(), scheduleId: "second" });
    await execute({ ...body, scheduleId: "second", requestId: "validation-2" });
    const second = { ...first, scheduleId: "second", requestId: "publish-2", expectedUpdatedAt: (await db.doc("timetables/second").get()).data()!.updatedAt };
    const attempts = await Promise.allSettled([execute(first), execute(second)]);
    expect(attempts.filter((item) => item.status === "fulfilled").length).toBeLessThanOrEqual(1);
    for (const item of attempts) if (item.status === "rejected") expect(item.reason).toMatchObject({ status: 409 });
    expect((await db.collection("timetables").where("activePublished", "==", true).get()).size).toBe(1);
  }, 30000);
  it("refuse les publications historiques ambiguës sans les réécrire", async () => {
    await db.doc("timetables/ambiguous").set({ ...scope, status: "PUBLISHED", activePublished: true });
    await expect(execute()).rejects.toMatchObject({ code: "ambiguous-publication" });
    expect((await db.collection("timetables").where("activePublished", "==", true).get()).size).toBe(2);
  });
  for (const change of [
    { collection: "schedulePeriods", path: "schedulePeriods/period", data: { endTime: "09:15" } },
    { collection: "teacherAvailabilities", path: "teacherAvailabilities/concurrent", data: { ...scope, teacherId: "teacher", dayOfWeek: "monday", status: "rest", active: true } },
    { collection: "pedagogicalAssignments", path: "pedagogicalAssignments/assignment", data: { weeklyPeriods: 2 } },
    { collection: "timetableEntries", path: "timetableEntries/entry", data: { dayOfWeek: "tuesday" } },
  ]) it(`sérialise ou refuse la mutation concurrente réelle de ${change.collection}`, async () => {
    const request = await publicationRequest();
    let concurrent: ReturnType<ReturnType<typeof db.doc>["set"]> | undefined;
    const source = { doc: db.doc.bind(db), collection: db.collection.bind(db),
      runTransaction: (callback: (tx: unknown) => Promise<unknown>, options: Parameters<typeof db.runTransaction>[1]) => db.runTransaction(tx => callback({
        get: async (ref: Parameters<typeof tx.get>[0]) => {
          const result = await tx.get(ref);
          if (!concurrent && "_queryOptions" in ref && (ref as { _queryOptions?: { collectionId?: string } })._queryOptions?.collectionId === change.collection) {
            concurrent = db.doc(change.path).set(change.data, { merge: true });
            void concurrent.catch(() => undefined);
          }
          return result;
        }, set: tx.set.bind(tx), update: tx.update.bind(tx),
      }), options),
    };
    let succeeded = false;
    try { await executeTimetableWorkflow({ db: source, caller, body: request }); succeeded = true; }
    catch (error) { expect(error).toMatchObject({ status: 409, code: "publication-conflict" }); }
    expect(concurrent).toBeDefined(); const changed = await concurrent!;
    if (succeeded) expect((await db.doc("timetables/new").get()).updateTime!.toMillis()).toBeLessThanOrEqual(changed.writeTime.toMillis());
    else expect((await db.doc("timetables/old").get()).data()!.activePublished).toBe(true);
  }, 30000);
});
