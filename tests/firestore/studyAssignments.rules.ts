import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const school = "school-a";
const year = "year-a";
const assignmentId = `${school}__${year}__teacher-a__subject-a__class-a`;
const now = "2026-08-09T12:00:00.000Z";

function director(uid = "director-a", tenant = school) { return environment.authenticatedContext(uid, { role: "study_director", schoolId: tenant }).firestore(); }
function actor(role: string) { return environment.authenticatedContext(`${role}-a`, { role, schoolId: school }).firestore(); }
async function seed(path: string, data: Record<string, unknown>) { await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data)); }
function assignment(overrides: Record<string, unknown> = {}) { return { id: assignmentId, schoolId: school, schoolYearId: year, teacherId: "teacher-a", subjectId: "subject-a", classId: "class-a", weeklyPeriods: 4, active: true, createdAt: now, updatedAt: now, createdBy: "director-a", updatedBy: "director-a", ...overrides }; }

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-study-assignments", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${school}`, { id: school, status: "active" });
  await seed("schools/school-b", { id: "school-b", status: "active" });
  await seed(`schoolYears/${year}`, { id: year, schoolId: school, status: "active" });
  await seed("schoolYears/year-b", { id: "year-b", schoolId: "school-b", status: "active" });
  await seed("teachers/teacher-a", { id: "teacher-a", schoolId: school, schoolYearId: year, status: "active", createdBy: "director-a", createdAt: now });
  await seed("subjects/subject-a", { id: "subject-a", schoolId: school, schoolYearId: year, name: "Mathématiques", active: true, createdBy: "director-a", createdAt: now });
  await seed("classes/class-a", { id: "class-a", schoolId: school, schoolYearId: year, name: "4e A", active: true });
  await seed("rooms/room-a", { id: "room-a", schoolId: school, schoolYearId: year, name: "Salle A", active: true, createdBy: "director-a", createdAt: now, updatedAt: now });
  await seed("rooms/room-b", { id: "room-b", schoolId: "school-b", schoolYearId: "year-b", name: "Salle B", active: true, createdBy: "director-b", createdAt: now, updatedAt: now });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("Direction des études — affectations pédagogiques", () => {
  it("autorise le Directeur des études de la même école et année", async () => {
    await assertSucceeds(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment()));
    await assertSucceeds(getDocs(query(collection(director(), "pedagogicalAssignments"), where("schoolId", "==", school), where("schoolYearId", "==", year))));
  });
  it("refuse les autres rôles et les autres écoles", async () => {
    await assertFails(setDoc(doc(actor("cashier"), "pedagogicalAssignments", assignmentId), assignment({ createdBy: "cashier-a", updatedBy: "cashier-a" })));
    await assertFails(setDoc(doc(director("director-b", "school-b"), "pedagogicalAssignments", assignmentId), assignment({ createdBy: "director-b", updatedBy: "director-b" })));
    await assertFails(getDoc(doc(actor("cashier"), "subjects", "subject-a")));
  });
  it("refuse une année, une matière ou une classe hors périmètre", async () => {
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ schoolYearId: "year-b" })));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ subjectId: "unknown" })));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ classId: "unknown" })));
  });
  it("refuse les périodes nulles, négatives ou excessives", async () => {
    for (const weeklyPeriods of [0, -1, 61]) await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ weeklyPeriods })));
  });
  it("accepte une salle préférée active du périmètre et refuse une salle inconnue ou d'une autre école", async () => {
    await assertSucceeds(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ preferredRoomId: "room-a" })));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ preferredRoomId: "unknown" })));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ preferredRoomId: "room-b" })));
  });
  it("empêche un doublon actif par identifiant déterministe", async () => {
    await assertSucceeds(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment()));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", `${assignmentId}-duplicate`), assignment({ id: `${assignmentId}-duplicate` })));
  });
  it("autorise la modification et la désactivation sans changer les références", async () => {
    await assertSucceeds(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment()));
    await assertSucceeds(updateDoc(doc(director(), "pedagogicalAssignments", assignmentId), { weeklyPeriods: 6, active: false, updatedAt: "2026-08-10T10:00:00.000Z" }));
    await assertFails(updateDoc(doc(director(), "pedagogicalAssignments", assignmentId), { teacherId: "teacher-b" }));
  });
  it("refuse une nouvelle affectation lorsque le compte Enseignant lié est archivé", async () => {
    await seed("teachers/teacher-archived", { id: "teacher-archived", userId: "user-archived", schoolId: school, schoolYearId: year, status: "active", createdBy: "director-a", createdAt: now });
    await seed("users/user-archived", { id: "user-archived", role: "teacher", schoolId: school, status: "inactive", active: false });
    const id = `${school}__${year}__teacher-archived__subject-a__class-a`;
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", id), assignment({ id, teacherId: "teacher-archived" })));
  });
});
