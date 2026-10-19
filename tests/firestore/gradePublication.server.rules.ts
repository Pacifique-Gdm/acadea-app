import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeGradePublication } from "../../api/_lib/gradePublication.js";

const projectId = "demo-grade-publication";
const app = initializeApp({ projectId }, "grade-publication-emulator-tests");
const db = getFirestore(app);
const director = { uid: "director", role: "study_director", schoolId: "school" };
const parent = { uid: "parent-user", role: "parent", schoolId: "school" };
const scope = { schoolId: "school", schoolYearId: "year" };
const publish = { action: "grades-publish", ...scope, classId: "class", slot: "period_1", requestId: "emulator-request-00001" };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Émulateur Firestore local requis.");
}, 30000);
beforeEach(async () => {
  const paths = ["schools", "schoolYears", "users", "classes", "students", "subjects", "pedagogicalAssignments", "courseGradingConfigs", "gradeEntries", "parents", "gradePublicationRuns", "publishedGradeResults", "notifications"];
  for (const name of paths) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  const seed = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school": { status: "active", activeSchoolYearId: "year", currency: "CDF" },
    "schoolYears/year": { schoolId: "school", name: "2027-2028", status: "active", currency: "CDF" },
    "users/director": { role: "study_director", schoolId: "school", active: true },
    "users/parent-user": { role: "parent", schoolId: "school", parentId: "parent", active: true },
    "users/other-parent": { role: "parent", schoolId: "school", parentId: "other", active: true },
    "classes/class": { schoolId: "school", schoolYearId: "year", name: "Classe fictive", active: true },
    "students/student": { schoolId: "school", schoolYearId: "year", classId: "class", className: "Classe fictive", status: "ACTIVE", nom: "Test", prenom: "Aline" },
    "subjects/math": { schoolId: "school", schoolYearId: "year", name: "Mathématiques" },
    "pedagogicalAssignments/assignment": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", teacherId: "teacher", active: true },
    "courseGradingConfigs/config": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", gradingSlot: "period_1", maxScore: 20 },
    "gradeEntries/grade": { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", studentId: "student", gradingSlot: "period_1", status: "graded", score: 12, maxScoreSnapshot: 20 },
    "parents/parent": { schoolId: "school", schoolYearId: "year", status: "active", studentIds: ["student"] },
    "parents/other": { schoolId: "school", schoolYearId: "year", status: "active", studentIds: [] },
  })) seed.set(db.doc(path), value);
  await seed.commit();
}, 30000);
afterAll(() => deleteApp(app), 30000);

describe("publication réelle sur l'émulateur Firestore", () => {
  it("publie une seule période atomiquement et reste idempotente en double appel", async () => {
    const [first, second] = await Promise.all([
      executeGradePublication({ db, caller: director, body: publish }),
      executeGradePublication({ db, caller: director, body: publish }),
    ]);
    expect([first.repeated, second.repeated].sort()).toEqual([false, true]);
    expect((await db.collection("gradePublicationRuns").get()).size).toBe(1);
    expect((await db.collection("publishedGradeResults").get()).size).toBe(1);
    expect((await db.collection("notifications").get()).size).toBe(1);
    const result = await executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } });
    expect(result.result.result).toMatchObject({ percentage: 60, rank: 1 });
    await expect(executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_2" } })).rejects.toMatchObject({ status: 404 });
    await expect(executeGradePublication({ db, caller: { uid: "other-parent", role: "parent", schoolId: "school" }, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
    await db.doc("parents/parent").update({ studentIds: [] });
    await expect(executeGradePublication({ db, caller: parent, body: { action: "grades-parent-read", ...scope, studentId: "student", slot: "period_1" } })).rejects.toMatchObject({ status: 403 });
  }, 30000);

  it("bloque l'année archivée sans toucher aux résultats existants", async () => {
    await db.doc("schoolYears/year").update({ status: "archived" });
    await expect(executeGradePublication({ db, caller: director, body: publish })).rejects.toMatchObject({ status: 403 });
    expect((await db.collection("gradePublicationRuns").get()).empty).toBe(true);
  });
});
