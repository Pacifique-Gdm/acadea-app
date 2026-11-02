import { describe, expect, it } from "vitest";
import { listSectionSchoolRecords, loadSectionSchoolBootstrap } from "./sectionSchoolRecords.js";
import { loadSectionDashboard, sectionDashboardClassRows, sectionDashboardTotals } from "./sectionDashboard.js";
import { buildDashboardFinancialAggregates } from "../../src/utils/dashboardStats";
import type { Student, FeeType, Payment } from "../../src/types";

const caller = { uid: "actor", role: "primary_admin", schoolId: "a" };
function fixture() {
  const rows = new Map<string, Record<string, unknown>>([
    ["users/actor", { ...caller, status: "active", sectionIds: ["Primaire"] }],
    ["schools/a", { status: "active" }], ["schoolYears/y", { schoolId: "a" }],
    ["students/one", { schoolId: "a", schoolYearId: "y", section: "Primaire" }],
    ["students/other", { schoolId: "a", schoolYearId: "y", section: "Secondaire" }],
    ["students/foreign", { schoolId: "b", schoolYearId: "y", section: "Primaire" }],
    ["students/legacy", { schoolId: "a", schoolYearId: "y", className: "1ère Primaire" }],
    ["classes/one::a", { schoolId: "a", schoolYearId: "y", section: "Primaire" }],
  ]);
  const snapshot = (path: string) => ({ id: path.split("/").at(-1)!, exists: rows.has(path), data: () => rows.get(path)! });
  type Filter = [string, string, unknown];
  const reads: Array<{ name: string; filters: Filter[] }> = [];
  function query(name: string, filters: Filter[] = [], after = "", count = 101) {
    return {
      where: (field: string, op: string, value: unknown): ReturnType<typeof query> => query(name, [...filters, [field, op, value]], after, count),
      orderBy: (): ReturnType<typeof query> => query(name, filters, after, count),
      startAfter: (record: { id: string }): ReturnType<typeof query> => query(name, filters, record.id, count),
      limit: (limit: number): ReturnType<typeof query> => query(name, filters, after, limit),
      get: async () => {
        reads.push({ name, filters });
        return { docs: [...rows].filter(([path, data]) => path.startsWith(`${name}/`) && path.split("/")[1] > after
          && filters.every(([field, op, value]) => op === "in" ? (value as unknown[]).includes(data[field]) : data[field] === value))
          .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).slice(0, count).map(([path]) => snapshot(path)) };
      },
    };
  }
  const db = { doc: (path: string) => ({ path }), collection: (name: string) => query(name),
    runTransaction: async <T>(run: (tx: { get: (ref: { path: string } | ReturnType<typeof query>) => Promise<unknown> }) => Promise<T>) =>
      run({ get: async (ref) => "path" in ref ? snapshot(ref.path) : ref.get() }) };
  return { db, rows, reads };
}
const body = { action: "list-section-school-records", kind: "students", schoolYearId: "y" };

