import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "@firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-a";
const schoolYearId = "year-a";
const userId = "teacher-user-a";
const teacherId = "teacher-a";
const now = "2026-08-10T08:00:00.000Z";

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

const teacherDb = (uid = userId, school = schoolId) => environment.authenticatedContext(uid, { role: "teacher", schoolId: school }).firestore();

describe("portail Enseignant Phase 3", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-teacher-portal", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);

  beforeEach(async () => {
    await environment.clearFirestore();
    await seed(`schools/${schoolId}`, { id: schoolId, status: "active" });
    await seed(`schoolYears/${schoolYearId}`, { id: schoolYearId, schoolId, status: "active" });
    await seed(`users/${userId}`, { id: userId, role: "teacher", schoolId, status: "active", active: true });
    await seed(`users/teacher-user-inactive`, { id: "teacher-user-inactive", role: "teacher", schoolId, status: "inactive", active: false });
    await seed(`teachers/${teacherId}`, { id: teacherId, userId, schoolId, schoolYearId, status: "active" });
    await seed("teachers/teacher-other", { id: "teacher-other", userId: "teacher-user-other", schoolId, schoolYearId, status: "active" });
    await seed("subjects/subject-a", { id: "subject-a", schoolId, schoolYearId, name: "Mathématiques", active: true });
    await seed("classes/class-a", { id: "class-a", schoolId, schoolYearId, name: "1re A", active: true });
    await seed("rooms/room-a", { id: "room-a", schoolId, schoolYearId, name: "Salle A", active: true });
    await seed("schedulePeriods/period-a", { id: "period-a", schoolId, schoolYearId, label: "P1", order: 1, active: true });
    await seed("pedagogicalAssignments/assignment-a", { id: "assignment-a", schoolId, schoolYearId, teacherId, subjectId: "subject-a", classId: "class-a", weeklyPeriods: 4, active: true });
    await seed("pedagogicalAssignments/assignment-other", { id: "assignment-other", schoolId, schoolYearId, teacherId: "teacher-other", subjectId: "subject-a", classId: "class-a", weeklyPeriods: 2, active: true });
    await seed("timetables/published", { id: "published", schoolId, schoolYearId, version: 1, status: "PUBLISHED", activeDraft: false, activePublished: true, createdBy: "director", createdAt: now, updatedAt: now });
    await seed("timetables/draft", { id: "draft", schoolId, schoolYearId, version: 2, status: "DRAFT", activeDraft: true, activePublished: false, createdBy: "director", createdAt: now, updatedAt: now });
    await seed("timetables/inactive", { id: "inactive", schoolId, schoolYearId, version: 3, status: "PUBLISHED", activeDraft: false, activePublished: false, createdBy: "director", createdAt: now, updatedAt: now });
    await seed("timetableEntries/entry-a", { id: "entry-a", scheduleId: "published", schoolId, schoolYearId, teacherId, subjectId: "subject-a", classId: "class-a", assignmentId: "assignment-a", dayOfWeek: "monday", periodId: "period-a", roomId: "room-a", createdAt: now, updatedAt: now });
    await seed("timetableEntries/entry-other", { id: "entry-other", scheduleId: "published", schoolId, schoolYearId, teacherId: "teacher-other", subjectId: "subject-a", classId: "class-a", assignmentId: "assignment-other", dayOfWeek: "monday", periodId: "period-a", roomId: "room-a", createdAt: now, updatedAt: now });
  });

  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise uniquement le profil et les affectations propres", async () => {
    const database = teacherDb();
    await assertSucceeds(getDocs(query(collection(database, "teachers"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId), where("userId", "==", userId))));
    await assertFails(getDoc(doc(database, "teachers", "teacher-other")));
    await assertSucceeds(getDocs(query(collection(database, "pedagogicalAssignments"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId), where("teacherId", "==", teacherId), where("active", "==", true))));
    await assertFails(getDoc(doc(database, "pedagogicalAssignments", "assignment-other")));
  });

  it("autorise uniquement l'horaire PUBLISHED actif et les entrées propres", async () => {
    const database = teacherDb();
    await assertSucceeds(getDoc(doc(database, "timetables", "published")));
    await assertFails(getDoc(doc(database, "timetables", "draft")));
    await assertFails(getDoc(doc(database, "timetables", "inactive")));
    await assertSucceeds(getDoc(doc(database, "timetableEntries", "entry-a")));
    await assertFails(getDoc(doc(database, "timetableEntries", "entry-other")));
  });

  it("refuse l'autre école, le compte inactif et les écritures", async () => {
    await assertFails(getDoc(doc(teacherDb(userId, "school-b"), "teachers", teacherId)));
    await assertFails(getDoc(doc(teacherDb("teacher-user-inactive"), "teachers", teacherId)));
    await assertFails(updateDoc(doc(teacherDb(), "pedagogicalAssignments", "assignment-a"), { weeklyPeriods: 8 }));
    await assertFails(setDoc(doc(teacherDb(), "timetableEntries", "new-entry"), { schoolId, schoolYearId, teacherId }));
  });

  it("autorise les référentiels strictement dans l'école", async () => {
    const database = teacherDb();
    for (const path of ["subjects/subject-a", "classes/class-a", "rooms/room-a", "schedulePeriods/period-a", `schoolYears/${schoolYearId}`, `schools/${schoolId}`]) {
      await assertSucceeds(getDoc(doc(database, path)));
    }
  });
});
