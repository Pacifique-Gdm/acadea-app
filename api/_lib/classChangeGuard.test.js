// Protection provisoire (22/11) : pas de changement de classe pour un élève qui a déjà payé cette année.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saveManualStudent } from "./manualStudentSave.js";
import { CLASS_CHANGE_WITH_PAYMENTS_MESSAGE, hasYearPayments, isClassChange } from "../../src/utils/classChangeGuard.js";

const secretary = { uid: "secretary-a", role: "secretary", schoolId: "school-a" };
const base = { id: `student-${"d".repeat(32)}`, schoolId: "school-a", schoolYearId: "year-a", classId: "class-a", className: "1ère Primaire",
  nom: "MUKENDI", postnom: "Ilunga", prenom: "Paul", sexe: "M", birthDate: "2015-04-05", status: "ACTIVE", matricule: "ACD-26-0002" };

function fixture(extra = []) {
  const rows = new Map([
    ["users/secretary-a", { role: "secretary", schoolId: "school-a", active: true, name: "Secrétaire A" }],
    ["schools/school-a", { status: "active", activeSchoolYearId: "year-a" }],
    ["schoolYears/year-a", { name: "2026-2027", schoolId: "school-a", status: "active" }],
    ["classes/class-a", { name: "1ère Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true }],
    ["classes/class-b", { name: "2ème Primaire", schoolId: "school-a", schoolYearId: "year-a", active: true }],
    [`students/${base.id}`, { ...base }],
    ...extra,
  ]);
  const snapshot = (path) => ({ id: path.split("/").at(-1), exists: rows.has(path), data: () => structuredClone(rows.get(path)) });
  const db = {
    doc: (path) => ({ path }),
    collection: (collection) => {
      const filters = [];
      const query = { where(field, op, value) { filters.push([field, op, value]); return query; }, select() { return query; }, limit() { return query; }, collection, filters };
      return query;
    },
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (ref) => ref.path ? snapshot(ref.path) : { docs: [...rows.keys()].filter((path) => path.startsWith(`${ref.collection}/`))
          .filter((path) => ref.filters.every(([field, op, value]) => { const v = rows.get(path)?.[field]; return op === ">=" ? v >= value : op === "<" ? v < value : v === value; })).map(snapshot) },
        set: (ref, data) => writes.push([ref.path, data]), create: (ref, data) => writes.push([ref.path, data]), delete: (ref) => writes.push([ref.path, null]),
      });
      for (const [path, data] of writes) { if (data) rows.set(path, data); else rows.delete(path); }
      return result;
    },
  };
  return { db, rows };
}
const payment = (schoolYearId = "year-a") => [`payments/pay-1`, { id: "pay-1", studentId: base.id, schoolId: "school-a", schoolYearId, amount: 10 }];
const moved = { ...base, classId: "class-b", className: "2ème Primaire" };

describe("protection : changement de classe d'un élève qui a déjà payé", () => {
  it("le serveur refuse le changement de classe s'il existe un paiement cette année, avec le message demandé", async () => {
    const { db, rows } = fixture([payment()]);
    await expect(saveManualStudent({ db, caller: secretary, body: { intent: "update", student: moved } })).rejects.toMatchObject({ message: CLASS_CHANGE_WITH_PAYMENTS_MESSAGE, statusCode: 409 });
    expect(rows.get(`students/${base.id}`).className).toBe("1ère Primaire");
  });

  it("sans paiement cette année (ou un paiement d'une autre année), le changement reste possible", async () => {
    const { db, rows } = fixture([payment("year-old")]);
    await saveManualStudent({ db, caller: secretary, body: { intent: "update", student: moved } });
    expect(rows.get(`students/${base.id}`).className).toBe("2ème Primaire");
  });

  it("avec un paiement, les autres modifications (téléphone) restent possibles sans changer la classe", async () => {
    const { db, rows } = fixture([payment()]);
    await saveManualStudent({ db, caller: secretary, body: { intent: "update", student: { ...base, phone: "0990000000" } } });
    expect(rows.get(`students/${base.id}`).phone).toBe("0990000000");
  });

  it("règle commune : classe ou libellé changés, paiements de la même école et de la même année seulement", () => {
    expect(isClassChange({ classId: "a", className: "X" }, { classId: "b", className: "X" })).toBe(true);
    expect(isClassChange({ classId: "a", className: "X" }, { classId: "a", className: "Y" })).toBe(true);
    expect(isClassChange({ classId: "a", className: "X" }, { classId: "a", className: "X" })).toBe(false);
    expect(hasYearPayments([{ studentId: "s", schoolId: "e", schoolYearId: "y" }], "s", "e", "y")).toBe(true);
    expect(hasYearPayments([{ studentId: "s", schoolId: "autre", schoolYearId: "y" }], "s", "e", "y")).toBe(false);
    expect(hasYearPayments([], "s", "e", "y")).toBe(false);
  });

  it("l'écran (fiche élève) refuse aussi avant d'envoyer, avec le même message", () => {
    const drawer = readFileSync("src/components/students/StudentRecordDrawer.tsx", "utf8");
    const save = drawer.slice(drawer.indexOf("async function saveStudent"));
    expect(save.indexOf("CLASS_CHANGE_WITH_PAYMENTS_MESSAGE")).toBeGreaterThan(-1);
    expect(save.indexOf("CLASS_CHANGE_WITH_PAYMENTS_MESSAGE")).toBeLessThan(save.indexOf("await saveManualStudent("));
  });
});