describe("lecture scolaire transactionnelle bornée", () => {
  it("limite les valves à une section explicite et supprime les URL à jeton", async () => {
    const { db, rows } = fixture();
    rows.set("valves/v", { schoolId: "a", schoolYearId: "y", visibility: "Primaire", title: "Test", attachmentUrl: "SECRET", attachments: [{ path: "valves/a/y/v/file.pdf", url: "SECRET", name: "Test", size: 10, type: "application/pdf" }] });
    rows.set("valves/other", { schoolId: "a", schoolYearId: "y", visibility: "Secondaire" });
    rows.set("valves/ambiguous", { schoolId: "a", schoolYearId: "y", visibility: "all_parents" });
    const result = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "valves" } });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["v"]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.items[0].attachments).toEqual([{ path: "valves/a/y/v/file.pdf", name: "Test", size: 10, type: "application/pdf" }]);
  });
  it("lit les fiches médicales par les élèves autorisés, jamais par une requête globale", async () => {
    const { db, rows, reads } = fixture();
    rows.set("studentMedicalRecords/one", { studentId: "one", schoolId: "a", schoolYearId: "y", allergies: "Test" });
    rows.set("studentMedicalRecords/other", { studentId: "other", schoolId: "a", schoolYearId: "y", allergies: "Secret" });
    const result = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "medicalRecords" } });
    expect(result.items).toEqual([{ id: "one", studentId: "one", schoolId: "a", schoolYearId: "y", section: "Primaire", allergies: "Test" }]);
    expect(reads.every((query) => query.name === "students")).toBe(true);
    rows.set("studentMedicalRecords/one", { studentId: "other", schoolId: "a", schoolYearId: "y" });
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, kind: "medicalRecords" } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("projette le personnel global sans comptes parents ni informations administratives privées", async () => {
    const { db, rows } = fixture();
    rows.set("users/teacher", { schoolId: "a", role: "teacher", name: "Test", sectionIds: ["Secondaire"], email: "private", phone: "private", permissions: ["private"] });
    rows.set("users/parent", { schoolId: "a", role: "parent", name: "Parent" });
    rows.set("users/foreign", { schoolId: "b", role: "teacher", name: "Foreign" });
    const result = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "personnel" } });
    expect(result.items.find((item: { id: string }) => item.id === "teacher")).toEqual({ id: "teacher", schoolId: "a", name: "Test", role: "teacher" });
    expect(result.items.map((item: { id: string }) => item.id)).not.toContain("parent");
    expect(result.items.map((item: { id: string }) => item.id)).not.toContain("foreign");
    expect(JSON.stringify(result)).not.toContain("private");
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, kind: "personnel", cursorId: "parent" } })).rejects.toMatchObject({ statusCode: 403 });
    rows.set("personnelProfiles/service", { kind: "service", schoolId: "a", name: "Test", jobTitle: "Gardien", bankAccount: "private" });
    rows.set("personnelProfiles/profile", { schoolId: "a", name: "Confidentiel" });
    const service = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "servicePersonnel" } });
    expect(service.items).toEqual([{ id: "service", schoolId: "a", kind: "service", name: "Test", jobTitle: "Gardien" }]);
  });
  it("agrège le Dashboard sans exposer les parents mixtes ni les autres sections", async () => {
    const { db, rows } = fixture();
    rows.set("schools/a", { status: "active", currency: "CDF" });
    rows.set("students/one", { schoolId: "a", schoolYearId: "y", section: "Primaire", parentId: "mixed", className: "1ère Primaire" });
    rows.set("parents/mixed", { schoolId: "a", studentIds: ["one", "other"], confidential: "never-return" });
    rows.set("parents/foreign", { schoolId: "b", studentIds: ["one"] });
    rows.set("feeTypes/fee", { schoolId: "a", schoolYearId: "y", name: "Minerval", amount: 100 });
    rows.set("payments/p", { schoolId: "a", schoolYearId: "y", studentId: "one", feeTypeId: "fee", amount: 25.25, currency: "CDF", paidAt: "2026-11-01" });
    rows.set("payments/other", { schoolId: "a", schoolYearId: "y", studentId: "other", feeTypeId: "fee", amount: 999, currency: "CDF" });
    const request = { action: "load-section-dashboard", schoolYearId: "y" };
    const result = await loadSectionDashboard({ db, caller, body: request });
    expect(result.financialStats).toEqual({ expected: 100, paid: 25.25, remaining: 74.75 });
    expect(result.classRows).toEqual([{ className: "1ère Primaire", girls: 0, boys: 0, total: 1 }]);
    expect(result.parents).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/never-return|mixed|studentIds/);
    await expect(loadSectionDashboard({ db, caller, body: { ...request, section: "Secondaire" } })).rejects.toMatchObject({ statusCode: 403 });
    await expect(loadSectionDashboard({ db, caller, body: { ...request, schoolId: "b" } })).rejects.toMatchObject({ statusCode: 400 });
    rows.set("users/actor", { ...rows.get("users/actor"), active: false });
    await expect(loadSectionDashboard({ db, caller, body: request })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("conserve les règles de calcul et refuse les devises incohérentes", () => {
    const students = [{ id: "s", className: "1ère Primaire" }] as Student[];
    const fees = [{ id: "f", name: "Minerval", amount: 100 }, { id: "unpaid", name: "Autre", amount: 50 }] as FeeType[];
    const payments = [{ id: "p", studentId: "s", feeTypeId: "f", amount: 30.25, currency: "CDF" }] as Payment[];
    expect(sectionDashboardTotals(students, fees, payments, "CDF")).toEqual(buildDashboardFinancialAggregates(students, fees, payments));
    expect(() => sectionDashboardTotals(students, fees, payments, "USD")).toThrow("Devise");
  });
  it("agrège les classes autorisées sans confondre les options du Secondaire", () => {
    expect(sectionDashboardClassRows([
      { className: "1ère Humanité", section: "Secondaire", option: "Sciences", sexe: "F" },
      { className: "1ère Humanité", section: "Secondaire", option: "Lettres", sexe: "M" },
    ])).toEqual([
      { className: "1ère Lettres", girls: 0, boys: 1, total: 1 },
      { className: "1ère Sciences", girls: 1, boys: 0, total: 1 },
    ]);
  });
  it("lit les définitions de frais de l'année sans leur inventer de section", async () => {
    const { db, rows, reads } = fixture();
    rows.set("feeTypes/fee", { schoolId: "a", schoolYearId: "y", amount: 10 });
    rows.set("feeTypes/foreign", { schoolId: "b", schoolYearId: "y", amount: 20 });
    const result = await listSectionSchoolRecords({ db, caller, body: { ...body, kind: "feeTypes" } });
    expect(result.items).toEqual([{ id: "fee", schoolId: "a", schoolYearId: "y", amount: 10 }]);
    expect(reads[0].filters).toEqual([["schoolId", "==", "a"], ["schoolYearId", "==", "y"]]);
  });
  it("charge uniquement le propre profil et les références publiques de son école", async () => {
    const { db, rows, reads } = fixture();
    rows.set("schools/a", { status: "active", name: "Fictive", privateMetadata: "excluded" });
    rows.set("users/other", { schoolId: "a", role: "parent" });
    rows.set("schoolYears/foreign", { schoolId: "b" });
    const result = await loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap" } });
    expect(result.users).toHaveLength(1);
    expect(result.users[0]).toMatchObject({ id: "actor", role: "primary_admin", sectionIds: ["Primaire"] });
    expect(result.schools).toEqual([{ id: "a", name: "Fictive", status: "active" }]);
    expect(result.schoolYears.map((year: { id: string }) => year.id)).toEqual(["y"]);
    expect(reads).toEqual([{ name: "schoolYears", filters: [["schoolId", "==", "a"]] }]);
  });
  it("refuse le bootstrap désactivé et toute école demandée par le client", async () => {
    const { db, rows } = fixture();
    await expect(loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap", schoolId: "b" } })).rejects.toMatchObject({ statusCode: 400 });
    rows.set("users/actor", { ...rows.get("users/actor"), active: false });
    await expect(loadSectionSchoolBootstrap({ db, caller, body: { action: "load-section-school-bootstrap" } })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("borne la requête avant lecture et n'infère pas une section historique", async () => {
    const { db, reads } = fixture();
    const result = await listSectionSchoolRecords({ db, caller, body });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(["one"]);
    expect(reads).toEqual([{ name: "students", filters: [["schoolId", "==", "a"], ["schoolYearId", "==", "y"], ["section", "in", ["Primaire"]]] }]);
  });
  it("accepte les anciens identifiants de classe avec séparateur d'option", async () => {
    const { db } = fixture();
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, kind: "classes", cursorId: "one::a" } })).resolves.toMatchObject({ items: [] });
  });
  it.each(["other", "foreign", "missing"])("refuse le curseur non autorisé %s", async (cursorId) => {
    const { db, reads } = fixture();
    await expect(listSectionSchoolRecords({ db, caller, body: { ...body, cursorId } })).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toEqual([]);
  });
  it.each([{ status: "inactive" }, { active: false }, { sectionIds: [] }, { schoolId: "b" }, { role: "school_admin" }])("refuse un profil invalide avant lecture", async (patch) => {
    const { db, rows, reads } = fixture();
    rows.set("users/actor", { ...rows.get("users/actor"), ...patch });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toEqual([]);
  });
  it("refuse une école suspendue et une année étrangère", async () => {
    const { db, rows } = fixture();
    rows.set("schools/a", { status: "suspended" });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
    rows.set("schools/a", { status: "active" }); rows.set("schoolYears/y", { schoolId: "b" });
    await expect(listSectionSchoolRecords({ db, caller, body })).rejects.toMatchObject({ statusCode: 403 });
  });
  it("pagine sans perte ni doublon", async () => {
    const { db, rows } = fixture();
    for (let i = 0; i < 105; i++) rows.set(`students/p${String(i).padStart(3, "0")}`, { schoolId: "a", schoolYearId: "y", section: "Primaire" });
    const first = await listSectionSchoolRecords({ db, caller, body });
    const second = await listSectionSchoolRecords({ db, caller, body: { ...body, cursorId: first.nextCursorId } });
    expect(first.items).toHaveLength(100); expect(second.items).toHaveLength(6);
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(106);
    expect(second.nextCursorId).toBeNull();
  });
  it("n'accepte ni parent, ni filtre de section fourni par le client", async () => {
    const { db } = fixture();
    for (const extra of [{ kind: "parents" }, { section: "Secondaire" }, { cursorId: "../other" }]) {
      await expect(listSectionSchoolRecords({ db, caller, body: { ...body, ...extra } })).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});
