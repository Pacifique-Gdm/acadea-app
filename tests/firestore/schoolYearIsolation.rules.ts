import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, collection, doc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = "demo-acadea-school-year-isolation";
const schoolA = "school-a";
const schoolB = "school-b";
const yearA1 = "year-a-active";
const yearA2 = "year-a-archived";
const yearB1 = "year-b-active";
let environment: RulesTestEnvironment | undefined;

function env() {
  if (!environment) throw new Error("L'environnement Firestore n'est pas initialisé.");
  return environment;
}

function user(role: string, schoolId = schoolA, uid = `${role}-a`) {
  return env().authenticatedContext(uid, { role, schoolId }).firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await env().withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30_000);

beforeEach(async () => {
  await env().clearFirestore();
  await seed(`schoolYears/${yearA1}`, { id: yearA1, schoolId: schoolA, status: "active" });
  await seed(`schoolYears/${yearA2}`, { id: yearA2, schoolId: schoolA, status: "archived" });
  await seed(`schoolYears/${yearB1}`, { id: yearB1, schoolId: schoolB, status: "active" });
});

afterAll(async () => environment?.cleanup(), 30_000);

describe("SEC-009 — isolation stricte par année scolaire", () => {
  it("autorise une création dans l'année active de la même école", async () => {
    await assertSucceeds(setDoc(doc(user("school_admin"), "students", "student-active"), {
      id: "student-active", schoolId: schoolA, schoolYearId: yearA1, status: "ACTIVE", nom: "Élève actif",
    }));
  });

  it.each([
    ["année archivée", yearA2],
    ["année d'une autre école", yearB1],
    ["année inexistante", "missing-year"],
  ])("refuse une création dans une %s", async (_label, schoolYearId) => {
    await assertFails(setDoc(doc(user("school_admin"), "students", `student-${schoolYearId}`), {
      id: `student-${schoolYearId}`, schoolId: schoolA, schoolYearId, status: "ACTIVE", nom: "Élève refusé",
    }));
  });

  it("interdit de changer l'année d'un document existant", async () => {
    await seed("students/student-existing", { id: "student-existing", schoolId: schoolA, schoolYearId: yearA1, status: "ACTIVE", nom: "Élève" });
    await assertFails(updateDoc(doc(user("school_admin"), "students", "student-existing"), { schoolYearId: yearA2 }));
  });

  it("refuse les écritures médicales dans une année archivée", async () => {
    await seed("students/student-archived", { id: "student-archived", schoolId: schoolA, schoolYearId: yearA2, status: "ACTIVE" });
    await assertFails(setDoc(doc(user("secretary", schoolA, "secretary-a"), "studentMedicalRecords", "student-archived"), {
      id: "student-archived", studentId: "student-archived", schoolId: schoolA, schoolYearId: yearA2,
      createdBy: "secretary-a", createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }));
  });

  it("refuse sanctions et présences hors année active", async () => {
    const discipline = user("discipline_director", schoolA, "discipline-a");
    await assertFails(setDoc(doc(discipline, "disciplineSanctions", "sanction-archived"), {
      id: "sanction-archived", schoolId: schoolA, schoolYearId: yearA2, studentId: "student-a", studentName: "Élève",
      className: "1 A", reason: "Retard", sanctionType: "Avertissement", duration: 1, startDate: "2026-08-01",
      expectedEndDate: "2026-08-02", status: "active", createdBy: "discipline-a", createdAt: "2026-08-01T08:00:00.000Z",
    }));
    await assertFails(setDoc(doc(discipline, "attendance", "attendance-other-school"), {
      id: "attendance-other-school", schoolId: schoolA, schoolYearId: yearB1, studentId: "student-a", status: "absent",
    }));
  });

  it("conserve la lecture des archives autorisées et isole chaque requête par année", async () => {
    const collections = ["students", "payments", "secretaryReports", "studentMedicalRecords", "disciplineSanctions", "attendance"];
    for (const collectionName of collections) {
      await seed(`${collectionName}/${collectionName}-active`, { id: `${collectionName}-active`, studentId: "student-a", schoolId: schoolA, schoolYearId: yearA1, status: "draft" });
      await seed(`${collectionName}/${collectionName}-archived`, { id: `${collectionName}-archived`, studentId: "student-a", schoolId: schoolA, schoolYearId: yearA2, status: "archived" });
      await seed(`${collectionName}/${collectionName}-other-school`, { id: `${collectionName}-other-school`, studentId: "student-b", schoolId: schoolB, schoolYearId: yearB1, status: "draft" });
    }

    const roleByCollection: Record<string, string> = {
      students: "school_admin", payments: "school_admin", secretaryReports: "secretary",
      studentMedicalRecords: "secretary", disciplineSanctions: "discipline_director", attendance: "discipline_director",
    };
    for (const collectionName of collections) {
      const firestore = user(roleByCollection[collectionName]);
      const active = await assertSucceeds(getDocs(query(collection(firestore, collectionName), where("schoolId", "==", schoolA), where("schoolYearId", "==", yearA1))));
      const archived = await assertSucceeds(getDocs(query(collection(firestore, collectionName), where("schoolId", "==", schoolA), where("schoolYearId", "==", yearA2))));
      expect(active.docs.map((item) => item.id)).toEqual([`${collectionName}-active`]);
      expect(archived.docs.map((item) => item.id)).toEqual([`${collectionName}-archived`]);
    }
  });
});
