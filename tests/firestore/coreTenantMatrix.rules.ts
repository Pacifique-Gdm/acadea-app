import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const projectId = "demo-acadea-core-tenant-matrix";
const schoolA = "school-a";
const schoolB = "school-b";
const yearA = "year-a";
const yearB = "year-b";
let environment: RulesTestEnvironment;

function auth(uid: string, role: string, schoolId = schoolA) {
  return environment.authenticatedContext(uid, { role, schoolId }).firestore();
}

async function seed(path: string, data: Record<string, unknown>) {
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), path), data));
}

beforeAll(async () => {
  environment = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync("firestore.rules", "utf8") } });
}, 30000);

beforeEach(async () => {
  await environment.clearFirestore();
  await seed(`schools/${schoolA}`, { id: schoolA, name: "École A", status: "active" });
  await seed(`schools/${schoolB}`, { id: schoolB, name: "École B", status: "active" });
  await seed(`schoolYears/${yearA}`, { id: yearA, schoolId: schoolA, status: "active" });
  await seed(`schoolYears/${yearB}`, { id: yearB, schoolId: schoolB, status: "active" });
  for (const name of ["students", "parents", "teachers", "classes", "feeTypes"]) {
    await seed(`${name}/${name}-a`, { id: `${name}-a`, schoolId: schoolA, schoolYearId: yearA, status: "active", ...(name === "students" ? { section: "secondaire" } : {}) });
    await seed(`${name}/${name}-b`, { id: `${name}-b`, schoolId: schoolB, schoolYearId: yearB, status: "active", ...(name === "students" ? { section: "secondaire" } : {}) });
  }
  await seed("users/admin-a", { id: "admin-a", role: "school_admin", schoolId: schoolA, status: "active" });
  await seed("users/admin-b", { id: "admin-b", role: "school_admin", schoolId: schoolB, status: "active" });
  await seed("users/cashier-a", { id: "cashier-a", role: "cashier", schoolId: schoolA, status: "active", active: true });
  await seed("users/discipline-a", { id: "discipline-a", role: "discipline_director", schoolId: schoolA, status: "active" });
  await seed("users/teacher-a", { id: "teacher-a", role: "teacher", schoolId: schoolA, status: "active" });
  await seed("users/studies-a", { id: "studies-a", role: "study_director", schoolId: schoolA, status: "active" });
});

afterAll(async () => environment?.cleanup(), 30000);

