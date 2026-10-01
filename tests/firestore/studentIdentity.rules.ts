import { readFileSync } from "node:fs";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveManualStudent } from "../../api/_lib/manualStudentSave.js";

let environment: RulesTestEnvironment;
let app: App;
let db: Firestore;
const school = "school-a";
const year = "year-a";
const actor = (uid: string, role: string, schoolId = school) => ({ uid, role, schoolId });
const student = (id: string, changes: Record<string, unknown> = {}) => ({ id, schoolId: school, schoolYearId: year, matricule: id, nom: "KABAMBA", postnom: "ILUNGA", prenom: "JEAN", sexe: "M", birthDate: "2014-01-01", address: "", phone: "", className: "1ère Primaire", status: "ACTIVE", ...changes });
const save = (value: Record<string, unknown>, uid = "admin-a", role = "school_admin", schoolId = school) => saveManualStudent({ db, caller: actor(uid, role, schoolId), body: { student: value } });

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Ce test exige exclusivement un Emulator Firestore local.");
  environment = await initializeTestEnvironment({ projectId: "demo-acadea-student-identity", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  app = initializeApp({ projectId: "demo-acadea-student-identity" }, "student-identity-tests");
  db = getFirestore(app);
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await setDoc(doc(firestore, "schools", "school-a"), { id: "school-a", status: "active" });
    await setDoc(doc(firestore, "schoolYears", "year-a"), { id: "year-a", schoolId: "school-a", name: "2026-2027", status: "active" });
    await setDoc(doc(firestore, "schools", "school-b"), { id: "school-b", status: "active" });
    await setDoc(doc(firestore, "schoolYears", "year-b"), { id: "year-b", schoolId: "school-b", name: "2026-2027", status: "active" });
    await setDoc(doc(firestore, "users", "admin-a"), { id: "admin-a", role: "school_admin", schoolId: "school-a", status: "active" });
    await setDoc(doc(firestore, "users", "admin-b"), { id: "admin-b", role: "school_admin", schoolId: "school-b", status: "active" });
    await setDoc(doc(firestore, "users", "secretary-a"), { id: "secretary-a", role: "secretary", schoolId: "school-a", status: "active" });
    await setDoc(doc(firestore, "students", "existing"), student("existing", { address: "Ancienne adresse" }));
  });
});

afterAll(async () => { await environment?.cleanup(); if (app) await deleteApp(app); }, 30000);

describe("identité élève médiée par le serveur", () => {
  for (const [uid, role] of [["admin-a", "school_admin"], ["secretary-a", "secretary"]]) {
    it(`refuse une création directe et une modification d'identité par ${role}`, async () => {
      const firestore = environment.authenticatedContext(uid, { role, schoolId: "school-a" }).firestore();
      await assertFails(setDoc(doc(firestore, "students", `duplicate-${uid}`), { id: `duplicate-${uid}`, schoolId: "school-a", schoolYearId: "year-a", nom: "KABAMBA", postnom: "ILUNGA", prenom: "JEAN", status: "ACTIVE" }));
      await assertFails(updateDoc(doc(firestore, "students", "existing"), { nom: "AUTRE" }));
      await assertSucceeds(updateDoc(doc(firestore, "students", "existing"), { address: "Nouvelle adresse" }));
    });
  }
});

