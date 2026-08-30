import { readFileSync } from "node:fs";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { importArchivedStudents, importedStudentDocument } from "../../api/_lib/archivedStudentsImport.js";
import type { Student } from "../../src/types";

const projectId = "demo-acadea-archive-import";
let app: App, db: Firestore, environment: RulesTestEnvironment;
const caller = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
const body = { schoolId: "school-a", schoolYearId: "new", sourceYearId: "old", mode: "import", confirmation: "IMPORTER LES ELEVES" };
const source = (id: string): Student => ({ id, schoolId: "school-a", schoolYearId: "old", matricule: id, nom: "Test", postnom: "", prenom: id, sexe: "F", birthDate: "2015-01-01", address: "", phone: "", className: "1ère Primaire", section: "Primaire", classId: "old-class", parentId: "parent-a", status: "ACTIVE" });
const execute = (changes: Record<string, unknown> = {}, actor = caller) => importArchivedStudents({ db, caller: actor, body: { ...body, ...changes } });
async function targetStudents() { return (await db.collection("students").where("schoolYearId", "==", "new").get()).docs; }

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId }, "archive-import-tests"); db = getFirestore(app);
}, 30_000);
beforeEach(async () => {
  await environment.clearFirestore();
  const batch = db.batch();
  for (const [path, value] of Object.entries({
    "schools/school-a": { id: "school-a", status: "active", activeSchoolYearId: "new" },
    "schoolYears/new": { id: "new", schoolId: "school-a", status: "active" },
    "schoolYears/old": { id: "old", schoolId: "school-a", status: "archived" },
    "schoolYears/foreign": { id: "foreign", schoolId: "school-b", status: "archived" },
    "users/secretary-a": { ...caller, status: "active" },
    "users/parent-user": { id: "parent-user", role: "parent", schoolId: "school-a", parentId: "parent-a", studentIds: ["s0"] },
    "parents/parent-a": { id: "parent-a", schoolId: "school-a", schoolYearId: "old", userId: "parent-user", studentIds: ["s0"] },
    "classes/old-class": { id: "old-class", schoolId: "school-a", schoolYearId: "old", name: "1ère Primaire" },
    "classes/new-class": { id: "new-class", schoolId: "school-a", schoolYearId: "new", name: "2ème Primaire", active: true },
    "students/s0": source("s0"),
  })) batch.set(db.doc(path), value);
  await batch.commit();
});
afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); });

describe.each([false, true])("import réel Emulator, école coordonnée=%s", (coordinated) => {
  beforeEach(async () => { if (coordinated) await db.doc("schools/school-a").update({ activeCoordinationId: "coord-a" }); });
  it("importe sans option undefined, conserve l'identité et les liens parents sans copier les références annuelles", async () => {
    const before = (await db.doc("students/s0").get()).data();
    expect(await execute()).toMatchObject({ complete: true, importedCount: 1 });
    const [target] = await targetStudents();
    expect(target.data()).toMatchObject({ schoolId: "school-a", schoolYearId: "new", matricule: "s0", parentId: "parent-a", className: "2ème Primaire", classId: "new-class", importedFromStudentId: "s0" });
    expect(target.data()).not.toHaveProperty("option");
    expect((await db.doc("students/s0").get()).data()).toEqual(before);
    expect((await db.doc("parents/parent-a").get()).data()).toMatchObject({ schoolYearId: "old", studentIds: ["s0", target.id] });
    expect((await db.doc("users/parent-user").get()).data()?.studentIds).toEqual(["s0", target.id]);
    expect((await db.doc("schoolYears/new").get()).data()?.studentsImportedFromArchivedYear).toBe(true);
  });
  it("refuse les doublons lors d'une seconde soumission et vérifie réellement le statut", async () => {
    await execute();
    expect(await execute({ mode: "inspect" })).toMatchObject({ complete: true, remaining: 0 });
    await execute();
    expect(await targetStudents()).toHaveLength(1);
    expect((await db.collection("auditLogs").get()).size).toBe(1);
  });
  it("récupère un faux indicateur historique avec zéro élève", async () => {
    await db.doc("schoolYears/new").update({ studentsImportedFromArchivedYear: true, studentsImportedFromYearId: "old" });
    expect(await execute({ mode: "inspect" })).toMatchObject({ status: "legacy-incomplete", complete: false, remaining: 1 });
    expect(await execute()).toMatchObject({ complete: true });
    expect(await targetStudents()).toHaveLength(1);
  });
  it("reconnaît une reprise partielle legacy sans écraser la fiche présente", async () => {
    await db.doc("students/s1").set(source("s1"));
    const existing = { ...importedStudentDocument(source("s0"), "school-a", "new", []), id: "legacy-existing", phone: "test-preserved" };
    await db.doc("students/legacy-existing").set(existing);
    await db.doc("schoolYears/new").update({ studentsImportedFromArchivedYear: true });
    expect(await execute({ mode: "inspect" })).toMatchObject({ complete: false, existingCount: 1 });
    await execute();
    expect(await targetStudents()).toHaveLength(2);
    expect((await db.doc("students/legacy-existing").get()).data()).toEqual(existing);
    expect((await db.doc("parents/parent-a").get()).data()?.studentIds).toContain("legacy-existing");
  });
  it("ne publie ni élève ni marqueur lorsqu'une transaction échoue avant commit", async () => {
    const failingDb = { doc: db.doc.bind(db), collection: db.collection.bind(db), runTransaction: (run: (transaction: unknown) => Promise<unknown>) => db.runTransaction(async (transaction) => {
      await run(transaction); throw new Error("Panne simulée avant commit");
    }) };
    await expect(importArchivedStudents({ db: failingDb, caller, body })).rejects.toThrow("Panne simulée");
    expect(await targetStudents()).toHaveLength(0);
    expect((await db.doc("schoolYears/new").get()).data()?.studentsImportedFromArchivedYear).not.toBe(true);
    expect(await execute()).toMatchObject({ complete: true });
  });
  it("sérialise deux imports concurrents sans double fiche ni double audit", async () => {
    await Promise.all([execute(), execute()]);
    expect(await targetStudents()).toHaveLength(1);
    expect((await db.collection("auditLogs").get()).size).toBe(1);
  }, 30_000);
  it("reste lisible en archive pour Admin/Secrétaire/Caissier, sans écriture d'élève ni fuite inter-école", async () => {
    for (const role of ["school_admin", "secretary", "cashier"]) {
      const client = environment.authenticatedContext(`${role}-reader`, { role, schoolId: "school-a" }).firestore();
      const archive = await assertSucceeds(getDocs(query(collection(client, "students"), where("schoolId", "==", "school-a"), where("schoolYearId", "==", "old"))));
      expect(archive.size).toBe(1);
      await assertFails(updateDoc(doc(client, "students", "s0"), { nom: "Modification interdite" }));
      await assertFails(getDoc(doc(client, "schoolYears", "foreign")));
    }
  });
});

