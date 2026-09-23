import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const projectId = "demo-parent-academic-ownership";
const collections = ["grades", "bulletins", "documents", "attendance"] as const;
let environment: RulesTestEnvironment;

const seed = (path: string, data: Record<string, unknown>) => environment.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), path), data));
const parent = (uid: string, schoolId: string, parentId: string) => environment.authenticatedContext(uid, { role: "parent", schoolId, parentId }).firestore();

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed("users/parent-a", { id: "parent-a", role: "parent", schoolId: "school-a", parentId: "family-a", status: "active", active: true });
  await seed("users/parent-b", { id: "parent-b", role: "parent", schoolId: "school-a", parentId: "family-b", status: "active", active: true });
  await seed("users/parent-c", { id: "parent-c", role: "parent", schoolId: "school-b", parentId: "family-c", status: "active", active: true });
  await seed("parents/family-a", { id: "family-a", schoolId: "school-a", studentIds: ["child-a"] });
  await seed("parents/family-b", { id: "family-b", schoolId: "school-a", studentIds: ["child-b"] });
  await seed("parents/family-c", { id: "family-c", schoolId: "school-b", studentIds: ["child-c"] });
  for (const [suffix, schoolId, parentId] of [["a", "school-a", "family-a"], ["b", "school-a", "family-b"], ["c", "school-b", "family-c"]] as const) {
    await seed(`students/child-${suffix}`, { id: `child-${suffix}`, schoolId, schoolYearId: `${schoolId}-year`, parentId });
    for (const collectionName of collections) {
      await seed(`${collectionName}/item-${suffix}`, { id: `item-${suffix}`, schoolId, schoolYearId: `${schoolId}-year`, studentId: `child-${suffix}`, parentId });
    }
  }
  for (const collectionName of collections) {
    await seed(`${collectionName}/legacy-a`, { id: "legacy-a", schoolId: "school-a", schoolYearId: "school-a-year", studentId: "child-a" });
    await seed(`${collectionName}/wrong-year-a`, { id: "wrong-year-a", schoolId: "school-a", schoolYearId: "school-a-other-year", studentId: "child-a" });
  }
});

afterAll(() => environment.cleanup(), 30_000);

describe("frontière Parent ↔ Élève des documents scolaires", () => {
  for (const collectionName of collections) {
    it(`${collectionName}: autorise son enfant et refuse un autre enfant de la même école ou d'une autre école`, async () => {
      const familyA = parent("parent-a", "school-a", "family-a");
      await assertSucceeds(getDoc(doc(familyA, collectionName, "item-a")));
      await assertFails(getDoc(doc(familyA, collectionName, "item-b")));
      await assertFails(getDoc(doc(familyA, collectionName, "item-c")));
      await assertSucceeds(getDoc(doc(familyA, collectionName, "legacy-a")));
      await assertFails(getDoc(doc(familyA, collectionName, "wrong-year-a")));
      await assertSucceeds(getDoc(doc(parent("parent-b", "school-a", "family-b"), collectionName, "item-b")));
    });

    it(`${collectionName}: borne la requête par enfant et année sans autoriser un balayage de l'école`, async () => {
      const familyA = parent("parent-a", "school-a", "family-a");
      await assertSucceeds(getDocs(query(collection(familyA, collectionName), where("schoolId", "==", "school-a"), where("studentId", "==", "child-a"), where("schoolYearId", "==", "school-a-year"))));
      await assertFails(getDocs(query(collection(familyA, collectionName), where("schoolId", "==", "school-a"), where("studentId", "==", "child-b"), where("schoolYearId", "==", "school-a-year"))));
      await assertFails(getDocs(query(collection(familyA, collectionName), where("schoolId", "==", "school-a"))));
    });
  }
});
