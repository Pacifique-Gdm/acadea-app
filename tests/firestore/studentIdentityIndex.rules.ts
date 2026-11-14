import { readFileSync } from "node:fs";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveManualStudent } from "../../api/_lib/manualStudentSave.js";
import { migrateStudentIdentityIndex } from "../../api/_lib/studentIdentityIndex.js";

let environment: RulesTestEnvironment;
let app: App;
let db: Firestore;
const student = (id: string, changes: Record<string, unknown> = {}) => ({ id, schoolId: "school-a", schoolYearId: "year-a", matricule: "", nom: "KABAMBA", postnom: "ILUNGA", prenom: "JEAN", sexe: "M", birthDate: "2014-01-01", address: "", phone: "", className: "1ère Primaire", status: "ACTIVE", ...changes });
const save = (value: Record<string, unknown>) => saveManualStudent({ db, caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, body: { student: value, intent: "create" } });

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  environment = await initializeTestEnvironment({ projectId: "demo-acadea-identity-index", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId: "demo-acadea-identity-index" }, "identity-index-tests");
  db = getFirestore(app);
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "schools", "school-a"), { id: "school-a", status: "active" });
    await setDoc(doc(firestore, "schoolYears", "year-a"), { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active" });
    await setDoc(doc(firestore, "users", "admin-a"), { id: "admin-a", role: "school_admin", schoolId: "school-a", status: "active" });
    // Fiches anciennes, enregistrées directement, sans champ de tri ni verrou.
    await setDoc(doc(firestore, "students", "legacy"), student("legacy", { schoolYearId: "year-old" }));
    await setDoc(doc(firestore, "students", "historical-high"), student("historical-high", { nom: "AUTRE", matricule: "ACD-26-0099" }));
  });
});

afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); }, 30000);

describe("index des identités sur un vrai Firestore (émulateur)", () => {
  it("avant migration : l'ancienne vérification complète détecte le doublon", async () => {
    await expect(save(student("student-dup-before"))).rejects.toMatchObject({ code: "duplicate-student" });
  }, 60_000);

  it("après migration : doublon ancien détecté, matricule au-delà de l'historique, photos et données non touchées", async () => {
    const plan = await migrateStudentIdentityIndex({ db, schoolId: "school-a" });
    expect(plan).toMatchObject({ students: 2, locksToCreate: 2, sortNameToBackfill: 2, applied: false });
    expect((await db.doc("studentIdentityIndexStates/school-a").get()).exists).toBe(false);
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    expect((await db.doc("studentIdentityIndexStates/school-a").get()).data()).toMatchObject({ status: "complete", version: 1 });
    expect((await db.doc("students/legacy").get()).data()).toMatchObject({ sortName: "kabamba ilunga jean", address: "", schoolYearId: "year-old" });
    await expect(save(student("student-dup-after"))).rejects.toMatchObject({ code: "duplicate-student", statusCode: 409 });
    const created = await save(student("student-new", { prenom: "PAUL" }));
    expect(created.student.matricule).toBe("ACD-26-0100");
  }, 60_000);

  it("le marqueur et les verrous restent invisibles et non modifiables depuis l'application", async () => {
    await migrateStudentIdentityIndex({ db, schoolId: "school-a", apply: true });
    const client = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId: "school-a" }).firestore();
    await assertFails(getDoc(doc(client, "studentIdentityIndexStates", "school-a")));
    await assertFails(setDoc(doc(client, "studentIdentityIndexStates", "school-a"), { status: "complete", version: 1 }));
  }, 60_000);
});
