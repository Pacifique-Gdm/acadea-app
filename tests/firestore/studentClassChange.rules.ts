import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

// Lot E du caissier : la classe d'un élève ne change plus par une écriture directe ;
// seul le serveur (« change-student-class ») la change, en rattachant les paiements.
const projectId = "demo-acadea-student-class-change";
const school = "school-a";
const year = "year-a";
let environment: RulesTestEnvironment;

const auth = (uid: string, role: string) => environment.authenticatedContext(uid, { role, schoolId: school }).firestore();
async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${school}`, { id: school, name: "École A", status: "active", activeSchoolYearId: year });
  await seed(`schoolYears/${year}`, { id: year, schoolId: school, status: "active" });
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: school, status: "active", activeSchoolYearId: year });
  await seed("users/secretary-a", { id: "secretary-a", role: "secretary", schoolId: school, status: "active", activeSchoolYearId: year });
  await seed("students/eleve", { id: "eleve", schoolId: school, schoolYearId: year, status: "ACTIVE", nom: "A", postnom: "B", prenom: "C",
    className: "1ère Primaire", section: "Primaire", address: "Ancienne adresse" });
});

afterAll(async () => { await environment?.cleanup(); });

describe("changement de classe : jamais par écriture directe", () => {
  for (const [uid, role] of [["admin-a", "school_admin"], ["secretary-a", "secretary"]] as const) {
    it(`${role} : changer la classe directement est refusé`, async () => {
      await assertFails(updateDoc(doc(auth(uid, role), "students/eleve"), { className: "2ème Primaire" }));
      await assertFails(updateDoc(doc(auth(uid, role), "students/eleve"), { section: "Secondaire" }));
      await assertFails(updateDoc(doc(auth(uid, role), "students/eleve"), { option: "Pédagogie" }));
    });
    it(`${role} : modifier l'adresse reste possible`, async () => {
      await assertSucceeds(updateDoc(doc(auth(uid, role), "students/eleve"), { address: "Nouvelle adresse" }));
    });
  }
});
