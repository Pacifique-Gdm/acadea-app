import { readFileSync } from "node:fs";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "@firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-teacher-grading", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);
afterAll(async () => env?.cleanup(), 30000);

describe("cotations et publications exclusivement via serveur", () => {
  for (const collection of ["courseGradingConfigs", "gradeEntries", "gradePublicationRuns", "publishedGradeResults"]) {
    for (const role of ["teacher", "study_director", "parent"]) {
      it(`refuse toute lecture/écriture directe de ${collection} par ${role}`, async () => {
        const db = env.authenticatedContext(`${role}-a`, { role, schoolId: "school-a", parentId: "parent-a" }).firestore();
        const ref = doc(db, collection, "x");
        await assertFails(getDoc(ref));
        await assertFails(setDoc(ref, { schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a" }));
        await assertFails(updateDoc(ref, { score: 1 }));
        await assertFails(deleteDoc(ref));
      });
    }
  }
});