describe("limites, sécurité et gros volumes", () => {
  it.each(["school_admin", "cashier", "parent", "coordination_admin", "unknown"])("refuse le rôle %s", async (role) => {
    await expect(execute({}, { ...caller, role })).rejects.toMatchObject({ code: "permission-denied" });
  });
  it.each([
    { sourceYearId: "new" }, { sourceYearId: "foreign" }, { sourceYearId: "missing" }, { schoolYearId: "old" }, { schoolId: "school-b" }, { confirmation: "incorrect" },
  ])("refuse un périmètre ou une confirmation invalide %j", async (changes) => { await expect(execute(changes)).rejects.toThrow(); expect(await targetStudents()).toHaveLength(0); });
  it("refuse un profil Secrétaire devenu inactif", async () => { await db.doc("users/secretary-a").update({ status: "inactive" }); await expect(execute()).rejects.toMatchObject({ code: "permission-denied" }); });
  it("traite la source vide sans marquer un import réussi", async () => { await db.doc("students/s0").delete(); expect(await execute({ mode: "inspect" })).toMatchObject({ status: "empty", complete: false }); await expect(execute()).rejects.toThrow("Aucun élève"); });
  it("répare les liens d'un import legacy complet sans recréer de parent/compte", async () => {
    await db.doc("students/legacy").set({ ...importedStudentDocument(source("s0"), "school-a", "new", []), id: "legacy" });
    await db.doc("schoolYears/new").update({ studentsImportedFromArchivedYear: true });
    await execute();
    expect(await execute({ mode: "inspect" })).toMatchObject({ complete: true, importedCount: 0 });
    expect((await db.collection("parents").get()).size).toBe(1);
    expect((await db.collection("users").where("role", "==", "parent").get()).size).toBe(1);
  });
  it("préserve le lien users.parentId d'un parent legacy sans userId", async () => {
    await db.doc("parents/parent-a").set({ id: "parent-a", schoolId: "school-a", schoolYearId: "old", studentIds: ["s0"] });
    await execute();
    const [target] = await targetStudents();
    expect((await db.doc("users/parent-user").get()).data()?.studentIds).toContain(target.id);
  });
  it("n'autorise pas une seconde source après un import legacy réel", async () => {
    await db.doc("students/legacy").set({ ...importedStudentDocument(source("s0"), "school-a", "new", []), id: "legacy" });
    await db.doc("schoolYears/new").update({ studentsImportedFromArchivedYear: true, studentsImportedFromYearId: "old" });
    await db.doc("schoolYears/older").set({ id: "older", schoolId: "school-a", status: "archived" });
    await db.doc("students/older-student").set({ ...source("older-student"), schoolYearId: "older" });
    await expect(execute({ sourceYearId: "older" })).rejects.toThrow("source précédente");
    expect(await targetStudents()).toHaveLength(1);
  });
  it("refuse un parent d'une autre école sans aucune écriture partielle", async () => {
    await db.doc("parents/parent-a").update({ schoolId: "school-b" });
    await expect(execute()).rejects.toThrow("parent source");
    expect(await targetStudents()).toHaveLength(0);
  });
  it("refuse l'import si l'année cible a été clôturée entre deux appels", async () => {
    await execute({ mode: "inspect" });
    await db.doc("schoolYears/new").update({ status: "archived" });
    await expect(execute()).rejects.toMatchObject({ code: "failed-precondition" });
    expect(await targetStudents()).toHaveLength(0);
  });
  it("importe plus de 500 élèves et reprend après un lot validé sans faux succès", async () => {
    for (let start = 1; start < 601; start += 300) {
      const batch = db.batch();
      for (let index = start; index < Math.min(start + 300, 601); index++) batch.set(db.doc(`students/s${index}`), source(`s${index}`));
      await batch.commit();
    }
    const first = await execute();
    expect(first).toMatchObject({ complete: false, importedCount: 80, remaining: 521 });
    expect((await db.doc("schoolYears/new").get()).data()?.studentsImportedFromArchivedYear).not.toBe(true);
    // A lost response / interrupted client is resumed from actual committed data.
    let result = first;
    for (let attempt = 0; !result.complete && attempt < 10; attempt++) result = await execute();
    expect(result).toMatchObject({ complete: true, importedCount: 601 });
    expect(await targetStudents()).toHaveLength(601);
    expect(new Set((await db.doc("parents/parent-a").get()).data()?.studentIds).size).toBe(602);
  }, 90_000);
});
