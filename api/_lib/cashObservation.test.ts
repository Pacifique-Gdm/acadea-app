import { describe, expect, it, vi } from "vitest";
import { createPersonnelPayment } from "./personnelPayroll.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { observeCashTotals, readCashBalance } from "./cashBalance.js";
type Data = Record<string, unknown>;
class FakeDb {
  values = new Map<string, Data>();
  queue = Promise.resolve();
  failQueries = false;
  doc(path: string) { return { path, id: path.split("/").at(-1), get: async () => ({ exists: this.values.has(path), data: () => this.values.get(path) }) }; }
  collection(name: string) {
    const query = (filters: Array<[string, unknown]>): { where: (field: string, operator: string, value: unknown) => ReturnType<typeof query>; get: () => Promise<{ docs: Array<{ id: string; data: () => Data }> }> } => ({
      where: (field, _operator, value) => query([...filters, [field, value]]),
      get: async () => {
        if (this.failQueries) throw new Error("database unavailable");
        return { docs: [...this.values].filter(([path, data]) => path.startsWith(`${name}/`) && filters.every(([field, value]) => data[field] === value))
          .map(([path, data]) => ({ id: path.split("/").at(-1)!, data: () => data })) };
      },
    });
    return query([]);
  }
  runTransaction<T>(operation: (transaction: unknown) => Promise<T>) {
    const run = async () => {
      const writes: Array<() => void> = [];
      const transaction = {
        get: async (ref: { path: string } | { get: () => Promise<unknown> }) => "path" in ref
          ? { id: ref.path.split("/").at(-1), exists: this.values.has(ref.path), data: () => this.values.get(ref.path) }
          : ref.get(),
        create: (ref: { path: string }, data: Data) => writes.push(() => { if (this.values.has(ref.path)) throw new Error("exists"); this.values.set(ref.path, data); }),
        set: (ref: { path: string }, data: Data) => writes.push(() => this.values.set(ref.path, { ...this.values.get(ref.path), ...data })),
        update: (ref: { path: string }, data: Data) => writes.push(() => { if (!this.values.has(ref.path)) throw new Error("missing"); this.values.set(ref.path, { ...this.values.get(ref.path), ...data }); }),
        delete: (ref: { path: string }) => writes.push(() => this.values.delete(ref.path)),
      };
      const result = await operation(transaction);
      writes.forEach((write) => write());
      return result;
    };
    const result = this.queue.then(run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

const caller = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
const body = { action: "create-personnel-payment", schoolYearId: "year-a", beneficiaryId: "worker-a", kind: "salary", paidAt: "2026-10-13",
  periodMonth: 10, periodYear: 2026, amount: 300000, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0, description: "" };
function seeded(received = 500000) {
  const db = new FakeDb();
  db.values.set("schools/school-a", { status: "active", currency: "CDF" });
  db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" });
  db.values.set("users/cashier-a", { role: "cashier", schoolId: "school-a", status: "active", name: "Caissier test" });
  db.values.set("personnelProfiles/worker-a", { kind: "service", schoolId: "school-a", status: "active", name: "Personnel test", jobTitle: "Service" });
  if (received) db.values.set("payments/receipt-a", { id: "receipt-a", schoolId: "school-a", schoolYearId: "year-a", amount: received, currency: "CDF" });
  return db;
}
function payroll(db: FakeDb, amount: number, id: string, changes: Data = {}) {
  return createPersonnelPayment({ db, caller, body: { ...body, amount, clientRequestId: id, ...changes }, now: "2026-10-13T10:00:00.000Z" });
}
function ordinaryExpense(db: FakeDb, amount: number, id: string) {
  return executeFinancialOperation({ db, caller, body: { action: "create-expense", schoolYearId: "year-a", amount,
    category: "Fournitures", description: "Dépense fictive", beneficiary: "Test", paymentMethod: "Espèces", clientRequestId: id }, now: "2026-10-13T10:00:00.000Z" });
}
const balance = (db: FakeDb) => readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "CDF" });

const totals = (db: FakeDb) => [...db.values].find(([path]) => path.startsWith("financialCashTotals/"))?.[1];

describe("caisse : total tenu à jour en mode observation (lot 10)", () => {
  it("s'initialise au premier passage à partir du calcul complet, puis suit chaque opération sans écart", async () => {
    const db = seeded(500000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await ordinaryExpense(db, 100000, "obs-expense-1");
    expect(totals(db)).toMatchObject({ availableCents: 40_000_000, mode: "observation", operations: 1 });
    await payroll(db, 50000, "obs-payroll-1");
    await ordinaryExpense(db, 20000, "obs-expense-2");
    expect(totals(db)?.availableCents).toBe((await balance(db)).availableCents);
    expect(totals(db)?.operations).toBe(3);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("caisse-observation"), expect.anything());
    warn.mockRestore();
  });

  it("signale un écart quand une écriture échappe au total, sans rien bloquer ni débloquer", async () => {
    const db = seeded(500000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await ordinaryExpense(db, 100000, "obs-expense-3");
    db.values.set("payments/hors-circuit", { schoolId: "school-a", schoolYearId: "year-a", amount: 10000, currency: "CDF" });
    await ordinaryExpense(db, 10000, "obs-expense-4");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("caisse-observation"), expect.objectContaining({ gapCents: -1_000_000, currency: "CDF" }));
    const logged = warn.mock.calls.find(([message]) => String(message).includes("caisse-observation"))?.[1] as Record<string, unknown>;
    expect(Object.keys(logged).sort()).toEqual(["currency", "fullCents", "gapCents", "totalsId", "trackedCents"]);
    expect(String(logged.totalsId)).toMatch(/^[a-f0-9]{64}$/);
    warn.mockRestore();
  });

  it("le contrôle de caisse ignore le total tenu à jour : un total faux ne débloque ni ne bloque une dépense", async () => {
    const db = seeded(500000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await ordinaryExpense(db, 1000, "obs-expense-5");
    const key = [...db.values.keys()].find((path) => path.startsWith("financialCashTotals/"))!;
    db.values.set(key, { ...db.values.get(key), availableCents: 999_999_999_00 });
    await expect(ordinaryExpense(db, 600000, "obs-expense-6")).rejects.toMatchObject({ code: "insufficient-funds" });
    db.values.set(key, { ...db.values.get(key), availableCents: 0 });
    await expect(ordinaryExpense(db, 1000, "obs-expense-7")).resolves.toBeTruthy();
    warn.mockRestore();
  });

  it("une opération refusée n'écrit aucun total", async () => {
    const db = seeded(1000);
    await expect(ordinaryExpense(db, 5000, "obs-expense-8")).rejects.toMatchObject({ code: "insufficient-funds" });
    expect(totals(db)).toBeUndefined();
  });

  it("n'écrit pas de total incohérent (dépassement des entiers sûrs)", () => {
    const set = vi.fn();
    observeCashTotals({ transaction: { set }, totalsRef: { path: "x" }, totalsSnapshot: { exists: true, data: () => ({ availableCents: Number.MAX_SAFE_INTEGER }) },
      balance: { availableCents: Number.MAX_SAFE_INTEGER }, deltaCents: 10, schoolId: "s", schoolYearId: "y", currency: "CDF", now: "n", totalsId: "t", log: vi.fn() });
    expect(set).not.toHaveBeenCalled();
  });
});
