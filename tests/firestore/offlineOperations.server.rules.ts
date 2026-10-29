import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeTeacherGrading } from "../../api/_lib/teacherGrading.js";
import { syncOfflineAttendance } from "../../api/_lib/offlineAttendance.js";
import { saveManualStudent } from "../../api/_lib/manualStudentSave.js";

const projectId = `demo-offline-${randomUUID().slice(0, 8)}`;
const app = initializeApp({ projectId }, `offline-${projectId}`);
const db = getFirestore(app);
const scope = { schoolId: "school", schoolYearId: "year" };
const teacher = { uid: "teacher-user", role: "teacher", schoolId: "school" };
const director = { uid: "discipline-user", role: "discipline_director", schoolId: "school" };
const secretary = { uid: "secretary-user", role: "secretary", schoolId: "school" };
const configId = ["school", "year", "class", "math"].join("__");
const gradeId = ["school", "year", "class", "math", "student", "period_1"].join("__");
const collections = ["schools", "schoolYears", "users", "teachers", "classes", "students", "pedagogicalAssignments",
  "courseGradingConfigs", "gradeEntries", "attendance", "offlineOperationReceipts", "pedagogicalActivityLogs", "auditLogs", "notifications",
  "studentIdentityLocks", "studentMatriculeCounters"];

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Émulateur local requis.");
  const batch = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school": { status: "active", activeSchoolYearId: "year" },
    "schoolYears/year": { schoolId: "school", status: "active", name: "2027-2028" },
    "users/teacher-user": { role: "teacher", schoolId: "school", status: "active" },
    "users/discipline-user": { role: "discipline_director", schoolId: "school", status: "active", sectionIds: ["primary"] },
    "users/secretary-user": { role: "secretary", schoolId: "school", status: "active" },
    "teachers/teacher": { userId: "teacher-user", schoolId: "school", schoolYearId: "year", status: "active", fullName: "Enseignant fictif" },
    "classes/class": { schoolId: "school", schoolYearId: "year", name: "Classe fictive" },
    "students/student": { schoolId: "school", schoolYearId: "year", status: "ACTIVE", classId: "class", className: "Classe fictive", section: "primary" },
    "pedagogicalAssignments/assignment": { schoolId: "school", schoolYearId: "year", teacherId: "teacher", classId: "class", subjectId: "math", active: true },
    [`courseGradingConfigs/${configId}`]: { schoolId: "school", schoolYearId: "year", classId: "class", subjectId: "math", maxScore: 20 },
  })) batch.set(db.doc(path), value);
  await batch.commit();
}, 30000);

afterAll(async () => {
  if (!projectId.startsWith("demo-offline-") || !process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Nettoyage non local refusé.");
  for (const name of collections) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    expect((await db.collection(name).get()).empty).toBe(true);
  }
  await deleteApp(app);
}, 30000);

describe("transactions hors connexion sur Firestore réel émulé", () => {
  it("confirme une cote une seule fois puis refuse une ancienne version", async () => {
    const config = await db.doc(`courseGradingConfigs/${configId}`).get();
    const input = { action: "sync-offline-grade", ...scope, assignmentId: "assignment", classId: "class", subjectId: "math",
      studentId: "student", gradingSlot: "period_1", operationId: randomUUID(), status: "graded", score: 12,
      expectedGradeVersion: null, expectedMaximumVersion: `${config.updateTime?.seconds}:${config.updateTime?.nanoseconds}`, maximumAtCapture: 20 };
    const first = await executeTeacherGrading({ db, caller: teacher, body: input });
    expect(first).toMatchObject({ ok: true, idempotent: false, gradeId });
    expect(await executeTeacherGrading({ db, caller: teacher, body: input })).toMatchObject({ ok: true, idempotent: true, gradeId });
    expect((await db.collection("gradeEntries").get()).size).toBe(1);
    await expect(executeTeacherGrading({ db, caller: teacher, body: { ...input, operationId: randomUUID(), score: 13 } }))
      .rejects.toMatchObject({ status: 409, code: "offline-conflict" });
    await db.doc(`courseGradingConfigs/${configId}`).update({ maxScore: 25 });
    await expect(executeTeacherGrading({ db, caller: teacher, body: { ...input, operationId: randomUUID() } }))
      .rejects.toMatchObject({ status: 409, code: "offline-conflict" });
    expect((await db.doc(`gradeEntries/${gradeId}`).get()).data()?.score).toBe(12);
  }, 30000);

  it("confirme une présence une seule fois et rejette l'autre établissement", async () => {
    const input = { ...scope, operationId: randomUUID(), studentId: "student", attendanceDate: "2026-10-28",
      status: "absent", manualReason: "Contrôle fictif", expectedAttendanceVersion: null };
    const first = await syncOfflineAttendance({ db, caller: director, body: input });
    expect(first).toMatchObject({ ok: true, idempotent: false });
    expect(await syncOfflineAttendance({ db, caller: director, body: input })).toMatchObject({ ok: true, idempotent: true });
    await expect(syncOfflineAttendance({ db, caller: director, body: { ...input, operationId: randomUUID(), status: "present" } }))
      .rejects.toMatchObject({ status: 409, code: "offline-conflict" });
    await expect(syncOfflineAttendance({ db, caller: { ...director, schoolId: "other" }, body: { ...input, operationId: randomUUID() } }))
      .rejects.toMatchObject({ status: 403 });
    expect((await db.collection("attendance").get()).size).toBe(1);
  }, 30000);

  it("crée une inscription locale une fois et conserve son matricule au rejeu", async () => {
    const operationId = randomUUID();
    const body = { offlineOperationId: operationId, student: {
      id: `student-${operationId}`, schoolId: "school", schoolYearId: "year", status: "ACTIVE",
      classId: "class", className: "Classe fictive", nom: "Essai", postnom: "Local", prenom: "Alice",
      sexe: "F", birthDate: "2015-04-05",
    } };
    const first = await saveManualStudent({ db, caller: secretary, body });
    expect(first).toMatchObject({ idempotent: false, student: { id: body.student.id, matricule: "ACD-27-0002" } });
    expect(await saveManualStudent({ db, caller: secretary, body })).toMatchObject({ idempotent: true,
      student: { id: body.student.id, matricule: first.student.matricule } });
    expect((await db.collection("students").get()).size).toBe(2);
    await expect(saveManualStudent({ db, caller: secretary, body: { ...body, student: { ...body.student, id: `student-${randomUUID()}` } } }))
      .rejects.toMatchObject({ statusCode: 400 });
  }, 30000);
});
