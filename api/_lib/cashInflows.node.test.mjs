import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFinancialOperation } from "./financialTransactions.js";
import { readCashBalance } from "./cashBalance.js";

class FakeDb {
  values = new Map();
  doc(path) { return { path }; }
  collection(name) {
    const makeQuery = (filters = []) => ({
      where: (field, _operator, value) => makeQuery([...filters, [field, value]]),
      get: async () => ({ docs: [...this.values].filter(([path, data]) => path.startsWith(`${name}/`)
        && filters.every(([field, value]) => data[field] === value)).map(([path, data]) => ({ id: path.split("/").at(-1), data: () => data })) }),
    });
    return makeQuery();
  }
  async runTransaction(operation) {
    const writes = [];
    const transaction = {
      get: async (ref) => ref.path ? { exists: this.values.has(ref.path), data: () => this.values.get(ref.path) } : ref.get(),
      create: (ref, data) => writes.push(() => { if (this.values.has(ref.path)) throw new Error("duplicate"); this.values.set(ref.path, data); }),
      set: (ref, data) => writes.push(() => this.values.set(ref.path, { ...this.values.get(ref.path), ...data })),
    };
    const result = await operation(transaction);
    writes.forEach((write) => write());
    return result;
  }
}

const caller = { uid: "cashier-a", role: "cashier", schoolId: "school-a" };
const now = "2026-10-27T12:00:00.000Z";
const payload = (category, clientRequestId) => ({ action: "create-cash-inflow", schoolYearId: "year-a", amount: 250.25,
  category, entryDate: "2026-10-27", source: "Association fictive", paymentMethod: "Espèces",
  description: "Entrée de caisse de test", clientRequestId });
function seeded() {
  const db = new FakeDb();
  db.values.set("schools/school-a", { status: "active", currency: "CDF", activeSchoolYearId: "year-a" });
  db.values.set("schoolYears/year-a", { schoolId: "school-a", status: "active", currency: "CDF", startsAt: "2026-09-01", endsAt: "2027-07-31" });
  db.values.set("users/cashier-a", { role: "cashier", schoolId: "school-a", status: "active", name: "Caissier fictif" });
  return db;
}

for (const category of ["Subvention", "Don", "Frais de fonctionnement", "Autres"]) {
  test(`recette ${category}: montant exact, idempotence et aucun paiement d'élève`, async () => {
    const db = seeded();
    const body = payload(category, `cash-inflow-${category.replaceAll(" ", "-")}-node-0001`);
    const first = await executeFinancialOperation({ db, caller, body, now });
    const retry = await executeFinancialOperation({ db, caller, body, now });
    assert.equal(first.cashInflow.currency, "CDF");
    assert.equal(first.cashInflow.amount, 250.25);
    assert.equal(first.cashInflow.category, category);
    assert.equal(retry.idempotent, true);
    assert.equal(retry.cashInflow.id, first.cashInflow.id);
    assert.equal((await readCashBalance({ db, schoolId: "school-a", schoolYearId: "year-a", currency: "CDF", yearCurrency: "CDF" })).availableCents, 25025);
    assert.equal([...db.values.keys()].filter((path) => path.startsWith("payments/")).length, 0);
    assert.equal([...db.values.keys()].filter((path) => path.startsWith("cashInflows/")).length, 1);
    assert.equal([...db.values.keys()].filter((path) => path.startsWith("auditLogs/")).length, 1);
  });
}

test("refus serveur des données et rôles interdits sans écritures partielles", async () => {
  const db = seeded();
  const body = payload("Don", "cash-inflow-invalid-node-0001");
  for (const invalid of [{ amount: 0 }, { category: "Fournitures" }, { description: "   " }, { entryDate: "2026-10-28" }]) {
    await assert.rejects(executeFinancialOperation({ db, caller, body: { ...body, ...invalid }, now }), { status: 400 });
  }
  await assert.rejects(executeFinancialOperation({ db, caller: { ...caller, role: "teacher" }, body, now }), { status: 403 });
  db.values.set("schoolYears/year-b", { schoolId: "school-b", status: "active", currency: "CDF" });
  await assert.rejects(executeFinancialOperation({ db, caller, body: { ...body, schoolYearId: "year-b" }, now }), { status: 400 });
  assert.equal([...db.values.keys()].filter((path) => path.startsWith("cashInflows/")).length, 0);
});
