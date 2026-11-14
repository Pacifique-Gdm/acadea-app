import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let environment: RulesTestEnvironment;

describe("totaux de caisse en observation (lot 10)", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({ projectId: "demo-cash-totals", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "users/admin-a"), { role: "school_admin", schoolId: "school-a", status: "active" });
      await setDoc(doc(context.firestore(), "schools/school-a"), { status: "active" });
      await setDoc(doc(context.firestore(), "financialCashTotals/t"), { schoolId: "school-a", availableCents: 100 });
    });
  }, 30_000);
  afterAll(async () => environment.cleanup(), 30_000);

  it.each(["school_admin", "cashier"])("reste illisible et non modifiable depuis l'application (%s)", async (role) => {
    const db = environment.authenticatedContext(`${role}-a`, { role, schoolId: "school-a" }).firestore();
    await assertFails(getDoc(doc(db, "financialCashTotals", "t")));
    await assertFails(setDoc(doc(db, "financialCashTotals", "t"), { schoolId: "school-a", availableCents: 1 }));
  });
});
