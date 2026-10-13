import { describe, expect, it } from "vitest";
import { createPersonnelPayment, listPayroll } from "./personnelPayroll.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { readCashBalance } from "./cashBalance.js";

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
function correctExpense(db: FakeDb, expenseId: string, amount: number, id: string) {
  return executeFinancialOperation({ db, caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, body: {
    action: "update-expense", transactionId: expenseId, amount, category: "Fournitures", description: "Correction fictive", reason: "Justification test", clientRequestId: id,
  }, now: "2026-10-13T11:00:00.000Z" });
}
const balance = (db: FakeDb) => readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "CDF" });

describe("caisse annuelle — contrôle serveur", () => {
  it("conserve les devises explicites après un changement CDF vers USD ou USD vers CDF", async () => {
    const db = seeded(0);
    db.values.set("payments/cdf", { schoolId: "school-a", schoolYearId: "year-a", amount: 500000, currency: "CDF" });
    db.values.set("expenses/cdf", { schoolId: "school-a", schoolYearId: "year-a", amount: 200000, currency: "CDF" });
    db.values.set("payments/usd", { schoolId: "school-a", schoolYearId: "year-a", amount: 150, currency: "USD" });
    db.values.set("expenses/usd", { schoolId: "school-a", schoolYearId: "year-a", amount: 100, currency: "USD" });
    expect((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "CDF" })).availableCents).toBe(30000000);
    db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "USD" });
    expect((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "USD" })).availableCents).toBe(30000000);
    expect((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "USD", yearCurrency: "USD" })).availableCents).toBe(5000);
    db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" });
    expect((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "USD", yearCurrency: "CDF" })).availableCents).toBe(5000);
  });

  it.each(["payments", "expenses"])("bloque toutes les caisses quand %s contient une devise historique inconnue", async (collection) => {
    const db = seeded(0);
    db.values.set(`${collection}/legacy`, { schoolId: "school-a", schoolYearId: "year-a", amount: 100 });
    for (const yearCurrency of ["CDF", "USD"] as const) {
      for (const currency of ["CDF", "USD"] as const) {
        await expect(readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency, yearCurrency }))
          .rejects.toMatchObject({ code: "cash-balance-inconsistent" });
      }
    }
    db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "USD" });
    await expect(payroll(db, 1, `legacy-${collection}-blocked`)).rejects.toMatchObject({ code: "cash-balance-inconsistent" });
    expect([...db.values.keys()].filter((path) => path.startsWith("personnelPayments/"))).toHaveLength(0);
  });

  it("refuse la correction d'une dépense legacy sans lui attribuer la devise actuelle", async () => {
    const db = seeded();
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" });
    db.values.set("expenses/legacy", { id: "legacy", schoolId: "school-a", schoolYearId: "year-a", amount: 100, category: "Fournitures" });
    await expect(correctExpense(db, "legacy", 120, "legacy-correction-01"))
      .rejects.toMatchObject({ code: "currency-reconciliation-required" });
    expect(db.values.get("expenses/legacy")?.amount).toBe(100);
  });

  it("utilise la devise immuable d'une paie liée lorsque la dépense legacy est référencée exactement", async () => {
    const db = seeded(0);
    db.values.set("payments/receipt", { schoolId: "school-a", schoolYearId: "year-a", amount: 500, currency: "CDF" });
    db.values.set("expenses/payroll-expense", { schoolId: "school-a", schoolYearId: "year-a", amount: 100, personnelPaymentId: "payroll-linked" });
    db.values.set("personnelPayments/payroll-linked", { schoolId: "school-a", schoolYearId: "year-a", expenseId: "payroll-expense", netPaid: 100, currency: "CDF" });
    expect((await balance(db)).availableCents).toBe(40000);
    db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "USD" });
    expect((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "USD" })).availableCents).toBe(40000);
    db.values.set("personnelPayments/payroll-linked", { schoolId: "school-a", schoolYearId: "year-a", expenseId: "wrong", netPaid: 100, currency: "CDF" });
    await expect(balance(db)).rejects.toMatchObject({ code: "cash-balance-inconsistent" });
  });

  it("isole une devise inconnue aux écoles et années réellement concernées", async () => {
    const db = seeded();
    db.values.set("payments/foreign-legacy", { schoolId: "school-b", schoolYearId: "year-a", amount: 100 });
    db.values.set("expenses/other-year-legacy", { schoolId: "school-a", schoolYearId: "year-b", amount: 100 });
    expect((await balance(db)).availableCents).toBe(50000000);
    db.values.set("expenses/current-year-legacy", { schoolId: "school-a", schoolYearId: "year-a", amount: 100 });
    await expect(balance(db)).rejects.toMatchObject({ code: "cash-balance-inconsistent" });
  });

  it("autorise solde suffisant et exactement égal, avec une dépense liée unique", async () => {
    const db = seeded();
    const first = await payroll(db, 300000, "cash-success-0001");
    expect(first.payment.netPaid).toBe(300000);
    expect((await balance(db)).availableCents).toBe(20000000);
    await payroll(db, 200000, "cash-exact-0002");
    expect((await balance(db)).availableCents).toBe(0);
    expect([...db.values.keys()].filter((path) => path.startsWith("personnelPayments/"))).toHaveLength(2);
    expect([...db.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(2);
  });

  it("refuse 650000, une caisse vide, négative ou indisponible sans écriture partielle", async () => {
    const insufficient = seeded();
    await expect(payroll(insufficient, 650000, "cash-insufficient-01")).rejects.toMatchObject({ code: "insufficient-funds", details: { shortfallCents: 15000000 } });
    expect([...insufficient.values.keys()].filter((path) => path.startsWith("personnelPayments/") || path.startsWith("expenses/"))).toHaveLength(0);
    const empty = seeded(0);
    await expect(payroll(empty, 100000, "cash-empty-000001")).rejects.toMatchObject({ code: "insufficient-funds" });
    const negative = seeded(0);
    negative.values.set("expenses/legacy", { schoolId: "school-a", schoolYearId: "year-a", amount: 5 });
    await expect(payroll(negative, 100000, "cash-negative-001")).rejects.toMatchObject({ code: "cash-balance-inconsistent" });
    const unavailable = seeded(); unavailable.failQueries = true;
    await expect(payroll(unavailable, 100000, "cash-unavailable01")).rejects.toMatchObject({ code: "cash-balance-unavailable" });
  });

  it("contrôle le net réel après CNSS, impôt, retenue et récupération d'avance", async () => {
    const db = seeded(500000);
    const advance = await payroll(db, 100000, "cash-advance-0001", { kind: "advance", periodMonth: undefined, periodYear: undefined });
    const result = await payroll(db, 500000, "cash-net-after-01", { cnss: 20000, tax: 30000, deduction: 10000,
      deductionReason: "Retenue test", recoveries: [{ advanceId: advance.payment.id, amount: 50000 }] });
    expect(result.payment.netPaid).toBe(390000);
    expect(db.values.get(`expenses/${result.payment.expenseId}`)?.amount).toBe(390000);
    expect((await balance(db)).availableCents).toBe(1000000);
  });

  it("sérialise deux salaires et une dépense ordinaire concurrents sur le même solde", async () => {
    const salaries = seeded();
    const results = await Promise.allSettled([payroll(salaries, 350000, "cash-parallel-0001"), payroll(salaries, 350000, "cash-parallel-0002")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(salaries)).availableCents).toBe(15000000);
    expect([...salaries.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(1);
    const mixed = seeded();
    const mixedResults = await Promise.allSettled([payroll(mixed, 350000, "cash-mixed-pay-01"), ordinaryExpense(mixed, 300000, "cash-mixed-exp-01")]);
    expect(mixedResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(mixed)).availableCents).toBeGreaterThanOrEqual(0);
  });

  it("protège toutes les dépenses ordinaires, y compris égalité, solde nul et doublon", async () => {
    const db = seeded(500000);
    await expect(ordinaryExpense(db, 650000, "ordinary-overdraft-01")).rejects.toMatchObject({ code: "insufficient-funds" });
    expect([...db.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(0);
    const first = await ordinaryExpense(db, 500000, "ordinary-exact-0001");
    const retry = await ordinaryExpense(db, 500000, "ordinary-exact-0001");
    expect(retry.idempotent).toBe(true);
    expect(retry.expense.id).toBe(first.expense.id);
    expect((await balance(db)).availableCents).toBe(0);
    await expect(ordinaryExpense(db, 1, "ordinary-empty-0002")).rejects.toMatchObject({ code: "insufficient-funds" });
    expect([...db.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(1);
  });

  it("vérifie seulement le supplément d'une correction et conserve les valeurs avant/après", async () => {
    const db = seeded(500000);
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" });
    const expense = (await ordinaryExpense(db, 100000, "correct-source-0001")).expense;
    await expect(correctExpense(db, expense.id, 550000, "correct-too-high-01")).rejects.toMatchObject({ code: "insufficient-funds" });
    expect(db.values.get(`expenses/${expense.id}`)?.amount).toBe(100000);
    await correctExpense(db, expense.id, 500000, "correct-exact-0002");
    expect((await balance(db)).availableCents).toBe(0);
    const audit = [...db.values].find(([path, value]) => path.startsWith("financialCorrectionAudits/") && value.oldAmount === 100000)?.[1];
    expect(audit).toMatchObject({ oldAmount: 100000, newAmount: 500000, currency: "CDF" });
    await correctExpense(db, expense.id, 400000, "correct-reduce-0003");
    expect((await balance(db)).availableCents).toBe(10000000);
  });

  it("sérialise deux dépenses ordinaires, une prime et une avance concurrentes", async () => {
    const expenses = seeded();
    const results = await Promise.allSettled([ordinaryExpense(expenses, 350000, "ordinary-parallel-01"), ordinaryExpense(expenses, 300000, "ordinary-parallel-02")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(expenses)).availableCents).toBeGreaterThanOrEqual(0);
    const payrollDb = seeded();
    const payrollResults = await Promise.allSettled([
      payroll(payrollDb, 350000, "bonus-parallel-0001", { kind: "bonus" }),
      payroll(payrollDb, 300000, "advance-parallel-01", { kind: "advance", periodMonth: undefined, periodYear: undefined }),
    ]);
    expect(payrollResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await balance(payrollDb)).availableCents).toBeGreaterThanOrEqual(0);
  });

  it("préserve l'idempotence et isole école et devise", async () => {
    const db = seeded();
    db.values.set("payments/foreign-school", { schoolId: "school-b", schoolYearId: "year-a", currency: "CDF", amount: 900000 });
    db.values.set("payments/foreign-currency", { schoolId: "school-a", schoolYearId: "year-a", currency: "USD", amount: 900000 });
    expect((await listPayroll({ db, caller, body: { action: "list-payroll-cash-balance", schoolYearId: "year-a" } })).availableCents).toBe(50000000);
    const first = await payroll(db, 300000, "cash-idempotent-01");
    const second = await payroll(db, 300000, "cash-idempotent-01");
    expect(second.idempotent).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect((await balance(db)).availableCents).toBe(20000000);
    await expect(payroll(db, 300000, "cash-idempotent-01", { description: "different" })).rejects.toMatchObject({ code: "conflict" });
  });

  it("compte les arriérés encaissés dans l'année une seule fois et dans leur devise", async () => {
    const db = seeded(0);
    db.values.set("payments/current", { schoolId: "school-a", schoolYearId: "year-a", collectionSchoolYearId: "year-a", currency: "CDF", amount: 100 });
    db.values.set("payments/arrears", { schoolId: "school-a", schoolYearId: "year-previous", collectionSchoolYearId: "year-a", currency: "CDF", amount: 50 });
    db.values.set("payments/arrears-usd", { schoolId: "school-a", schoolYearId: "year-previous", collectionSchoolYearId: "year-a", currency: "USD", amount: 900 });
    expect((await balance(db)).availableCents).toBe(15000);
  });

  it("réserve la lecture de caisse au Caissier de son établissement", async () => {
    const db = seeded();
    await expect(listPayroll({ db, caller: { ...caller, role: "teacher" }, body: { action: "list-payroll-cash-balance", schoolYearId: "year-a" } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    db.values.set("schoolYears/year-b", { schoolId: "school-b", status: "active", currency: "CDF" });
    await expect(listPayroll({ db, caller, body: { action: "list-payroll-cash-balance", schoolYearId: "year-b" } }))
      .rejects.toMatchObject({ code: "failed-precondition" });
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" });
    await expect(listPayroll({ db, caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, body: { action: "list-cash-balance", schoolYearId: "year-a" } }))
      .resolves.toMatchObject({ availableCents: 50000000, schoolId: "school-a", currency: "CDF" });
    await expect(listPayroll({ db, caller: { ...caller, role: "teacher" }, body: { action: "list-cash-balance", schoolYearId: "year-a" } }))
      .rejects.toMatchObject({ code: "permission-denied" });
  });
});
