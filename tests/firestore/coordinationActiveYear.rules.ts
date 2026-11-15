import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, limit, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const principal = () => environment.authenticatedContext("coord-user", { role: "coordination_admin", coordinationId: "coord-a" }).firestore();
const delegate = () => environment.authenticatedContext("sub-user", { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" }).firestore();

describe("coordination : requêtes par école et par année active (lot 11)", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-coordination-active-year", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  }, 30_000);
  beforeEach(async () => {
    await environment.clearFirestore();
    await seed("users/coord-user", { id: "coord-user", role: "coordination_admin", coordinationId: "coord-a", status: "active", active: true });
    await seed("users/sub-user", { id: "sub-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", status: "active", active: true });
    await seed("coordinations/coord-a", { id: "coord-a", status: "active", principalCoordinatorUserId: "coord-user" });
    await seed("coordinationSchools/coord-a__school-a", { coordinationId: "coord-a", schoolId: "school-a", active: true });
    await seed("coordinationSchools/coord-a__school-b", { coordinationId: "coord-a", schoolId: "school-b", active: false });
    await seed("subCoordinations/sub-a", { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "sub-user", status: "active", active: true });
    await seed("subCoordinationSchools/sub-a__school-a", { coordinationId: "coord-a", subCoordinationId: "sub-a", schoolId: "school-a", active: true });
    for (const school of ["school-a", "school-b"]) {
      await seed(`schools/${school}`, { id: school, status: "active", activeSchoolYearId: `${school}-26` });
      await seed(`students/${school}-student`, { schoolId: school, schoolYearId: `${school}-26`, status: "ACTIVE" });
      await seed(`payments/${school}-arrears`, { schoolId: school, schoolYearId: `${school}-25`, collectionSchoolYearId: `${school}-26`, amount: 5 });
    }
  });
  afterAll(async () => environment.cleanup(), 30_000);

  it.each([["principal", principal], ["délégué", delegate]] as const)("le coordinateur %s lit l'année active de son école, pas celle d'une autre école", async (_label, open) => {
    const db = open();
    for (const name of ["students", "feeTypes", "payments", "expenses", "cashInflows"]) {
      await assertSucceeds(getDocs(query(collection(db, name), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "school-a-26"), limit(500))));
      await assertFails(getDocs(query(collection(db, name), where("schoolId", "==", "school-b"), where("schoolYearId", "==", "school-b-26"), limit(500))));
    }
    await assertSucceeds(getDocs(query(collection(db, "payments"), where("schoolId", "==", "school-a"), where("collectionSchoolYearId", "==", "school-a-26"), limit(500))));
    await assertFails(getDocs(query(collection(db, "payments"), where("schoolId", "==", "school-b"), where("collectionSchoolYearId", "==", "school-b-26"), limit(500))));
    await assertSucceeds(getDocs(query(collection(db, "schoolYears"), where("schoolId", "==", "school-a"))));
  });
});