describe("enregistrement manuel atomique", () => {
  it("alloue deux matricules distincts à deux identités créées simultanément par Admin et Secrétaire", async () => {
    const attempts = await Promise.all([
      save(student("student-concurrent-admin", { nom: "MUTOMBO", prenom: "ALICE", matricule: "ACD-26-0002" })),
      save(student("student-concurrent-secretary", { nom: "KASONGO", prenom: "BRUNO", matricule: "ACD-26-0002" }), "secretary-a", "secretary"),
    ]);
    expect(attempts.map(({ student: saved }) => saved.matricule).sort()).toEqual(["ACD-26-0002", "ACD-26-0003"]);
    expect((await db.doc("studentMatriculeCounters/school-a__year-a").get()).data()?.lastAllocated).toBe(3);
  }, 60_000);

  it("ignore le matricule fourni par le client et reprend au-delà des suffixes historiques", async () => {
    await db.doc("students/historical-high").set(student("historical-high", { nom: "AUTRE", matricule: "ACD-26-0099" }));
    const created = await save(student("student-after-history", { prenom: "PAUL", matricule: "ACD-26-0001" }));
    expect(created.student.matricule).toBe("ACD-26-0100");
    expect(created.student.searchPrefixes).toContain("0100");
    const edited = await save(student("student-after-history", { prenom: "PAUL", address: "Nouvelle adresse", matricule: "FAKE" }));
    expect(edited.student.matricule).toBe("ACD-26-0100");
    expect((await db.doc("studentMatriculeCounters/school-a__year-a").get()).data()?.lastAllocated).toBe(100);
  }, 60_000);

  it("maintient des séquences indépendantes entre écoles", async () => {
    const first = await save(student("student-school-a", { prenom: "PAUL", matricule: "" }));
    const second = await save(student("student-school-b", { schoolId: "school-b", schoolYearId: "year-b", prenom: "PAUL", matricule: "" }), "admin-b", "school_admin", "school-b");
    expect(first.student.matricule).toBe("ACD-26-0002");
    expect(second.student.matricule).toBe("ACD-26-0001");
  }, 60_000);

  it("préserve le matricule importé et démarre une séquence distincte dans la nouvelle année", async () => {
    await db.doc("schoolYears/year-next").set({ id: "year-next", schoolId: school, name: "2027-2028", status: "active" });
    await db.doc("students/imported-next").set(student("imported-next", { schoolYearId: "year-next", matricule: "ACD-26-0042", importedFromStudentId: "existing" }));
    const created = await save(student("student-new-year", { schoolYearId: "year-next", nom: "AUTRE", matricule: "" }));
    expect((await db.doc("students/imported-next").get()).data()?.matricule).toBe("ACD-26-0042");
    expect(created.student.matricule).toBe("ACD-27-0002");
  }, 60_000);

  it("refuse l’écriture directe du compteur par un client scolaire", async () => {
    const firestore = environment.authenticatedContext("admin-a", { role: "school_admin", schoolId: school }).firestore();
    await assertFails(setDoc(doc(firestore, "studentMatriculeCounters", "school-a__year-a"), { lastAllocated: 1000 }));
  });

  it("alloue dix matricules uniques sous concurrence", async () => {
    const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => save(student(`student-batch-${index}`, { nom: `NOM-${index}`, prenom: "TEST", matricule: "" }))));
    const matricules = attempts.map(({ student: saved }) => saved.matricule);
    expect(new Set(matricules).size).toBe(10);
    expect(matricules.sort()).toEqual(Array.from({ length: 10 }, (_, index) => `ACD-26-${String(index + 2).padStart(4, "0")}`));
  }, 120_000);

  it("refuse un legacy identique, ses variantes de casse et d’espaces, ainsi que le prénom vide", async () => {
    for (const [index, value] of [
      student("student-duplicate-1"),
      student("student-duplicate-2", { nom: " kabamba ", postnom: " ilunga ", prenom: " jean " }),
      student("student-duplicate-3", { nom: "Kabamba", postnom: "Ilunga", prenom: "Jean" }),
    ].entries()) {
      await expect(save(value)).rejects.toMatchObject({ code: "duplicate-student", statusCode: 409 });
      expect((await db.doc(`students/student-duplicate-${index + 1}`).get()).exists).toBe(false);
    }
    await db.doc("students/legacy-empty").set(student("legacy-empty", { prenom: "" }));
    await expect(save(student("student-empty-duplicate", { prenom: "   " }))).rejects.toMatchObject({ code: "duplicate-student" });
  });

  it("autorise un autre prénom et la même identité dans une autre école", async () => {
    expect((await save(student("student-paul", { prenom: "PAUL" }))).student.id).toBe("student-paul");
    const otherSchool = student("student-other-school", { schoolId: "school-b", schoolYearId: "year-b" });
    expect((await save(otherSchool, "admin-b", "school_admin", "school-b")).student.schoolId).toBe("school-b");
    await expect(save(otherSchool)).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("permet l’édition de soi-même et refuse un changement vers l’identité d’un autre élève", async () => {
    const same = await save(student("existing", { address: "Nouvelle adresse" }));
    expect(same.student.address).toBe("Nouvelle adresse");
    await save(student("student-paul", { prenom: "PAUL" }));
    await expect(save(student("existing", { prenom: "Paul" }))).rejects.toMatchObject({ code: "duplicate-student" });
    expect((await db.doc("students/existing").get()).data()?.prenom).toBe("JEAN");
  });

  it("sérialise deux soumissions Admin/Secrétaire simultanées vers un seul élève", async () => {
    const attempts = await Promise.allSettled([
      save(student("student-admin", { nom: "MUTOMBO", postnom: "KASONGO", prenom: "A" })),
      save(student("student-secretary", { nom: " mutombo ", postnom: "kasongo", prenom: "a" }), "secretary-a", "secretary"),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const documents = await db.collection("students").where("schoolId", "==", school).get();
    expect(documents.docs.filter((snapshot) => snapshot.data().nom.trim().toLowerCase() === "mutombo")).toHaveLength(1);
  });

  it("préserve les imports serveur vers une autre année sans autoriser la création manuelle d’un second dossier", async () => {
    await db.doc("schoolYears/year-next").set({ id: "year-next", schoolId: school, status: "active" });
    await db.doc("students/imported-next").set(student("imported-next", { schoolYearId: "year-next", importedFromStudentId: "existing" }));
    expect((await db.doc("students/imported-next").get()).exists).toBe(true);
    await expect(save(student("student-third-year", { schoolYearId: "year-next" }))).rejects.toMatchObject({ code: "duplicate-student" });
  });

  it("refuse un rôle étranger et un profil utilisateur inactif", async () => {
    await expect(save(student("student-foreign"), "cashier-a", "cashier")).rejects.toMatchObject({ code: "permission-denied" });
    await db.doc("users/admin-a").update({ status: "inactive" });
    await expect(save(student("student-inactive", { prenom: "AUTRE" }))).rejects.toMatchObject({ code: "permission-denied" });
  });
});
