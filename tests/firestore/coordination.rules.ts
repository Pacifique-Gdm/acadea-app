import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const coordinationId = "coord-a";
const schoolA = "school-a";
const schoolB = "school-b";

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
}

function database(uid: string, coordination = coordinationId) {
  return environment.authenticatedContext(uid, { role: "coordination_admin", coordinationId: coordination }).firestore();
}

describe("SEC — isolation Coordination", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-coordination", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    await seed(`coordinations/${coordinationId}`, { id: coordinationId, status: "active", name: "Coordination A" });
    await seed(`coordinationSchools/${coordinationId}__${schoolA}`, { id: `${coordinationId}__${schoolA}`, coordinationId, schoolId: schoolA, active: true });
    await seed(`coordinationSchools/${coordinationId}__${schoolB}`, { id: `${coordinationId}__${schoolB}`, coordinationId, schoolId: schoolB, active: false });
    await seed(`schools/${schoolA}`, { id: schoolA, name: "École A", status: "active", activeCoordinationId: coordinationId, activeSchoolYearId: "year-a" });
    await seed(`schools/${schoolB}`, { id: schoolB, name: "École B", status: "active" });
    await seed("schoolYears/year-a", { id: "year-a", schoolId: schoolA, name: "2026-2027", status: "active" });
    await seed("schoolYears/year-b", { id: "year-b", schoolId: schoolB, name: "2026-2027", status: "active" });
    await seed("students/student-a", { id: "student-a", schoolId: schoolA, firstName: "A" });
    await seed("students/student-b", { id: "student-b", schoolId: schoolB, firstName: "B" });
    await seed("feeTypes/fee-a", { id: "fee-a", schoolId: schoolA, schoolYearId: "year-a", name: "Minerval", amount: 10 });
    await seed("payments/payment-a", { id: "payment-a", schoolId: schoolA, schoolYearId: "year-a", amount: 10 });
    await seed("expenses/expense-a", { id: "expense-a", schoolId: schoolA, schoolYearId: "year-a", amount: 2 });
    await seed("users/admin-a", { id: "admin-a", schoolId: schoolA, role: "school_admin", active: true });
    await seed("teachers/teacher-a", { id: "teacher-a", schoolId: schoolA, schoolYearId: "year-a", userId: "teacher-user-a" });
    await seed("gradeEntries/grade-a", { id: "grade-a", schoolId: schoolA, schoolYearId: "year-a", studentId: "student-a", classId: "class-a", subjectId: "subject-a" });
    await seed("timetables/timetable-a", { id: "timetable-a", schoolId: schoolA, schoolYearId: "year-a", status: "draft" });
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it("autorise uniquement l'école rattachée activement", async () => {
    const db = database("coord-a");
    await assertSucceeds(getDoc(doc(db, "schools", schoolA)));
    await assertSucceeds(getDoc(doc(db, "students", "student-a")));
    await assertFails(getDoc(doc(db, "schools", schoolB)));
    await assertFails(getDoc(doc(db, "students", "student-b")));
    await assertSucceeds(getDocs(query(collection(db, "students"), where("schoolId", "in", [schoolA]))));
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
    await assertFails(getDoc(doc(db, "schools", "school-c")));
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
});
