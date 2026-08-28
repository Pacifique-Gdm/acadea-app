import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, documentId, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const coordinationId = "coord-a";
const schoolA = "school-a";
const schoolB = "school-b";
const schoolC = "school-c";

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

function database(uid: string, coordination = coordinationId) {
  return environment.authenticatedContext(uid, { role: "coordination_admin", coordinationId: coordination }).firestore();
}

function subDatabase(uid = "sub-user", subCoordinationId = "sub-a", coordination = coordinationId) {
  return environment.authenticatedContext(uid, { role: "sub_coordination_admin", coordinationId: coordination, subCoordinationId }).firestore();
}

describe("SEC — isolation Coordination", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-coordination", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    await seed(`coordinations/${coordinationId}`, { id: coordinationId, status: "active", name: "Coordination A", principalCoordinatorUserId: "coord-user" });
    await seed(`coordinationSchools/${coordinationId}__${schoolA}`, { id: `${coordinationId}__${schoolA}`, coordinationId, schoolId: schoolA, active: true });
    await seed(`coordinationSchools/${coordinationId}__${schoolB}`, { id: `${coordinationId}__${schoolB}`, coordinationId, schoolId: schoolB, active: false });
    await seed(`coordinationSchools/${coordinationId}__${schoolC}`, { id: `${coordinationId}__${schoolC}`, coordinationId, schoolId: schoolC, active: true });
    await seed(`schools/${schoolA}`, { id: schoolA, name: "École A", status: "active", activeCoordinationId: coordinationId, activeSchoolYearId: "year-a" });
    await seed(`schools/${schoolB}`, { id: schoolB, name: "École B", status: "active" });
    await seed(`schools/${schoolC}`, { id: schoolC, name: "École C", status: "active", activeCoordinationId: coordinationId, activeSchoolYearId: "year-c" });
    await seed("schoolYears/year-a", { id: "year-a", schoolId: schoolA, name: "2026-2027", status: "active" });
    await seed("schoolYears/year-b", { id: "year-b", schoolId: schoolB, name: "2026-2027", status: "active" });
    await seed("schoolYears/year-c", { id: "year-c", schoolId: schoolC, name: "2026-2027", status: "active" });
    await seed("students/student-a", { id: "student-a", schoolId: schoolA, firstName: "A" });
    await seed("students/student-b", { id: "student-b", schoolId: schoolB, firstName: "B" });
    await seed("students/student-c", { id: "student-c", schoolId: schoolC, firstName: "C" });
    await seed("subCoordinations/sub-a", { id: "sub-a", coordinationId, coordinatorUserId: "sub-user", circumscription: "Commune de Gombe", status: "active", active: true });
    await seed("subCoordinationSchools/sub-a__school-a", { id: "sub-a__school-a", coordinationId, subCoordinationId: "sub-a", schoolId: schoolA, active: true });
    await seed("users/sub-user", { id: "sub-user", role: "sub_coordination_admin", coordinationId, subCoordinationId: "sub-a", active: true });
    await seed("users/coord-user", { id: "coord-user", role: "coordination_admin", coordinationId, active: true });
    await seed("coordinations/coord-other", { id: "coord-other", status: "active", principalCoordinatorUserId: "coord-foreign" });
    await seed("users/coord-foreign", { id: "coord-foreign", role: "coordination_admin", coordinationId: "coord-other", active: true });
    await seed("feeTypes/fee-a", { id: "fee-a", schoolId: schoolA, schoolYearId: "year-a", name: "Minerval", amount: 10 });
    await seed("payments/payment-a", { id: "payment-a", schoolId: schoolA, schoolYearId: "year-a", amount: 10 });
    await seed("expenses/expense-a", { id: "expense-a", schoolId: schoolA, schoolYearId: "year-a", amount: 2 });
    await seed("users/admin-a", { id: "admin-a", schoolId: schoolA, role: "school_admin", active: true });
    await seed("teachers/teacher-a", { id: "teacher-a", schoolId: schoolA, schoolYearId: "year-a", userId: "teacher-user-a" });
    await seed("gradeEntries/grade-a", { id: "grade-a", schoolId: schoolA, schoolYearId: "year-a", studentId: "student-a", classId: "class-a", subjectId: "subject-a" });
    await seed("timetables/timetable-a", { id: "timetable-a", schoolId: schoolA, schoolYearId: "year-a", status: "draft" });
    await seed("notifications/notification-coordinator", { id: "notification-coordinator", schoolId: schoolA, schoolYearId: "year-a", recipientUserId: "coord-user", type: "message", read: false });
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise uniquement l'école rattachée activement", async () => {
    const db = database("coord-a");
    await assertSucceeds(getDoc(doc(db, "schools", schoolA)));
    await assertSucceeds(getDoc(doc(db, "students", "student-a")));
    await assertFails(getDoc(doc(db, "schools", schoolB)));
    await assertFails(getDoc(doc(db, "students", "student-b")));
    await assertSucceeds(getDocs(query(collection(db, "students"), where("schoolId", "in", [schoolA]))));
    await assertSucceeds(getDocs(query(collection(db, "schools"), where(documentId(), "in", [schoolA]))));
  });

  it("refuse les mutations métier et les écoles indépendantes", async () => {
    const db = database("coord-a");
    await assertFails(setDoc(doc(db, "students", "student-a"), { id: "student-a", schoolId: schoolA }));
    await assertFails(setDoc(doc(db, "teachers", "teacher-a"), { schoolId: schoolA, schoolYearId: "year-a" }, { merge: true }));
    await assertFails(setDoc(doc(db, "users", "admin-a"), { name: "Altéré" }, { merge: true }));
    await assertFails(setDoc(doc(db, "gradeEntries", "grade-a"), { score: 20 }, { merge: true }));
    await assertFails(setDoc(doc(db, "timetables", "timetable-a"), { status: "published" }, { merge: true }));
    await assertFails(setDoc(doc(db, "schools", schoolA), { name: "Altérée" }, { merge: true }));
    await assertFails(setDoc(doc(db, "messages", "message-direct"), { schoolId: schoolA, schoolYearId: "year-a", senderId: "coord-a", participantIds: ["coord-a", "admin-a"] }));
    await assertFails(setDoc(doc(db, "notifications", "notification-direct"), { schoolId: schoolA, schoolYearId: "year-a", recipientUserId: "admin-a" }));
    await assertFails(setDoc(doc(db, "schoolYears", "year-direct"), { id: "year-direct", schoolId: schoolA, name: "2027-2028", status: "active" }));
    await assertFails(getDoc(doc(db, "schools", "school-d")));
  });

  it("autorise les vues de consultation et refuse leurs mutations", async () => {
    const db = database("coord-a");
    for (const [name, id] of [["feeTypes", "fee-a"], ["payments", "payment-a"], ["expenses", "expense-a"], ["users", "admin-a"], ["schoolYears", "year-a"]] as const) await assertSucceeds(getDoc(doc(db, name, id)));
    for (const name of ["feeTypes", "payments", "expenses", "users", "schoolYears"] as const) {
      await assertSucceeds(getDocs(query(collection(db, name), where("schoolId", "in", [schoolA]))));
      await assertFails(getDocs(query(collection(db, name), where("schoolId", "in", [schoolB]))));
    }
    await assertFails(setDoc(doc(db, "feeTypes", "fee-a"), { schoolId: schoolA, amount: 20 }, { merge: true }));
    await assertFails(setDoc(doc(db, "payments", "payment-a"), { schoolId: schoolA, amount: 20 }, { merge: true }));
    await assertFails(setDoc(doc(db, "expenses", "expense-a"), { schoolId: schoolA, amount: 20 }, { merge: true }));
  });

  it("verrouille l'année d'une école coordonnée et préserve l'école indépendante", async () => {
    const coordinatedAdmin = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId: schoolA }).firestore();
    const independentAdmin = environment.authenticatedContext("admin-b", { role: "school_admin", schoolId: schoolB }).firestore();
    await assertFails(setDoc(doc(coordinatedAdmin, "schoolYears", "year-a"), { status: "archived" }, { merge: true }));
    await assertFails(setDoc(doc(coordinatedAdmin, "schools", schoolA), { activeSchoolYearId: "other" }, { merge: true }));
    await assertSucceeds(setDoc(doc(independentAdmin, "schoolYears", "year-b"), { status: "draft" }, { merge: true }));
  });

  it("rend automatiquement l'autonomie à l'école après son retrait", async () => {
    const coordinatedAdmin = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId: schoolA }).firestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "coordinationSchools", `${coordinationId}__${schoolA}`), { active: false }, { merge: true });
      await setDoc(doc(context.firestore(), "schools", schoolA), { activeCoordinationId: null }, { merge: true });
    });
    await assertSucceeds(setDoc(doc(coordinatedAdmin, "schoolYears", "year-a"), { status: "archived" }, { merge: true }));
    await assertSucceeds(setDoc(doc(coordinatedAdmin, "schools", schoolA), { activeSchoolYearId: "" }, { merge: true }));
  });

  it("limite le Sous-coordinateur aux seules écoles activement déléguées", async () => {
    const db = subDatabase();
    await assertSucceeds(getDoc(doc(db, "coordinations", coordinationId)));
    await assertSucceeds(getDoc(doc(db, "subCoordinations", "sub-a")));
    await assertSucceeds(getDoc(doc(db, "schools", schoolA)));
    await assertSucceeds(getDoc(doc(db, "students", "student-a")));
    await assertFails(getDoc(doc(db, "schools", schoolC)));
    await assertFails(getDoc(doc(db, "students", "student-c")));
    await assertSucceeds(getDocs(query(collection(db, "students"), where("schoolId", "in", [schoolA]))));
    await assertSucceeds(getDocs(query(collection(db, "schools"), where(documentId(), "in", [schoolA]))));
    await assertFails(getDocs(query(collection(db, "students"), where("schoolId", "in", [schoolC]))));
  });

  it("refuse au Sous-coordinateur toutes les mutations métier et annuelles", async () => {
    const db = subDatabase();
    await assertFails(setDoc(doc(db, "students", "student-a"), { schoolId: schoolA, firstName: "Altéré" }, { merge: true }));
    await assertFails(setDoc(doc(db, "payments", "payment-a"), { amount: 99 }, { merge: true }));
    await assertFails(setDoc(doc(db, "schoolYears", "year-a"), { status: "archived" }, { merge: true }));
    await assertFails(setDoc(doc(db, "subCoordinationSchools", "sub-a__school-a"), { active: false }, { merge: true }));
  });

  it("retire immédiatement l'accès quand la relation devient inactive", async () => {
    const db = subDatabase();
    await assertSucceeds(getDoc(doc(db, "students", "student-a")));
    await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), "subCoordinationSchools", "sub-a__school-a"), { active: false }, { merge: true }));
    await assertFails(getDoc(doc(db, "students", "student-a")));
  });

  it("refuse une autre Coordination même avec un subCoordinationId ressemblant", async () => {
    const db = subDatabase("sub-user", "sub-a", "coord-other");
    await assertFails(getDoc(doc(db, "schools", schoolA)));
    await assertFails(getDoc(doc(db, "subCoordinations", "sub-a")));
  });

  it("expose à l'Administrateur uniquement les Coordinateurs reliés à son école", async () => {
    const db = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId: schoolA }).firestore();
    await assertSucceeds(getDoc(doc(db, "coordinations", coordinationId)));
    await assertSucceeds(getDoc(doc(db, "users", "coord-user")));
    await assertSucceeds(getDoc(doc(db, "users", "sub-user")));
    await assertSucceeds(getDoc(doc(db, "subCoordinations", "sub-a")));
    await assertSucceeds(getDocs(query(collection(db, "subCoordinationSchools"), where("schoolId", "==", schoolA), where("coordinationId", "==", coordinationId))));
    await assertFails(getDoc(doc(db, "coordinations", "coord-other")));
    await assertFails(getDoc(doc(db, "users", "coord-foreign")));
  });

  it("permet au Coordinateur de marquer sa notification comme lue sans autre mutation", async () => {
    const db = database("coord-user");
    await assertSucceeds(getDoc(doc(db, "notifications", "notification-coordinator")));
    await assertSucceeds(updateDoc(doc(db, "notifications", "notification-coordinator"), { read: true }));
    await assertFails(updateDoc(doc(db, "notifications", "notification-coordinator"), { title: "Altéré" }));
    await assertFails(updateDoc(doc(db, "notifications", "notification-coordinator"), { recipientUserId: "admin-a" }));
  });
});
