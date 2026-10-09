import { describe, expect, it } from "vitest";
import { createPersonnelPayment, listPayroll } from "./personnelPayroll.js";

type Data = Record<string, unknown>;
class FakeDb {
  values = new Map<string, Data>();
  queue = Promise.resolve();
  doc(path: string) { return { path, id: path.split("/").at(-1), get: async () => this.snapshot(path) }; }
  snapshot(path: string) { const value = this.values.get(path); return { id: path.split("/").at(-1), exists: Boolean(value), data: () => value }; }
  collection(name: string) { return { where: (field: string, _operator: string, value: unknown) => ({ get: async () => ({ docs: [...this.values].filter(([path, data]) => path.startsWith(`${name}/`) && data[field] === value).map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) }) }) }; }
  runTransaction<T>(operation: (transaction: { get: (ref: { path: string }) => Promise<ReturnType<FakeDb["snapshot"]>>; create: (ref: { path: string }, value: Data) => void; update: (ref: { path: string }, value: Data) => void }) => Promise<T>) {
    const run = async () => {
      const writes: Array<() => void> = [];
      const result = await operation({
        get: async (ref) => this.snapshot(ref.path),
        create: (ref, value) => writes.push(() => { if (this.values.has(ref.path)) throw new Error("already exists"); this.values.set(ref.path, value); }),
        update: (ref, value) => writes.push(() => { const prior = this.values.get(ref.path); if (!prior) throw new Error("not found"); this.values.set(ref.path, { ...prior, ...value }); }),
      });
      writes.forEach((write) => write());
      return result;
    };
    const result = this.queue.then(run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

const caller = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
const base = { action: "create-personnel-payment", schoolYearId: "year-a", beneficiaryId: "worker-a", paidAt: "2026-10-09", amount: 100, recoveries: [], deduction: 0, deductionReason: "", cnss: 0, tax: 0, description: "" };
function seeded() {
  const db = new FakeDb();
  db.values.set("schools/school-a", { status: "active", currency: "CDF" });
  db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF" });
  db.values.set("users/cashier-a", { role: "cashier", schoolId: "school-a", name: "Caissier A" });
  db.values.set("personnelProfiles/worker-a", { kind: "service", schoolId: "school-a", name: "Vigile A", jobTitle: "Vigile" });
  return db;
}
async function write(db: FakeDb, changes: Data, id: string) {
  return createPersonnelPayment({ db, caller, body: { ...base, ...changes, clientRequestId: id }, now: "2026-10-09T10:00:00.000Z" });
}

describe("paie du personnel — transactions et confidentialité", () => {
  it("sépare trois avances et ne comptabilise qu'un décaissement par versement", async () => {
    const db = seeded();
    const advances = await Promise.all([50, 80, 40].map((amount, index) => write(db, { kind: "advance", amount }, `advance-request-${index}`)));
    expect(advances.map((item) => item.payment.amount)).toEqual([50, 80, 40]);
    expect([...db.values.keys()].filter((key) => key.startsWith("expenses/")).length).toBe(3);
    const listed = await listPayroll({ db, caller, body: { action: "list-payroll-advances", beneficiaryId: "worker-a" } });
    expect(listed.advances).toHaveLength(3);
  });
  it("récupère partiellement plusieurs avances sur salaire puis prime, avec période et date indépendantes", async () => {
    const db = seeded();
    const a = await write(db, { kind: "advance", amount: 50 }, "advance-first-00001");
    const b = await write(db, { kind: "advance", amount: 80 }, "advance-second-0001");
    const salary = await write(db, { kind: "salary", amount: 500, periodMonth: 9, periodYear: 2026, paidAt: "2026-10-09", recoveries: [{ advanceId: a.payment.id, amount: 50 }, { advanceId: b.payment.id, amount: 30 }], deduction: 20, deductionReason: "Retenue documentée", cnss: 15, tax: 25 }, "salary-request-00001");
    expect(salary.payment.netPaid).toBe(360);
    expect(salary.payment.periodMonth).toBe(9);
    expect(salary.payment.paidAt).toBe("2026-10-09");
    expect(db.values.get(`expenses/${salary.payment.expenseId}`)?.amount).toBe(360);
    expect(db.values.get(`personnelPayments/${a.payment.id}`)?.recoveredAmount).toBe(50);
    expect(db.values.get(`personnelPayments/${b.payment.id}`)?.recoveredAmount).toBe(30);
    expect(db.values.get(`personnelPayments/${b.payment.id}`)?.recoveryHistory).toHaveLength(1);
    const bonus = await write(db, { kind: "bonus", amount: 60, periodMonth: 8, periodYear: 2026, recoveries: [{ advanceId: b.payment.id, amount: 20 }] }, "bonus-request-000001");
    expect(bonus.payment.netPaid).toBe(40);
    expect(db.values.get(`personnelPayments/${b.payment.id}`)?.recoveredAmount).toBe(50);
    const listed = await listPayroll({ db, caller, body: { action: "list-payroll-advances", beneficiaryId: "worker-a" } });
    expect(listed.advances).toHaveLength(1);
  });
  it("refuse dépassement, devise incompatible et bénéficiaire étranger", async () => {
    const db = seeded();
    const advance = await write(db, { kind: "advance", amount: 50 }, "advance-check-0001");
    await expect(write(db, { kind: "salary", periodMonth: 9, periodYear: 2026, recoveries: [{ advanceId: advance.payment.id, amount: 51 }] }, "salary-excess-00001")).rejects.toMatchObject({ status: 409 });
    db.values.set(`personnelPayments/${advance.payment.id}`, { ...db.values.get(`personnelPayments/${advance.payment.id}`), currency: "USD" });
    await expect(write(db, { kind: "salary", periodMonth: 9, periodYear: 2026, recoveries: [{ advanceId: advance.payment.id, amount: 10 }] }, "salary-mixed-00001")).rejects.toMatchObject({ status: 409 });
    db.values.set("personnelProfiles/worker-a", { kind: "service", schoolId: "other-school", name: "Vigile A" });
    await expect(write(db, { kind: "advance" }, "foreign-person-0001")).rejects.toMatchObject({ status: 404 });
  });
  it("reste idempotent et empêche deux récupérations concurrentes du même solde", async () => {
    const db = seeded();
    const advance = await write(db, { kind: "advance", amount: 50 }, "advance-race-00001");
    const input = { kind: "salary", periodMonth: 9, periodYear: 2026, recoveries: [{ advanceId: advance.payment.id, amount: 50 }] };
    const [first, second] = await Promise.allSettled([write(db, input, "salary-race-000001"), write(db, input, "salary-race-000002")]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const repeat = await write(db, input, "salary-race-000001");
    expect(repeat.idempotent).toBe(true);
    expect([...db.values.keys()].filter((key) => key.startsWith("expenses/")).length).toBe(2);
  });
  it("exige le motif d'une retenue, refuse les rôles interdits et protège l'historique personnel", async () => {
    const db = seeded();
    await expect(write(db, { kind: "bonus", periodMonth: 8, periodYear: 2026, deduction: 1 }, "missing-reason-0001")).rejects.toMatchObject({ status: 400 });
    await expect(createPersonnelPayment({ db, caller: { ...caller, role: "parent" }, body: { ...base, kind: "advance", clientRequestId: "parent-request-0001" } })).rejects.toMatchObject({ status: 403 });
    await write(db, { kind: "salary", periodMonth: 9, periodYear: 2026 }, "own-salary-000001");
    const own = await listPayroll({ db, caller: { uid: "worker-a", role: "teacher", schoolId: "school-a" }, body: { action: "list-own-payroll", beneficiaryId: "cashier-a" } });
    expect(own.payments).toHaveLength(1);
    await expect(listPayroll({ db, caller: { uid: "outsider", role: "teacher", schoolId: "other-school" }, body: { action: "list-personnel-payments", beneficiaryId: "worker-a" } })).rejects.toMatchObject({ status: 403 });
  });
});
