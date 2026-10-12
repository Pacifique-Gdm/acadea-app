import { afterEach, describe, expect, it, vi } from "vitest";
import { createPersonnelPayment, listPayroll, updatePersonnelPayment } from "./personnelPayroll.js";

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
afterEach(() => vi.unstubAllEnvs());
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
  it("corrige une paie avec confirmation exacte, dépense liée, audit et notification idempotente", async () => {
    const db = seeded();
    db.values.delete("personnelProfiles/worker-a");
    db.values.set("users/worker-a", { role: "teacher", schoolId: "school-a", name: "Enseignant A", status: "active" });
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", name: "Admin A", status: "active" });
    const created = await write(db, { beneficiaryId: "worker-a", kind: "salary", periodMonth: 9, periodYear: 2026, amount: 100 }, "salary-for-edit-0001");
    const body = { action: "update-personnel-payment", paymentId: created.payment.id, amount: 120, reason: "Correction justifiée", confirmation: "MODIFIER CE SALAIRE", expectedUpdatedAt: created.payment.createdAt, clientRequestId: "salary-edit-request-001" };
    const actor = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
    const changed = await updatePersonnelPayment({ db, caller: actor, body, now: "2026-10-10T11:30:00.000Z" });
    expect(changed.payment).toMatchObject({ amount: 120, netPaid: 120, correctionReason: "Correction justifiée" });
    expect(db.values.get(`expenses/${created.payment.expenseId}`)?.amount).toBe(120);
    expect([...db.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(1);
    const notifications = [...db.values].filter(([path]) => path.startsWith("notifications/"));
    expect(notifications).toHaveLength(1);
    expect(notifications[0][1]).toMatchObject({ recipientUserId: "worker-a", schoolId: "school-a", type: "financial_correction" });
    const audit = [...db.values].find(([path]) => path.startsWith("financialCorrectionAudits/"))?.[1];
    expect(audit).toMatchObject({ oldAmount: 100, newAmount: 120, actorId: "admin-a", reason: "Correction justifiée", notificationEventId: expect.any(String) });
    const replay = await updatePersonnelPayment({ db, caller: actor, body });
    expect(replay.idempotent).toBe(true);
    expect([...db.values.keys()].filter((path) => path.startsWith("notifications/"))).toHaveLength(1);
    await expect(updatePersonnelPayment({ db, caller: actor, body: { ...body, amount: 130 } })).rejects.toMatchObject({ status: 409 });
    await expect(updatePersonnelPayment({ db, caller: actor, body: { ...body, clientRequestId: "salary-edit-stale-02" } })).rejects.toMatchObject({ status: 409 });
  });

  it("refuse rôle, école, motif, confirmation, dépense incohérente et avance trop imputée", async () => {
    const db = seeded();
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", status: "active" });
    const created = await write(db, { kind: "advance", amount: 100 }, "advance-for-edit-01");
    const body = { action: "update-personnel-payment", paymentId: created.payment.id, amount: 80, reason: "Ajustement", confirmation: "MODIFIER CETTE AVANCE", expectedUpdatedAt: created.payment.createdAt, clientRequestId: "advance-edit-req-01" };
    const admin = { uid: "admin-a", role: "school_admin", schoolId: "school-a" };
    await expect(updatePersonnelPayment({ db, caller, body })).rejects.toMatchObject({ status: 403 });
    await expect(updatePersonnelPayment({ db, caller: { ...admin, schoolId: "school-b" }, body })).rejects.toMatchObject({ status: 403 });
    await expect(updatePersonnelPayment({ db, caller: admin, body: { ...body, reason: "" } })).rejects.toMatchObject({ status: 400 });
    await expect(updatePersonnelPayment({ db, caller: admin, body: { ...body, confirmation: "MODIFIER CE SALAIRE" } })).rejects.toMatchObject({ status: 400 });
    db.values.set(`personnelPayments/${created.payment.id}`, { ...db.values.get(`personnelPayments/${created.payment.id}`), recoveredAmount: 90 });
    await expect(updatePersonnelPayment({ db, caller: admin, body })).rejects.toMatchObject({ status: 409 });
    db.values.set(`personnelPayments/${created.payment.id}`, { ...db.values.get(`personnelPayments/${created.payment.id}`), recoveredAmount: 0 });
    db.values.set(`expenses/${created.payment.expenseId}`, { ...db.values.get(`expenses/${created.payment.expenseId}`), amount: 99 });
    await expect(updatePersonnelPayment({ db, caller: admin, body })).rejects.toMatchObject({ status: 409 });
    expect([...db.values.keys()].filter((path) => path.startsWith("financialCorrectionAudits/") || path.startsWith("notifications/"))).toHaveLength(0);
  });
  it.each([
    { kind: "bonus", confirmation: "MODIFIER CETTE PRIME" },
    { kind: "advance", confirmation: "MODIFIER CETTE AVANCE" },
  ])("corrige une %s sans nouvelle dépense et notifie le compte exact", async ({ kind, confirmation }) => {
    const db = seeded();
    db.values.delete("personnelProfiles/worker-a");
    db.values.set("users/worker-a", { role: "teacher", schoolId: "school-a", name: "Enseignant A", status: "active" });
    db.values.set("users/admin-a", { role: "school_admin", schoolId: "school-a", name: "Admin A", status: "active" });
    const created = await write(db, { beneficiaryId: "worker-a", kind, periodMonth: 9, periodYear: 2026, amount: 100 }, `create-${kind}-for-edit`);
    const changed = await updatePersonnelPayment({ db, caller: { uid: "admin-a", role: "school_admin", schoolId: "school-a" }, body: {
      action: "update-personnel-payment", paymentId: created.payment.id, amount: 110, reason: "Ajustement", confirmation,
      expectedUpdatedAt: created.payment.createdAt, clientRequestId: `edit-${kind}-request-001`,
    } });
    expect(changed.payment).toMatchObject({ kind, amount: 110, netPaid: 110 });
    expect([...db.values.keys()].filter((path) => path.startsWith("expenses/"))).toHaveLength(1);
    expect(db.values.get(`expenses/${created.payment.expenseId}`)?.amount).toBe(110);
    expect([...db.values.values()].filter((value) => value.type === "financial_correction")).toHaveLength(1);
  });
  it("suspend salaires, primes et avances sans altérer l'historique ni les réponses idempotentes", async () => {
    const db = seeded();
    const existing = await write(db, { kind: "advance" }, "rollback-prior-00001");
    const before = [...db.values];
    vi.stubEnv("ACADEA_PAYROLL_WRITES_SUSPENDED", "true");
    for (const kind of ["advance", "bonus", "salary"]) {
      await expect(write(db, { kind, periodMonth: 9, periodYear: 2026 }, `rollback-new-${kind}-0001`))
        .rejects.toMatchObject({ status: 409, code: "failed-precondition" });
    }
    expect([...db.values]).toEqual(before);
    await expect(write(db, { kind: "advance" }, "rollback-prior-00001"))
      .resolves.toMatchObject({ idempotent: true, payment: { id: existing.payment.id } });
    await expect(write(db, { kind: "advance", amount: 101 }, "rollback-prior-00001"))
      .rejects.toMatchObject({ status: 409, code: "conflict" });
    expect((await listPayroll({ db, caller, body: { action: "list-personnel-payments", beneficiaryId: "worker-a" } })).payments).toHaveLength(1);
    expect([...db.values]).toEqual(before);
  });
  it("garde les refus de rôle, d'acteur et d'établissement même lorsque la paie est suspendue", async () => {
    const db = seeded();
    vi.stubEnv("ACADEA_PAYROLL_WRITES_SUSPENDED", "true");
    await expect(createPersonnelPayment({ db, caller: { ...caller, role: "secretary" }, body: {
      ...base, kind: "advance", clientRequestId: "rollback-secretary-0001",
    } })).rejects.toMatchObject({ status: 403, code: "permission-denied" });
    db.values.set("users/cashier-a", { role: "cashier", schoolId: "school-a", status: "inactive" });
    await expect(write(db, { kind: "advance" }, "rollback-inactive-00001"))
      .rejects.toMatchObject({ status: 403, code: "permission-denied" });
    db.values.set("users/cashier-a", { role: "cashier", schoolId: "school-a", status: "active" });
    db.values.set("personnelProfiles/worker-a", { kind: "service", schoolId: "school-b", name: "Autre école" });
    await expect(write(db, { kind: "advance" }, "rollback-foreign-000001"))
      .rejects.toMatchObject({ status: 404, code: "not-found" });
    expect([...db.values.keys()].some((path) => path.startsWith("personnelPayments/"))).toBe(false);
  });
  it.each(["advance", "bonus", "salary"])("refuse l'appel direct de paiement %s après archivage du personnel sans compte", async (kind) => {
    const db = seeded();
    db.values.set("personnelProfiles/worker-a", { ...db.values.get("personnelProfiles/worker-a"), status: "inactive", active: false, archivedAt: "2026-10-08T00:00:00.000Z" });
    const before = db.values.size;
    await expect(write(db, { kind, periodMonth: 9, periodYear: 2026 }, `archived-${kind}-request`)).rejects.toMatchObject({ status: 409, code: "failed-precondition" });
    expect(db.values.size).toBe(before);
  });
  it.each([
    { status: "inactive" }, { status: "archived" }, { status: "disabled" },
    { active: false }, { disabled: true }, { archivedAt: "2026-10-08T00:00:00.000Z" },
  ])("refuse un bénéficiaire avec statut ou indicateur bloquant %j", async (blocked) => {
    const db = seeded();
    db.values.set("personnelProfiles/worker-a", { ...db.values.get("personnelProfiles/worker-a"), ...blocked });
    await expect(write(db, { kind: "advance" }, `blocked-request-${Object.keys(blocked)[0]}-${String(Object.values(blocked)[0]).slice(0, 12)}`)).rejects.toMatchObject({ status: 409 });
  });
  it("recontrôle le statut dans la transaction, tout en préservant l'historique et l'idempotence", async () => {
    const db = seeded();
    const paid = await write(db, { kind: "advance", amount: 50 }, "active-before-archive-0001");
    db.values.set("personnelProfiles/worker-a", { ...db.values.get("personnelProfiles/worker-a"), status: "inactive", active: false });
    const replay = await write(db, { kind: "advance", amount: 50 }, "active-before-archive-0001");
    expect(replay).toMatchObject({ idempotent: true, payment: { id: paid.payment.id } });
    await expect(write(db, { kind: "advance" }, "new-after-archive-00001")).rejects.toMatchObject({ status: 409 });
    const history = await listPayroll({ db, caller, body: { action: "list-personnel-payments", beneficiaryId: "worker-a" } });
    expect(history.payments).toHaveLength(1);
    const available = await listPayroll({ db, caller, body: { action: "list-payroll-personnel" } });
    expect(available.personnel).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "worker-a" })]));
  });
  it("applique le refus aussi aux comptes, sans bloquer les comptes actifs", async () => {
    const db = seeded();
    db.values.delete("personnelProfiles/worker-a");
    db.values.set("users/worker-a", { role: "teacher", schoolId: "school-a", name: "Enseignant A", status: "active", active: true });
    await write(db, { kind: "salary", periodMonth: 9, periodYear: 2026 }, "active-account-salary-01");
    db.values.set("users/worker-a", { role: "teacher", schoolId: "school-a", name: "Enseignant A", status: "inactive", active: false });
    await expect(write(db, { kind: "bonus", periodMonth: 9, periodYear: 2026 }, "inactive-account-bonus1")).rejects.toMatchObject({ status: 409 });
    const history = await listPayroll({ db, caller, body: { action: "list-personnel-payments", beneficiaryId: "worker-a" } });
    expect(history.payments).toHaveLength(1);
  });
  it("refuse le bénéficiaire inexistant sans créer d'écriture", async () => {
    const db = seeded();
    db.values.delete("personnelProfiles/worker-a");
    const before = db.values.size;
    await expect(write(db, { kind: "advance" }, "missing-worker-request1")).rejects.toMatchObject({ status: 404 });
    expect(db.values.size).toBe(before);
  });
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
