import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
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
function assignmentLock(payload: Record<string, unknown>) {
  const id = `${payload.schoolId}__${payload.schoolYearId}__${payload.subjectId}__${payload.classId}`;
  return { id, schoolId: payload.schoolId, schoolYearId: payload.schoolYearId, subjectId: payload.subjectId, classId: payload.classId, teacherId: payload.teacherId, assignmentId: payload.id, updatedAt: now, updatedBy: payload.updatedBy };
}
function createActiveAssignment(database: ReturnType<typeof director>, overrides: Record<string, unknown> = {}) {
  const payload = assignment(overrides);
  const lock = assignmentLock(payload);
  const batch = writeBatch(database);
  batch.set(doc(database, "pedagogicalAssignments", String(payload.id)), payload);
  batch.set(doc(database, "pedagogicalAssignmentLocks", String(lock.id)), lock);
  return batch.commit();
}

beforeAll(async () => { environment = await initializeTestEnvironment({ projectId: "demo-acadea-study-assignments", firestore: { rules: readFileSync("firestore.rules", "utf8") } }); }, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${school}`, { id: school, status: "active" });
  await seed("schools/school-b", { id: "school-b", status: "active" });
  await seed(`schoolYears/${year}`, { id: year, schoolId: school, status: "active" });
  await seed("schoolYears/year-b", { id: "year-b", schoolId: "school-b", status: "active" });
  await seed("teachers/teacher-a", { id: "teacher-a", schoolId: school, schoolYearId: year, status: "active", createdBy: "director-a", createdAt: now });
  await seed("teachers/teacher-b", { id: "teacher-b", schoolId: school, schoolYearId: year, status: "active", createdBy: "director-a", createdAt: now });
  await seed("subjects/subject-a", { id: "subject-a", schoolId: school, schoolYearId: year, name: "Mathématiques", active: true, createdBy: "director-a", createdAt: now });
  await seed("subjects/subject-b", { id: "subject-b", schoolId: school, schoolYearId: year, name: "Français", active: true, createdBy: "director-a", createdAt: now });
  await seed("classes/class-a", { id: "class-a", schoolId: school, schoolYearId: year, name: "4e A", active: true });
  await seed("classes/class-c", { id: "class-c", schoolId: school, schoolYearId: year, name: "4e C", active: true });
  await seed("rooms/room-a", { id: "room-a", schoolId: school, schoolYearId: year, name: "Salle A", active: true, createdBy: "director-a", createdAt: now, updatedAt: now });
  await seed("rooms/room-b", { id: "room-b", schoolId: "school-b", schoolYearId: "year-b", name: "Salle B", active: true, createdBy: "director-b", createdAt: now, updatedAt: now });
});
afterAll(async () => environment?.cleanup(), 30_000);

describe("Direction des études — affectations pédagogiques", () => {
  it("autorise le Directeur des études de la même école et année", async () => {
    await assertSucceeds(createActiveAssignment(director()));
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
  it("crée atomiquement une classe legacy tenantée et son affectation", async () => {
    const database = director();
    const legacyClassId = `${school}__${year}__2eme-humanite`;
    const legacyAssignmentId = `${school}__${year}__teacher-a__subject-a__${legacyClassId}`;
    const batch = writeBatch(database);
    batch.set(doc(database, "classes", legacyClassId), { id: legacyClassId, schoolId: school, schoolYearId: year, name: "2ème Humanité", active: true, createdBy: "director-a", createdAt: now, updatedAt: now });
    const payload = assignment({ id: legacyAssignmentId, classId: legacyClassId });
    const lock = assignmentLock(payload);
    batch.set(doc(database, "pedagogicalAssignments", legacyAssignmentId), payload);
    batch.set(doc(database, "pedagogicalAssignmentLocks", String(lock.id)), lock);
    await assertSucceeds(batch.commit());
  });
  it("conserve le refus du payload legacy élargi qui provoquait le permission-denied Staging", async () => {
    const legacyClassId = `${school}__${year}__legacy-expanded`;
    await assertFails(setDoc(doc(director(), "classes", legacyClassId), { id: legacyClassId, schoolId: school, schoolYearId: year, name: "Classe legacy", section: null, option: null, parentClassId: null, classOptionKey: null, active: true, createdBy: "director-a", createdAt: now, updatedAt: now }));
  });
  it("crée atomiquement une classe legacy, son affectation et sa titularité", async () => {
    const database = director();
    const legacyClassId = `${school}__${year}__3eme-humanite`;
    const legacyAssignmentId = `${school}__${year}__teacher-a__subject-a__${legacyClassId}`;
    const titularId = `${school}__${year}__${legacyClassId}`;
    const batch = writeBatch(database);
    batch.set(doc(database, "classes", legacyClassId), { id: legacyClassId, schoolId: school, schoolYearId: year, name: "3ème Humanité", active: true, createdBy: "director-a", createdAt: now, updatedAt: now });
    const assignmentPayload = assignment({ id: legacyAssignmentId, classId: legacyClassId, titularClassId: legacyClassId });
    const lock = assignmentLock(assignmentPayload);
    batch.set(doc(database, "pedagogicalAssignments", legacyAssignmentId), assignmentPayload);
    batch.set(doc(database, "pedagogicalAssignmentLocks", String(lock.id)), lock);
    batch.set(doc(database, "classTitulars", titularId), { id: titularId, schoolId: school, schoolYearId: year, classId: legacyClassId, teacherId: "teacher-a", assignmentId: legacyAssignmentId, active: true, updatedAt: now, updatedBy: "director-a" });
    await assertSucceeds(batch.commit());
  });
  it("refuse une classe legacy non tenantée ou d'une autre école", async () => {
    await assertFails(setDoc(doc(director(), "classes", "legacy-class__2eme-humanite"), { id: "legacy-class__2eme-humanite", schoolId: school, schoolYearId: year, name: "2ème Humanité", active: true, createdBy: "director-a", createdAt: now, updatedAt: now }));
    await assertFails(setDoc(doc(director(), "classes", `${school}__${year}__foreign`), { id: `${school}__${year}__foreign`, schoolId: "school-b", schoolYearId: "year-b", name: "Classe étrangère", active: true, createdBy: "director-a", createdAt: now, updatedAt: now }));
  });
  it("refuse les périodes nulles, négatives ou excessives", async () => {
    for (const weeklyPeriods of [0, -1, 61]) await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ weeklyPeriods })));
  });
  it("accepte une salle préférée active du périmètre et refuse une salle inconnue ou d'une autre école", async () => {
    await assertSucceeds(createActiveAssignment(director(), { preferredRoomId: "room-a" }));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ preferredRoomId: "unknown" })));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ preferredRoomId: "room-b" })));
  });
  it("accepte une classe de titulariat du périmètre et refuse une classe inconnue ou d'une autre école", async () => {
    await assertSucceeds(createActiveAssignment(director(), { titularClassId: "class-a" }));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ titularClassId: "unknown" })));
    await seed("classes/class-b", { id: "class-b", schoolId: "school-b", schoolYearId: "year-b", name: "Classe B", active: true });
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ titularClassId: "class-b" })));
  });
  it("refuse une classe de titulariat archivée", async () => {
    await seed("classes/class-archived", { id: "class-archived", schoolId: school, schoolYearId: year, name: "Classe archivée", active: false });
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", assignmentId), assignment({ titularClassId: "class-archived" })));
  });
  it("réserve un seul titulaire par identifiant déterministe de classe", async () => {
    await seed(`pedagogicalAssignments/${assignmentId}`, assignment({ titularClassId: "class-a" }));
    const titularId = `${school}__${year}__class-a`;
    const payload = { id: titularId, schoolId: school, schoolYearId: year, classId: "class-a", teacherId: "teacher-a", assignmentId, active: true, updatedAt: now, updatedBy: "director-a" };
    await assertSucceeds(setDoc(doc(director(), "classTitulars", titularId), payload));
    await assertFails(setDoc(doc(director(), "classTitulars", `${titularId}-duplicate`), { ...payload, id: `${titularId}-duplicate` }));
  });
  it("autorise plusieurs classes pour le même titulaire sans permettre de voler une classe", async () => {
    const database = director();
    const first = assignment();
    const secondId = `${school}__${year}__teacher-a__subject-a__class-c`;
    const second = assignment({ id: secondId, classId: "class-c" });
    const assignmentBatch = writeBatch(database);
    for (const payload of [first, second]) {
      const lock = assignmentLock(payload);
      assignmentBatch.set(doc(database, "pedagogicalAssignments", String(payload.id)), payload);
      assignmentBatch.set(doc(database, "pedagogicalAssignmentLocks", String(lock.id)), lock);
    }
    await assertSucceeds(assignmentBatch.commit());
    const firstTitularId = `${school}__${year}__class-a`;
    const secondTitularId = `${school}__${year}__class-c`;
    const titularBatch = writeBatch(database);
    titularBatch.set(doc(database, "classTitulars", firstTitularId), { id: firstTitularId, schoolId: school, schoolYearId: year, classId: "class-a", teacherId: "teacher-a", assignmentId, active: true, updatedAt: now, updatedBy: "director-a" });
    titularBatch.set(doc(database, "classTitulars", secondTitularId), { id: secondTitularId, schoolId: school, schoolYearId: year, classId: "class-c", teacherId: "teacher-a", assignmentId: secondId, active: true, updatedAt: now, updatedBy: "director-a" });
    await assertSucceeds(titularBatch.commit());
    await assertSucceeds(getDoc(doc(database, "classTitulars", firstTitularId)));
    await assertFails(updateDoc(doc(database, "classTitulars", firstTitularId), { teacherId: "teacher-b" }));
    await assertSucceeds(deleteDoc(doc(database, "classTitulars", secondTitularId)));
  });
  it("empêche un doublon actif par identifiant déterministe", async () => {
    await assertSucceeds(createActiveAssignment(director()));
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", `${assignmentId}-duplicate`), assignment({ id: `${assignmentId}-duplicate` })));
  });
  it("autorise la modification et la désactivation tout en conservant le verrou historique", async () => {
    const database = director("director-update");
    await assertSucceeds(createActiveAssignment(database, { createdBy: "director-update", updatedBy: "director-update" }));
    const lockId = `${school}__${year}__subject-a__class-a`;
    await assertSucceeds(updateDoc(doc(database, "pedagogicalAssignments", assignmentId), { weeklyPeriods: 6, active: false, updatedAt: "2026-08-10T10:00:00.000Z" }));
    await assertSucceeds(getDoc(doc(database, "pedagogicalAssignmentLocks", lockId)));
    await assertFails(deleteDoc(doc(database, "pedagogicalAssignmentLocks", lockId)));
    await assertFails(updateDoc(doc(database, "pedagogicalAssignments", assignmentId), { teacherId: "teacher-b" }));
  });
  it("refuse deux enseignants actifs pour le même cours et la même classe", async () => {
    const database = director();
    await assertSucceeds(createActiveAssignment(database));
    const secondId = `${school}__${year}__teacher-b__subject-a__class-a`;
    await assertFails(createActiveAssignment(database, { id: secondId, teacherId: "teacher-b" }));
  });
  it("autorise le même cours dans une autre classe et un autre cours dans la même classe", async () => {
    const database = director();
    await assertSucceeds(createActiveAssignment(database));
    const otherClassId = `${school}__${year}__teacher-b__subject-a__class-c`;
    await assertSucceeds(createActiveAssignment(database, { id: otherClassId, teacherId: "teacher-b", classId: "class-c" }));
    const otherSubjectId = `${school}__${year}__teacher-b__subject-b__class-a`;
    await assertSucceeds(createActiveAssignment(database, { id: otherSubjectId, teacherId: "teacher-b", subjectId: "subject-b" }));
  });
  it("résout deux créations concurrentes par une seule affectation active", async () => {
    const database = director();
    const secondId = `${school}__${year}__teacher-b__subject-a__class-a`;
    const results = await Promise.allSettled([
      createActiveAssignment(database),
      createActiveAssignment(database, { id: secondId, teacherId: "teacher-b" }),
    ]);
    if (results.filter((result) => result.status === "fulfilled").length !== 1) throw new Error("Une seule création concurrente doit réussir.");
    const active = await getDocs(query(collection(database, "pedagogicalAssignments"), where("schoolId", "==", school), where("schoolYearId", "==", year), where("active", "==", true)));
    if (active.size !== 1) throw new Error("Une seule affectation active doit subsister.");
  });
  it("autorise une nouvelle affectation après désactivation atomique de l’historique", async () => {
    const database = director();
    await assertSucceeds(createActiveAssignment(database));
    const secondId = `${school}__${year}__teacher-b__subject-a__class-a`;
    const second = assignment({ id: secondId, teacherId: "teacher-b" });
    const lock = assignmentLock(second);
    const batch = writeBatch(database);
    batch.update(doc(database, "pedagogicalAssignments", assignmentId), { active: false, updatedAt: now });
    batch.set(doc(database, "pedagogicalAssignments", secondId), second);
    batch.set(doc(database, "pedagogicalAssignmentLocks", String(lock.id)), lock);
    await assertSucceeds(batch.commit());
  });
  it("refuse une nouvelle affectation lorsque le compte Enseignant lié est archivé", async () => {
    await seed("teachers/teacher-archived", { id: "teacher-archived", userId: "user-archived", schoolId: school, schoolYearId: year, status: "active", createdBy: "director-a", createdAt: now });
    await seed("users/user-archived", { id: "user-archived", role: "teacher", schoolId: school, status: "inactive", active: false });
    const id = `${school}__${year}__teacher-archived__subject-a__class-a`;
    await assertFails(setDoc(doc(director(), "pedagogicalAssignments", id), assignment({ id, teacherId: "teacher-archived" })));
  });
});
