import { describe, expect, it } from "vitest";
import { listScopedStudentArrears, listScopedStudentArrearsBatch, listStudentArrearsBatch } from "./financialTransactions.js";

type RecordData = Record<string, unknown>;
function fixture(count = 1) {
  const data = new Map<string, RecordData>([
    ["schools/a", { status: "active", currency: "USD", activeSchoolYearId: "now" }],
    ["schoolYears/now", { schoolId: "a", status: "active", startsAt: "2026" }],
    ["schoolYears/old", { schoolId: "a", status: "archived", startsAt: "2025", currency: "USD" }],
    ["schoolYears/older", { schoolId: "a", status: "archived", startsAt: "2024", currency: "CDF" }],
    ["feeTypes/usd", { schoolId: "a", schoolYearId: "old", amount: 100, name: "Frais" }],
    ["feeTypes/settled", { schoolId: "a", schoolYearId: "old", amount: 40, name: "Soldé" }],
    ["feeTypes/cdf", { schoolId: "a", schoolYearId: "older", amount: 10000, name: "Frais" }],
    ["users/admin", { schoolId: "a", role: "school_admin", status: "active" }],
  ]);
  for (let i = 0; i < count; i++) {
    data.set(`students/current${i}`, { schoolId: "a", schoolYearId: "now", importedFromStudentId: `old${i}`, matricule: `M${i}`, nom: `Nom${i}`, status: "ACTIVE" });
    data.set(`students/old${i}`, { schoolId: "a", schoolYearId: "old", importedFromStudentId: `older${i}`, matricule: `M${i}`, nom: `Nom${i}` });
    data.set(`students/older${i}`, { schoolId: "a", schoolYearId: "older", matricule: `M${i}`, nom: `Nom${i}` });
    data.set(`payments/partial${i}`, { schoolId: "a", schoolYearId: "old", studentId: `old${i}`, feeTypeId: "usd", amount: 35 });
    data.set(`payments/settled${i}`, { schoolId: "a", schoolYearId: "old", studentId: `old${i}`, feeTypeId: "settled", amount: 40 });
    data.set(`payments/cdf${i}`, { schoolId: "a", schoolYearId: "older", studentId: `older${i}`, feeTypeId: "cdf", amount: 1000 });
  }
  const snapshot = (path: string) => ({ id: path.split("/")[1], exists: data.has(path), data: () => data.get(path) });
  let reads = 0;
  type Query = { collection: string; field: string; operator: string; value: unknown };
  const transaction = {
    getAll: async (...paths: string[]) => { reads++; return paths.map(snapshot); },
    get: async (value: string | Query) => {
      reads++;
      if (typeof value === "string") return snapshot(value);
      const values = value.operator === "in" ? value.value as unknown[] : [value.value];
      expect(values.length).toBeLessThanOrEqual(30);
      return { docs: [...data.keys()].filter((path) => path.startsWith(`${value.collection}/`) && values.includes(data.get(path)![value.field])).map(snapshot) };
    },
  };
  const db = { doc: (path: string) => path, collection: (collection: string) => ({ where: (field: string, operator: string, value: unknown) => ({ collection, field, operator, value }) }), runTransaction: <T>(fn: (tx: typeof transaction) => T) => fn(transaction) };
  return { db, data, reads: () => reads, ids: Array.from({ length: count }, (_, i) => `current${i}`) };
}

describe("canonical grouped historical arrears", () => {
  it("matches individual canonical debts, with partial/settled years and separate currencies", async () => {
    const f = fixture();
    const individual = await listScopedStudentArrears({ db: f.db, schoolIds: ["a"], studentId: "current0" });
    const batch = await listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["a"], studentIds: f.ids });
    expect(individual.debts.map((debt: { remaining: number }) => debt.remaining).sort((a: number, b: number) => a - b)).toEqual([65, 9000]);
    expect(batch.totals.current0).toEqual({ USD: 65, CDF: 9000 });
    const detailed = await listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["a"], studentIds: f.ids, includeDetails: true });
    expect(detailed.details.current0.map((debt: { remaining: number }) => debt.remaining).sort((a: number, b: number) => a - b)).toEqual([0, 65, 9000]);
    expect(detailed.details.current0.find((debt: { feeName: string }) => debt.feeName === "Frais" && debt.currency === "USD")).toMatchObject({ expected: 100, paid: 35, remaining: 65 });
  });
  it("groups 50 students without N+1 queries", async () => {
    const f = fixture(50);
    const result = await listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["a"], studentIds: f.ids });
    expect(Object.keys(result.totals)).toHaveLength(50);
    expect(f.reads()).toBe(12); // current, schools, years, matricules x2, ancestors x2, fees, payments x4
  });
  it.each([[], ["missing"], ["current0", "current0"], Array.from({ length: 51 }, (_, i) => `id${i}`)])("rejects invalid batches %j", async (ids) => {
    const f = fixture();
    await expect(listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["a"], studentIds: ids })).rejects.toBeTruthy();
  });
  it("rejects out-of-scope students before historical reads", async () => {
    const f = fixture();
    await expect(listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["other"], studentIds: f.ids, includeDetails: true })).rejects.toMatchObject({ status: 404 });
    expect(f.reads()).toBe(1);
  });
  it.each(["cycle", "foreign", "missing", "ambiguous", "suspended"])("preserves %s rejection", async (kind) => {
    const f = fixture();
    if (kind === "cycle") f.data.get("students/old0")!.importedFromStudentId = "current0";
    if (kind === "foreign") f.data.get("students/old0")!.schoolId = "other";
    if (kind === "missing") f.data.delete("students/old0");
    if (kind === "ambiguous") f.data.set("students/duplicate", { ...f.data.get("students/old0") });
    if (kind === "suspended") f.data.get("schools/a")!.status = "suspended";
    await expect(listScopedStudentArrearsBatch({ db: f.db, schoolIds: ["a"], studentIds: f.ids })).rejects.toMatchObject({ status: 409 });
  });
  it("restricts school callers and excludes parents from batch access", async () => {
    const f = fixture();
    const caller = { uid: "admin", schoolId: "a", role: "school_admin" };
    expect((await listStudentArrearsBatch({ db: f.db, caller, body: { schoolYearId: "now", studentIds: f.ids } })).totals.current0).toEqual({ USD: 65, CDF: 9000 });
    expect((await listStudentArrearsBatch({ db: f.db, caller, body: { schoolYearId: "now", studentIds: f.ids, includeDetails: true } })).details?.current0).toHaveLength(3);
    expect(() => listStudentArrearsBatch({ db: f.db, caller, body: { schoolYearId: "now", studentIds: f.ids, includeDetails: "yes" } })).toThrow();
    expect(() => listStudentArrearsBatch({ db: f.db, caller: { ...caller, role: "parent" }, body: {} })).toThrow();
    await expect(listStudentArrearsBatch({ db: f.db, caller, body: { schoolYearId: "other", studentIds: f.ids } })).rejects.toBeTruthy();
  });
});
