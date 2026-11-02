import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let environment: RulesTestEnvironment;
const school = "school-fee-a";
const year = "year-fee-a";
const admin = () => environment.authenticatedContext("fee-admin", { role: "school_admin", schoolId: school }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-fee-mutation", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "schools", school), { id: school, status: "active", activeSchoolYearId: year });
    await setDoc(doc(db, "schoolYears", year), { id: year, schoolId: school, status: "active" });
    await setDoc(doc(db, "users", "fee-admin"), { id: "fee-admin", schoolId: school, role: "school_admin", status: "active" });
  });
}, 30000);
afterAll(async () => environment?.cleanup(), 30000);

describe("types de frais : audit et reçus réservés au serveur", () => {
  it("autorise le frais de l'école mais refuse le faux audit et les documents d'idempotence côté client", async () => {
    const db = admin();
    await assertSucceeds(setDoc(doc(db, "feeTypes", "fee-a"), { id: "fee-a", schoolId: school, schoolYearId: year, name: "Minerval", className: "6ème Primaire", amount: 15000 }));
    await assertFails(setDoc(doc(db, "auditLogs", "forged-fee"), { id: "forged-fee", schoolId: school, actorId: "fee-admin", action: "Ajout type de frais" }));
    await assertFails(setDoc(doc(db, "feeTypeRequests", "forged-fee"), { schoolId: school }));
    await assertFails(setDoc(doc(db, "feeTypeKeys", "forged-fee"), { schoolId: school }));
  }, 30000);

  it("refuse la création de frais dans une autre école", async () => {
    await assertFails(setDoc(doc(admin(), "feeTypes", "foreign-fee"), { id: "foreign-fee", schoolId: "school-fee-b", schoolYearId: year, name: "Minerval", amount: 100 }));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), "feeTypes", "fee-a")));
  });

  it("reproduit l'ancien faux échec : le frais est présent malgré le refus de l'audit parallèle", async () => {
    const db = admin();
    const fee = doc(db, "feeTypes", "fee-partial");
    await expect(Promise.all([
      setDoc(fee, { id: "fee-partial", schoolId: school, schoolYearId: year, name: "Fourniture", className: "5ème Primaire", amount: 1000 }),
      setDoc(doc(db, "auditLogs", "audit-partial"), { id: "audit-partial", schoolId: school, actorId: "fee-admin", action: "Ajout type de frais" }),
    ])).rejects.toBeTruthy();
    expect((await assertSucceeds(getDoc(fee))).exists()).toBe(true);
  });
});