describe("SEC-015 — matrice centrale d'isolation tenant", () => {
  it("autorise les lectures métier du tenant et refuse systématiquement l'autre école", async () => {
    const admin = auth("admin-a", "school_admin");
    for (const name of ["students", "parents", "teachers", "classes", "feeTypes"]) {
      await assertSucceeds(getDoc(doc(admin, name, `${name}-a`)));
      await assertFails(getDoc(doc(admin, name, `${name}-b`)));
    }
  });

  it("refuse les lectures métier non authentifiées et aux rôles inconnus", async () => {
    const anonymous = environment.unauthenticatedContext().firestore();
    const unknown = auth("unknown-a", "unknown");
    for (const name of ["schools", "schoolYears", "students", "parents", "teachers", "classes", "feeTypes"]) {
      const id = name === "schools" ? schoolA : name === "schoolYears" ? yearA : `${name}-a`;
      await assertFails(getDoc(doc(anonymous, name, id)));
      await assertFails(getDoc(doc(unknown, name, id)));
    }
  });

  it("autorise le bootstrap complet du Directeur des études actif dans sa propre école", async () => {
    const director = auth("studies-a", "study_director");
    await assertSucceeds(getDoc(doc(director, "schools", schoolA)));
    await assertSucceeds(getDoc(doc(director, "schoolYears", yearA)));
    const years = await assertSucceeds(getDocs(query(collection(director, "schoolYears"), where("schoolId", "==", schoolA))));
    expect(years.docs.map((item) => item.id)).toEqual([yearA]);
    await assertFails(getDoc(doc(director, "schools", schoolB)));
    await assertFails(getDoc(doc(director, "schoolYears", yearB)));
    await assertFails(getDocs(query(collection(director, "schoolYears"), where("schoolId", "==", schoolB))));
    await assertSucceeds(getDoc(doc(director, "students", "students-a")));
    const students = await assertSucceeds(getDocs(query(collection(director, "students"), where("schoolId", "==", schoolA), where("schoolYearId", "==", yearA))));
    expect(students.docs.map((item) => item.id)).toEqual(["students-a"]);
    await assertFails(getDoc(doc(director, "students", "students-b")));
    await assertFails(getDocs(query(collection(director, "students"), where("schoolId", "==", schoolB), where("schoolYearId", "==", yearB))));
    await assertFails(updateDoc(doc(director, "schoolYears", yearA), { label: "Interdit" }));
  });

  it("exige un filtre tenant pour les requêtes de liste", async () => {
    const admin = auth("admin-a", "school_admin");
    const isolated = await assertSucceeds(getDocs(query(collection(admin, "students"), where("schoolId", "==", schoolA))));
    expect(isolated.docs.map((item) => item.id)).toEqual(["students-a"]);
    await assertFails(getDocs(collection(admin, "students")));
  });

  it("préserve la propriété du profil et interdit l'escalade de rôle", async () => {
    const admin = auth("admin-a", "school_admin");
    await assertSucceeds(getDoc(doc(admin, "users", "admin-a")));
    await assertFails(getDoc(doc(admin, "users", "admin-b")));
    await assertFails(updateDoc(doc(admin, "users", "admin-a"), { role: "super_admin" }));
  });

  it("autorise au Caissier uniquement les personnels agrégés de son Dashboard et préserve l'isolation école", async () => {
    const cashier = auth("cashier-a", "cashier");
    const personnel = await assertSucceeds(getDocs(query(
      collection(cashier, "users"),
      where("schoolId", "==", schoolA),
      where("role", "in", ["school_admin", "cashier", "discipline_director"]),
    )));
    expect(personnel.docs.map((item) => item.id).sort()).toEqual(["admin-a", "cashier-a", "discipline-a"]);
    await assertFails(getDocs(query(
      collection(cashier, "users"),
      where("schoolId", "==", schoolB),
      where("role", "in", ["school_admin", "cashier", "discipline_director"]),
    )));
    await assertFails(getDocs(query(
      collection(cashier, "users"),
      where("schoolId", "==", schoolA),
      where("role", "in", ["school_admin", "teacher"]),
    )));
  });

  it("autorise les créations administratives de l'année active et refuse l'année d'une autre école", async () => {
    const admin = auth("admin-a", "school_admin");
    for (const name of ["students", "parents", "teachers", "classes", "feeTypes"]) {
      await assertSucceeds(setDoc(doc(admin, name, `${name}-new`), { id: `${name}-new`, schoolId: schoolA, schoolYearId: yearA, status: "active" }));
      await assertFails(setDoc(doc(admin, name, `${name}-foreign-year`), { id: `${name}-foreign-year`, schoolId: schoolA, schoolYearId: yearB, status: "active" }));
    }
  });

  it("applique les politiques update/delete sans élargir les rôles", async () => {
    const admin = auth("admin-a", "school_admin");
    await assertSucceeds(updateDoc(doc(admin, "students", "students-a"), { status: "inactive" }));
    await assertFails(deleteDoc(doc(admin, "students", "students-a")));
    for (const name of ["parents", "teachers", "classes", "feeTypes"]) {
      await assertSucceeds(updateDoc(doc(admin, name, `${name}-a`), { label: "Mise à jour" }));
      await assertSucceeds(deleteDoc(doc(admin, name, `${name}-a`)));
    }
    await assertFails(updateDoc(doc(auth("cashier-a", "cashier"), "classes", "classes-a"), { label: "Interdit" }));
    await assertFails(deleteDoc(doc(auth("secretary-a", "secretary"), "parents", "parents-a")));
  });

  it("réserve écoles et années scolaires aux rôles autorisés", async () => {
    const superAdmin = auth("super-a", "super_admin", "");
    await assertSucceeds(setDoc(doc(superAdmin, "schools", "school-c"), { id: "school-c", name: "École C", status: "active" }));
    await assertSucceeds(deleteDoc(doc(superAdmin, "schools", "school-c")));
    await assertFails(setDoc(doc(auth("secretary-a", "secretary"), "schools", "school-c"), { id: "school-c", status: "active" }));

    const admin = auth("admin-a", "school_admin");
    await assertSucceeds(setDoc(doc(admin, "schoolYears", "year-a-2"), { id: "year-a-2", schoolId: schoolA, status: "active" }));
    await assertSucceeds(updateDoc(doc(admin, "schoolYears", "year-a-2"), { label: "2027-2028" }));
    await assertFails(setDoc(doc(admin, "schoolYears", "year-b-2"), { id: "year-b-2", schoolId: schoolB, status: "active" }));
    await assertFails(deleteDoc(doc(admin, "schoolYears", "year-a-2")));
    await assertFails(deleteDoc(doc(admin, "users", "admin-a")));
  });
});
