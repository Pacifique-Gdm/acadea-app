import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let environment: RulesTestEnvironment;
const schoolA = "school-options-a";
const schoolB = "school-options-b";

const database = (uid: string, role: string, schoolId = schoolA) => environment.authenticatedContext(uid, { role, schoolId }).firestore();
const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId: "demo-school-options", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${schoolA}`, { id: schoolA, schoolId: schoolA, name: "École A", status: "active", schoolOptions: ["Sciences"] });
  await seed(`schools/${schoolB}`, { id: schoolB, schoolId: schoolB, name: "École B", status: "active", schoolOptions: [] });
});

afterAll(async () => environment?.cleanup(), 30000);

describe("référentiel tenanté des options scolaires", () => {
  it("autorise Admin et Secrétaire de la même école à modifier uniquement schoolOptions", async () => {
    await assertSucceeds(updateDoc(doc(database("admin-a", "school_admin"), "schools", schoolA), { schoolOptions: ["Sciences", "Littéraire"] }));
    await assertSucceeds(updateDoc(doc(database("secretary-a", "secretary"), "schools", schoolA), { schoolOptions: ["Sciences", "Littéraire", "Commerciale"] }));
    await assertFails(updateDoc(doc(database("secretary-a", "secretary"), "schools", schoolA), { name: "Interdit" }));
  });

  it("refuse autre école, rôle inconnu et utilisateur non authentifié", async () => {
    await assertFails(updateDoc(doc(database("secretary-a", "secretary"), "schools", schoolB), { schoolOptions: ["Interdite"] }));
    await assertFails(updateDoc(doc(database("unknown", "unknown"), "schools", schoolA), { schoolOptions: ["Interdite"] }));
    await assertFails(updateDoc(doc(environment.unauthenticatedContext().firestore(), "schools", schoolA), { schoolOptions: ["Interdite"] }));
  });
});
