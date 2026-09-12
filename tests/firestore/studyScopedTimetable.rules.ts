import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolId = "school-a";
const schoolYearId = "year-a";
const userId = "director-a";
const assignmentId = "assignment-a";
const targets = ["class-a::commerciale", "class-a::scientifique"];
const studentGroupKey = "common--class-a%3A%3Acommerciale--class-a%3A%3Ascientifique";
const now = "2026-09-12T10:00:00.000Z";
const database = () => environment.authenticatedContext(userId, { role: "study_director", schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-scoped-timetable", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${schoolId}`, { id: schoolId, status: "active" });
  await seed(`schoolYears/${schoolYearId}`, { id: schoolYearId, schoolId, status: "active" });
  await seed("teachers/teacher-a", { id: "teacher-a", schoolId, schoolYearId, status: "active" });
  await seed("subjects/subject-a", { id: "subject-a", schoolId, schoolYearId, active: true });
  await seed("classes/class-a", { id: "class-a", schoolId, schoolYearId, name: "3ème Humanité", active: true });
  await seed("schedulePeriods/period-a", { id: "period-a", schoolId, schoolYearId, type: "course", active: true });
  await seed(`pedagogicalAssignments/${assignmentId}`, { id: assignmentId, schoolId, schoolYearId, teacherId: "teacher-a", subjectId: "subject-a", classId: "class-a", courseScope: "common", targetOptionIds: targets, studentGroupKey, active: true });
});
afterAll(async () => environment?.cleanup(), 30_000);

function timetable() {
  return { id: "schedule-a", schoolId, schoolYearId, version: 1, status: "DRAFT", activeDraft: true, createdBy: userId, createdAt: now, updatedAt: now, generationMetadata: { algorithm: "deterministic-backtracking", exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2 } };
}
function entry(overrides: Record<string, unknown> = {}) {
  return { id: "entry-a", scheduleId: "schedule-a", schoolId, schoolYearId, classId: "class-a", teacherId: "teacher-a", subjectId: "subject-a", assignmentId, courseScope: "common", targetOptionIds: targets, studentGroupKey, dayOfWeek: "monday", periodId: "period-a", roomId: null, createdAt: now, updatedAt: now, ...overrides };
}

describe("horaire des groupes d'options", () => {
  it("persiste exactement la portée de l'affectation", async () => {
    const db = database();
    const batch = writeBatch(db);
    batch.set(doc(db, "timetables", "schedule-a"), timetable());
    batch.set(doc(db, "timetableEntries", "entry-a"), entry());
    await assertSucceeds(batch.commit());
  });
  it("refuse une portée d'entrée différente de l'affectation", async () => {
    await seed("timetables/schedule-a", timetable());
    await assertFails(setDoc(doc(database(), "timetableEntries", "entry-a"), entry({ targetOptionIds: ["class-a::litteraire", "class-a::pedagogie"] })));
  });
});
