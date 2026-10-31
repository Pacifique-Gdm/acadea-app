import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment;
const auth = (uid: string, claims: Record<string, string>) => environment.authenticatedContext(uid, claims).firestore();
const seed = (path: string, data: Record<string, unknown>) =>
  environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

describe("Cas sociaux — isolation Firestore et rôles", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-social-support-rules", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    await seed("schools/school-a", { id: "school-a", status: "active", activeSchoolYearId: "year-a" });
    await seed("schools/school-b", { id: "school-b", status: "active", activeSchoolYearId: "year-b" });
    await seed("schools/school-c", { id: "school-c", status: "active", activeSchoolYearId: "year-c" });
    for (const [schoolId, yearId] of [["school-a", "year-a"], ["school-b", "year-b"], ["school-c", "year-c"]]) {
      await seed(`schoolYears/${yearId}`, { id: yearId, schoolId, status: "active" });
      await seed(`socialSupportDecisions/decision-${schoolId}`, { id: `decision-${schoolId}`, schoolId, schoolYearId: yearId, studentId: `student-${schoolId}`, status: "active" });
      await seed(`socialSupportAudit/audit-${schoolId}`, { schoolId, schoolYearId: yearId, decisionId: `decision-${schoolId}` });
    }
    for (const [uid, role, schoolId] of [["admin-a", "school_admin", "school-a"], ["cashier-a", "cashier", "school-a"], ["secretary-a", "secretary", "school-a"], ["admin-b", "school_admin", "school-b"]]) {
      await seed(`users/${uid}`, { id: uid, role, schoolId, status: "active", active: true });
    }
    await seed("coordinations/coord-a", { id: "coord-a", status: "active", principalCoordinatorUserId: "coord-user" });
    await seed("users/coord-user", { id: "coord-user", role: "coordination_admin", coordinationId: "coord-a", active: true });
    await seed("users/sub-user", { id: "sub-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", active: true });
    await seed("subCoordinations/sub-a", { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "sub-user", status: "active", active: true });
    for (const schoolId of ["school-a", "school-c"]) await seed(`coordinationSchools/coord-a__${schoolId}`, { coordinationId: "coord-a", schoolId, active: true });
    await seed("subCoordinationSchools/sub-a__school-a", { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true });
  });
  afterAll(async () => environment?.cleanup(), 30_000);

  it("permet aux trois rôles de l'école de lire son historique sans lire l'autre école ni écrire directement", async () => {
    for (const [uid, role] of [["admin-a", "school_admin"], ["cashier-a", "cashier"], ["secretary-a", "secretary"]]) {
      const db = auth(uid, { role, schoolId: "school-a" });
      await assertSucceeds(getDoc(doc(db, "socialSupportDecisions", "decision-school-a")));
      await assertSucceeds(getDoc(doc(db, "socialSupportAudit", "audit-school-a")));
      await assertFails(getDoc(doc(db, "socialSupportDecisions", "decision-school-b")));
      await assertFails(getDoc(doc(db, "socialSupportAudit", "audit-school-b")));
      const own = await assertSucceeds(getDocs(query(collection(db, "socialSupportDecisions"), where("schoolId", "==", "school-a"))));
      expect(own.size).toBe(1);
      await assertFails(getDocs(collection(db, "socialSupportDecisions")));
      await assertFails(updateDoc(doc(db, "socialSupportDecisions", "decision-school-a"), { status: "cancelled" }));
    }
  });

  it("limite les coordinateurs à leurs rattachements, sans écriture", async () => {
    const coordinator = auth("coord-user", { role: "coordination_admin", coordinationId: "coord-a" });
    const delegate = auth("sub-user", { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" });
    for (const db of [coordinator, delegate]) {
      await assertSucceeds(getDoc(doc(db, "socialSupportDecisions", "decision-school-a")));
      await assertFails(getDoc(doc(db, "socialSupportDecisions", "decision-school-b")));
      await assertFails(updateDoc(doc(db, "socialSupportDecisions", "decision-school-a"), { status: "cancelled" }));
    }
    await assertSucceeds(getDoc(doc(coordinator, "socialSupportDecisions", "decision-school-c")));
    await assertFails(getDoc(doc(delegate, "socialSupportDecisions", "decision-school-c")));
  });
});
