import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { listStaffChildren } from "./staffChildren.js";

// Base en mémoire : seules les lectures utilisées par le service (doc().get(), collection().where().get()).
function memoryDb(values) {
  const snap = (path) => ({ exists: values.has(path), id: path.split("/").at(-1), data: () => values.get(path) });
  return {
    doc: (path) => ({ get: async () => snap(path) }),
    collection: (name) => ({ where: (key, _op, value) => ({ get: async () => ({ docs: [...values].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/").length === 2 && data[key] === value).map(([path]) => snap(path)) }) }) }),
  };
}
const school = "school-a", year = "year-1";
function seeded() {
  const v = new Map();
  v.set(`schools/${school}`, { activeSchoolYearId: year, currency: "USD" });
  v.set(`schools/school-b`, { activeSchoolYearId: "year-b", currency: "USD" });
  v.set("feeTypes/minerval", { schoolId: school, schoolYearId: year, name: "Minerval", amount: 100, className: "3ème Primaire" });
  v.set("feeTypes/autre-ecole", { schoolId: "school-b", schoolYearId: year, name: "Secret", amount: 999 });
  v.set("students/enfant-1", { schoolId: school, schoolYearId: year, nom: "KABEYA", prenom: "Grâce", className: "3ème Primaire", medicalNotes: "confidentiel", financialSupport: { d1: { schoolYearId: year, lines: { minerval: { reductionMinor: 5000 } } } } });
  v.set("students/enfant-2", { schoolId: school, schoolYearId: year, nom: "AUTRE", prenom: "Élève", className: "3ème Primaire" });
  v.set("socialSupportDecisions/d1", { schoolId: school, schoolYearId: year, studentId: "enfant-1", personnelId: "teacher-1", reason: "personnel", nature: "percent", status: "active", observation: "note interne", lines: { minerval: { feeName: "Minerval", value: 50, officialMinor: 10000, reductionMinor: 5000 } } });
  v.set("socialSupportDecisions/d2", { schoolId: school, schoolYearId: year, studentId: "enfant-2", personnelId: "teacher-2", reason: "personnel", nature: "full", status: "active", lines: {} });
  v.set("socialSupportDecisions/d3", { schoolId: school, schoolYearId: "ancienne", studentId: "enfant-2", personnelId: "teacher-1", reason: "personnel", nature: "full", status: "active", lines: {} });
  v.set("socialSupportDecisions/d4", { schoolId: school, schoolYearId: year, studentId: "enfant-2", personnelId: "teacher-1", reason: "personnel", nature: "full", status: "cancelled", lines: {} });
  v.set("payments/p1", { schoolId: school, schoolYearId: year, studentId: "enfant-1", feeTypeId: "minerval", amount: 30, receiptNumber: "R-1", cashierId: "cashier-x" });
  v.set("payments/p2", { schoolId: school, schoolYearId: year, studentId: "enfant-2", feeTypeId: "minerval", amount: 100 });
  return v;
}

describe("lot 3 : enfants à la charge du personnel (serveur)", () => {
  it("renvoie SEULEMENT les enfants dont la décision active de l'année désigne ce membre du personnel", async () => {
    const result = await listStaffChildren({ db: memoryDb(seeded()), caller: { uid: "teacher-1", role: "teacher", schoolId: school } });
    expect(result.children.map((child) => child.student.id)).toEqual(["enfant-1"]);
    expect(result.children[0].payments.map((payment) => payment.id)).toEqual(["p1"]);
    expect(result.children[0].decision).toMatchObject({ nature: "percent", lines: { minerval: { value: 50, reductionMinor: 5000 } } });
  });

  it("ne renvoie ni la note interne de la décision, ni les champs privés de l'élève, ni les frais d'une autre école", async () => {
    const result = await listStaffChildren({ db: memoryDb(seeded()), caller: { uid: "teacher-1", role: "teacher", schoolId: school } });
    const text = JSON.stringify(result);
    expect(text).not.toContain("note interne");
    expect(text).not.toContain("confidentiel");
    expect(text).not.toContain("cashier-x");
    expect(result.feeTypes.map((fee) => fee.id)).toEqual(["minerval"]);
  });

  it("personnel sans enfant à charge : liste vide", async () => {
    const result = await listStaffChildren({ db: memoryDb(seeded()), caller: { uid: "secretary-9", role: "secretary", schoolId: school } });
    expect(result.children).toEqual([]);
  });

  it("une décision d'une autre école ne sort jamais", async () => {
    const result = await listStaffChildren({ db: memoryDb(seeded()), caller: { uid: "teacher-2", role: "teacher", schoolId: "school-b" } });
    expect(result.children).toEqual([]);
  });

  it("refuse les parents, la coordination et les comptes sans école (403)", async () => {
    for (const caller of [{ uid: "p", role: "parent", schoolId: school }, { uid: "c", role: "coordination_admin", schoolId: school }, { uid: "t", role: "teacher" }]) {
      await expect(listStaffChildren({ db: memoryDb(seeded()), caller })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("le point d'entrée existant reçoit l'action sans toucher aux autres actions", () => {
    const source = readFileSync("api/manage-financial-transaction.js", "utf8");
    expect(source).toContain('if (requestedAction === "list-staff-children") {');
    expect(source).toContain("return sendJson(res, 200, await listStaffChildren({ db, caller }));");
  });
});
