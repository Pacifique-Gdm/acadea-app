import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { executeSchoolYearArchive } from "../../api/_lib/schoolYearArchive.js";

const app = initializeApp({ projectId: "demo-school-year-archive" }, "school-year-archive-tests");
const db = getFirestore(app);
const roles = ["study_director", "cashier", "parent", "discipline_director", "secretary", "teacher"] as const;
const caller = (role: typeof roles[number], schoolId = "school") => ({ uid: `${role}-user`, role, schoolId });
const scope = { schoolId: "school", schoolYearId: "archived-year" };

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST?.match(/^(127\.0\.0\.1|localhost):\d+$/)) throw new Error("Émulateur Firestore local requis.");
});
beforeEach(async () => {
  for (const name of ["users", "schoolYears", "classes", "payments", "expenses", "parents", "students", "teachers", "pedagogicalAssignments", "subjects", "disciplineSanctions"]) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  const batch = db.batch();
  const fixtures: Record<string, Record<string, unknown>> = {
    "schoolYears/archived-year": { schoolId: "school", name: "2026-2027", status: "archived" },
    "schoolYears/active-year": { schoolId: "school", name: "2027-2028", status: "active" },
    "schoolYears/foreign-year": { schoolId: "other", name: "2026-2027", status: "archived" },
    "classes/class": { ...scope, name: "Classe fictive", section: "Secondaire" },
    "classes/other-class": { schoolId: "other", schoolYearId: "archived-year", name: "Classe étrangère" },
    "payments/payment": { ...scope, amount: 100, currency: "CDF" },
    "payments/arrears": { schoolId: "school", schoolYearId: "older-year", collectionSchoolYearId: "archived-year", amount: 25, currency: "CDF" },
    "expenses/expense": { ...scope, amount: 50, currency: "CDF" },
    "parents/parent-profile": { schoolId: "school", studentIds: ["child"] },
    "students/child": { ...scope, nom: "Enfant", className: "Classe fictive", section: "Secondaire" },
    "students/foreign-child": { schoolId: "other", schoolYearId: "archived-year", nom: "Autre" },
    "teachers/teacher": { ...scope, userId: "teacher-user" },
    "subjects/subject": { ...scope, name: "Cours fictif" },
    "pedagogicalAssignments/assignment": { ...scope, teacherId: "teacher", classId: "class", subjectId: "subject" },
    "disciplineSanctions/sanction": { ...scope, studentId: "child" },
  };
  roles.forEach((role) => { fixtures[`users/${role}-user`] = { schoolId: "school", role, status: "active", ...(role === "parent" ? { parentId: "parent-profile" } : {}), ...(role === "discipline_director" ? { sectionIds: ["Secondaire"] } : {}) }; });
  Object.entries(fixtures).forEach(([path, value]) => batch.set(db.doc(path), value));
  await batch.commit();
}, 30000);
afterAll(() => deleteApp(app), 30000);

describe("archives en lecture seule côté serveur", () => {
  it.each(roles)("borne les archives du rôle %s", async (role) => {
    const result = await executeSchoolYearArchive({ db, caller: caller(role), body: { action: "archive-summary", schoolId: "school", schoolYearId: "archived-year" } });
    expect(result.year.id).toBe("archived-year");
    expect(result.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Classe étrangère");
    expect(JSON.stringify(result)).not.toContain("Autre");
    await expect(executeSchoolYearArchive({ db, caller: caller(role), body: { action: "archive-summary", schoolId: "school", schoolYearId: "active-year" } })).rejects.toMatchObject({ status: 403 });
    await expect(executeSchoolYearArchive({ db, caller: caller(role), body: { action: "archive-summary", schoolId: "other", schoolYearId: "foreign-year" } })).rejects.toMatchObject({ status: 403 });
  });
  it("ne rend visibles que les années archivées du tenant", async () => {
    const result = await executeSchoolYearArchive({ db, caller: caller("secretary"), body: { action: "archive-years", schoolId: "school" } });
    expect(result.years.map((year: { id: string }) => year.id)).toEqual(["archived-year"]);
  });
  it("compte les paiements de l'année et les arriérés encaissés cette année", async () => {
    const result = await executeSchoolYearArchive({ db, caller: caller("cashier"), body: { action: "archive-summary", schoolId: "school", schoolYearId: "archived-year" } });
    expect(result.items[0]).toEqual({ label: "Paiements", detail: "2 opération(s) enregistrée(s)" });
  });
  it("réévalue le lien Parent après suppression", async () => {
    await db.doc("parents/parent-profile").update({ studentIds: [] });
    const result = await executeSchoolYearArchive({ db, caller: caller("parent"), body: { action: "archive-summary", schoolId: "school", schoolYearId: "archived-year" } });
    expect(result.items).toEqual([]);
  });
});
