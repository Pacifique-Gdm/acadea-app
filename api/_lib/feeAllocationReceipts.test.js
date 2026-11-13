import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateFeeReceiptCumulative, feeAllocationAnchorId, feeAllocationBalanceId, feeAllocationStateId, isFeeAllocationReceiptSandbox, prepareFeeAllocationReceipt } from "./feeAllocationReceipts.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { feeAllocationConfigId } from "./feeAllocationPhase1.js";
import { executeFinancialOperation } from "./financialTransactions.js";

const rubrics = [{ id: "a".repeat(32), name: "Fonctionnement", mode: "percent", basisPoints: 2000 },
  { id: "b".repeat(32), name: "Salaires", mode: "fixed", fixedMinor: 4000 }, { id: "c".repeat(32), name: "Primes", mode: "percent", basisPoints: 2500 }];
const shares = validateFeeAllocationRubrics(rubrics, 10000).shares;
const env = { ACADEA_E2E_LOCAL_EMULATORS: "YES", VITE_FIREBASE_PROJECT_ID: "demo-acadea", FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
const now = "2026-11-13T10:00:00.000Z";
const cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
afterEach(() => vi.unstubAllEnvs());

function fixture(configured = true) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  for (const k of ["VERCEL", "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"]) vi.stubEnv(k, "");
  const configId = feeAllocationConfigId("school", "year", "fee");
  const records = new Map(Object.entries({
    "schools/school": { fixtureId: "e2e-recipe-phase3", status: "active", currency: "USD", activeSchoolYearId: "year" },
    "schoolYears/year": { schoolId: "school", status: "active", currency: "USD", name: "2026-2027" },
    "users/cashier": { ...cashier, active: true }, "users/admin": { ...admin, active: true },
    "students/student": { id: "student", schoolId: "school", schoolYearId: "year", status: "ACTIVE", className: "1ère", createdAt: "2026-09-02" },
    "feeTypes/fee": { id: "fee", schoolId: "school", schoolYearId: "year", amount: 100, name: "Minerval", className: "1ère", createdAt: "2026-09-01" },
    [`feeAllocationStates/${feeAllocationStateId("school", "year", "USD")}`]: { schoolId: "school", schoolYearId: "year", currency: "USD", status: "EN_PREPARATION", phase3FixtureId: "e2e-recipe-phase3", cutoffAt: "2026-11-01T00:00:00.000Z" },
  }));
  if (configured) {
    records.set(`feeAllocationConfigs/${configId}`, { id: configId, schoolId: "school", schoolYearId: "year", feeTypeId: "fee", currentVersionId: "version" });
    records.set("feeAllocationVersions/version", { id: "version", configId, schoolId: "school", schoolYearId: "year", feeTypeId: "fee", className: "1ère", currency: "USD", feeAmountMinor: 10000, status: "published", effectiveFrom: "2026-09-01", rubrics: structuredClone(rubrics), shares: structuredClone(shares) });
  }
  const snap = path => ({ id: path.split("/").at(-1), exists: records.has(path), data: () => structuredClone(records.get(path)) });
  const query = (name, filters = []) => ({ where: (k, op, v) => { expect(op).toBe("=="); return query(name, [...filters, [k, v]]); }, get: async () => ({ docs: [...records].filter(([p, d]) => p.startsWith(`${name}/`) && filters.every(([k, v]) => d[k] === v)).map(([p]) => snap(p)) }) });
  const db = { projectId: "demo-acadea", records, doc: path => ({ path }), collection: query, interrupt: false,
    runTransaction: async fn => {
      let writing = false; const changes = [];
      const write = (op, ref, data) => { writing = true; if (op === "create" && records.has(ref.path)) throw Error("already exists"); changes.push([op, ref.path, data]); };
      const result = await fn({ get: async ref => { if (writing) throw Error("read after write"); return ref.path ? snap(ref.path) : ref.get(); },
        create: (r, d) => write("create", r, d), update: (r, d) => write("update", r, d), set: (r, d) => write("set", r, d), delete: r => write("delete", r) });
      if (db.interrupt) throw Error("simulated transaction interruption");
      changes.forEach(([op, p, d]) => op === "delete" ? records.delete(p) : records.set(p, op === "update" ? { ...records.get(p), ...d } : d));
      return result;
    } };
  return db;
}
const create = (db, amount = 40, key = "payment-request-001", extra = {}) => executeFinancialOperation({ db, caller: cashier, now, body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key, ...extra } });
const correct = (db, payment, amount, key = "correction-request-001") => executeFinancialOperation({ db, caller: admin, now: "2026-11-13T11:00:00.000Z", body: { action: "update-payment", transactionId: payment.id, amount, reason: "Test", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: payment.updatedAt, clientRequestId: key } });
const remove = (db, payment) => executeFinancialOperation({ db, caller: admin, now, body: { action: "delete-payment", transactionId: payment.id, reason: "Test", clientRequestId: "delete-request-001" } });
const movements = db => [...db.records].filter(([p]) => p.startsWith("feeAllocationMovements/")).map(([, d]) => d);

describe("ventilation entière et monotone", () => {
  it("40 USD : 8 + 16 + 10 + 6, puis 30/20/50 sans dérive", () => {
    expect(allocateFeeReceiptCumulative(shares, 4000).map(s => s.amountMinor)).toEqual([600, 800, 1600, 1000]);
    let previous = shares.map(s => ({ rubricId: s.rubricId, amountMinor: 0 }));
    let cumulative = 0; const totals = new Map();
    for (const part of [3000, 2000, 5000]) {
      cumulative += part; const next = allocateFeeReceiptCumulative(shares, cumulative);
      expect(next.reduce((n, s, i) => n + s.amountMinor - previous[i].amountMinor, 0)).toBe(part);
      next.forEach((s, i) => totals.set(s.rubricId, (totals.get(s.rubricId) ?? 0) + s.amountMinor - previous[i].amountMinor)); previous = next;
    }
    for (const share of shares) expect(totals.get(share.rubricId)).toBe(share.amountMinor);
  });
  it("aucun recul de rubrique sur chaque centime, y compris les poids paradoxaux", () => {
    for (const weights of [[1500, 1500, 900, 500, 500, 200], [1, 1, 98], [20, 40, 25, 15]]) {
      const s = weights.map((amountMinor, i) => ({ rubricId: i.toString(16).padStart(32, "0"), amountMinor }));
      let prior = s.map(() => 0);
      for (let n = 0; n <= weights.reduce((a, b) => a + b, 0); n++) {
        const next = allocateFeeReceiptCumulative(s, n).map(r => r.amountMinor);
        expect(next.reduce((a, b) => a + b, 0)).toBe(n);
        next.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(prior[i])); prior = next;
      }
      expect(prior).toEqual(weights);
    }
  });
  it("gère la borne entière sans multiplication flottante", () => {
    const s = [{ rubricId: "a".repeat(32), amountMinor: 9007199254740000 }, { rubricId: "UNALLOCATED", amountMinor: 991 }];
    expect(allocateFeeReceiptCumulative(s, Number.MAX_SAFE_INTEGER).reduce((n, r) => n + BigInt(r.amountMinor), 0n)).toBe(BigInt(Number.MAX_SAFE_INTEGER));
    expect(() => allocateFeeReceiptCumulative(shares, 10001)).toThrow();
    expect(() => allocateFeeReceiptCumulative([shares[0], shares[0]], 1)).toThrow();
  });
});

describe("paiements réels du handler, registre atomique inactif hors émulateur", () => {
  it.each(["acadea-production", "another-project", undefined])("aucune lecture d'allocation dans %s", async projectId => {
    expect(isFeeAllocationReceiptSandbox({ projectId }, env)).toBe(false);
    const write = await prepareFeeAllocationReceipt({ db: { projectId }, transaction: { get: () => { throw Error("no reads"); } } }); write();
  });
  it.each(["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "ACADEA_E2E_LOCAL_EMULATORS", "VITE_FIREBASE_PROJECT_ID"])("verrou fermé sans %s", key => {
    expect(isFeeAllocationReceiptSandbox({ projectId: "demo-acadea" }, { ...env, [key]: "wrong" })).toBe(false);
  });
  it("une variable seule, Vercel ou des identifiants distants ne peuvent activer le moteur", () => {
    for (const key of ["VERCEL", "GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_SERVICE_ACCOUNT_JSON"]) expect(isFeeAllocationReceiptSandbox({ projectId: "demo-acadea" }, { ...env, [key]: "set" })).toBe(false);
  });
  it("crée une recette partielle atomique, réessaie sans doublon, puis solde le tarif", async () => {
    const db = fixture(); const first = await create(db, 30);
    expect(movements(db)).toHaveLength(1); expect(movements(db)[0].amountMinor).toBe(3000);
    const count = db.records.size; expect((await create(db, 30)).idempotent).toBe(true); expect(db.records.size).toBe(count);
    await expect(create(db, 31)).rejects.toMatchObject({ status: 409 });
    await create(db, 20, "payment-request-002"); await create(db, 50, "payment-request-003");
    expect(movements(db).reduce((n, m) => n + m.amountMinor, 0)).toBe(10000);
    expect(db.records.get(`payments/${first.payment.id}`).amount).toBe(30);
    for (const s of shares) expect(db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", s.rubricId)}`).receivedMinor).toBe(s.amountMinor);
  });
  it("frais non configuré : réserve globale uniquement, sans faux disponible", async () => {
    const db = fixture(false); await create(db);
    expect(movements(db)[0].lines).toEqual([{ rubricId: "UNALLOCATED", amountMinor: 4000 }]);
    const balance = db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "UNALLOCATED")}`);
    expect(balance.operational).toBe(false); expect(balance.availableMinor).toBeUndefined();
  });
  it("correction 100 vers 80 puis annulation conserve tous les mouvements", async () => {
    const db = fixture(); const { payment } = await create(db, 100); const original = structuredClone(movements(db)[0]);
    const corrected = await correct(db, payment, 80); expect((await correct(db, payment, 80)).idempotent).toBe(true);
    expect(movements(db).map(m => m.amountMinor)).toEqual([10000, -2000]);
    expect(movements(db)[0]).toEqual(original);
    await remove(db, corrected.payment); expect(movements(db).reduce((n, m) => n + m.amountMinor, 0)).toBe(0);
    expect(movements(db)[2].sourceSnapshot.amount).toBe(80); expect(movements(db)[2].reversesMovementId).toBe(movements(db)[1].id);
  });
  it("un changement de version courante ne réaffecte pas l'obligation", async () => {
    const db = fixture(); const { payment } = await create(db);
    db.records.get(`feeAllocationConfigs/${feeAllocationConfigId("school", "year", "fee")}`).currentVersionId = "different";
    await create(db, 20, "payment-request-002"); await correct(db, payment, 30);
    expect(movements(db).every(m => m.configVersionId === "version")).toBe(true);
  });
  it("refuse la modification de la version historique sans mutation partielle", async () => {
    const db = fixture(); await create(db); db.records.get("feeAllocationVersions/version").rubrics[0].basisPoints = 1000;
    const before = [...db.records]; await expect(create(db, 10, "payment-request-002")).rejects.toMatchObject({ code: "allocation-reconciliation-required" }); expect([...db.records]).toEqual(before);
  });
  it("refuse une compensation sur des fonds réservés", async () => {
    const db = fixture(); const { payment } = await create(db);
    const b = db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "a".repeat(32))}`); b.reservedMinor = b.receivedMinor;
    const before = [...db.records]; await expect(correct(db, payment, 20)).rejects.toMatchObject({ code: "allocation-reconciliation-required" }); expect([...db.records]).toEqual(before);
  });
  it("interruption transactionnelle : ni paiement ni allocation, puis reprise unique", async () => {
    const db = fixture(); const before = [...db.records]; db.interrupt = true;
    await expect(create(db)).rejects.toThrow("interruption"); expect([...db.records]).toEqual(before);
    db.interrupt = false; await create(db); expect(movements(db)).toHaveLength(1);
  });
  it("réduction, promesse et paiement réel du tiers sont distincts", async () => {
    const db = fixture(); db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000, commitmentMinor: 3000 } } } };
    expect(movements(db)).toHaveLength(0);
    await create(db, 20); await create(db, 10, "third-payment-001", { supportDecisionId: "d" }); await create(db, 20, "third-payment-002", { supportDecisionId: "d" });
    expect(movements(db).reduce((n, m) => n + m.amountMinor, 0)).toBe(5000);
    const third = movements(db).find(m => m.supportDecisionId === "d");
    await expect(remove(db, db.records.get(`payments/${third.sourceId}`))).rejects.toMatchObject({ code: "failed-precondition" });
    expect((await create(db, 10, "third-payment-001", { supportDecisionId: "d" })).idempotent).toBe(true);
  });
  it("exonération totale : aucun paiement ni mouvement", async () => {
    const db = fixture(); db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 10000 } } } };
    await expect(create(db, 1)).rejects.toMatchObject({ code: "conflict" }); expect(movements(db)).toHaveLength(0);
  });
  it.each(["coordination_admin", "sub_coordination_admin", "parent", "school_admin"])("aucun droit de création supplémentaire : %s", async role => {
    const db = fixture(); await expect(executeFinancialOperation({ db, caller: { ...cashier, role }, body: { action: "create-payment" } })).rejects.toMatchObject({ status: 403 }); expect(movements(db)).toHaveLength(0);
  });
  it("compte inactif, école étrangère et montant client falsifié sont refusés", async () => {
    const db = fixture(); db.records.get("users/cashier").active = false; await expect(create(db)).rejects.toMatchObject({ status: 403 });
    db.records.get("users/cashier").active = true; db.records.get("students/student").schoolId = "foreign"; await expect(create(db)).rejects.toMatchObject({ status: 400 });
    db.records.get("students/student").schoolId = "school"; await expect(create(db, 1, "payment-request-003", { rubricId: "forged" })).rejects.toMatchObject({ status: 400 });
    expect(movements(db)).toHaveLength(0);
  });
  it("dons et dépenses ne créent pas d'affectation scolaire", async () => {
    const db = fixture(); await executeFinancialOperation({ db, caller: cashier, now, body: { action: "create-cash-inflow", schoolYearId: "year", amount: 100, category: "Don", description: "Don entièrement fictif", source: "Tiers", paymentMethod: "Espèces", entryDate: "2026-11-13", clientRequestId: "don-request-0001" } });
    await executeFinancialOperation({ db, caller: cashier, now, body: { action: "create-expense", schoolYearId: "year", amount: 10, category: "Fournitures", description: "Fictif", beneficiary: "Fournisseur fictif", paymentMethod: "Espèces", clientRequestId: "expense-request-001" } });
    expect(movements(db)).toHaveLength(0);
  });
  it("ancre étrangère : refus sans écriture", async () => {
    const db = fixture(); const key = feeAllocationAnchorId({ schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee", currency: "USD" });
    db.records.set(`feeAllocationAnchors/${key}`, { schoolId: "foreign" });
    await expect(create(db)).rejects.toMatchObject({ code: "allocation-reconciliation-required" }); expect(movements(db)).toHaveLength(0);
  });
  it("correction après changement d'année : ancienne ancre, année archivée toujours protégée", async () => {
    const db = fixture(); const { payment } = await create(db);
    db.records.get("schools/school").activeSchoolYearId = "next";
    await correct(db, payment, 30);
    expect(movements(db).at(-1)).toMatchObject({ originSchoolYearId: "year", collectionSchoolYearId: "year", configVersionId: "version", amountMinor: -1000 });
    db.records.get("schoolYears/year").status = "archived";
    const before = [...db.records]; await expect(remove(db, payment)).rejects.toMatchObject({ code: "failed-precondition" }); expect([...db.records]).toEqual(before);
  });
  it("les encaissements antérieurs à la coupure ne sont pas reventilés", async () => {
    const db = fixture(false);
    const { payment } = await create(db, 40);
    // Simulate an existing pre-cutoff receipt in a separate, untouched obligation.
    const old = { ...payment, id: "legacy", createdAt: "2026-10-01T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", amount: 10 };
    delete old.provenance; delete old.clientRequestIdHash;
    db.records.set("payments/legacy", old); const before = structuredClone(movements(db));
    await correct(db, old, 5); expect(movements(db)).toEqual(before);
  });
  it("montants et ordre des champs Firestore ne modifient pas la version", async () => {
    const db = fixture(); db.records.get("feeAllocationVersions/version").shares = shares.map(s => ({ amountMinor: s.amountMinor, rubricId: s.rubricId })).reverse();
    await create(db); expect(movements(db)).toHaveLength(1);
  });
  it("une modification sociale n'est pas une recette ni une réécriture de l'historique", async () => {
    const db = fixture(); await create(db, 20); const original = structuredClone(movements(db));
    db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000 } } } };
    expect(movements(db)).toEqual(original); await create(db, 30, "social-request-002");
    await expect(create(db, 1, "social-request-003")).rejects.toMatchObject({ code: "conflict" });
    expect(movements(db).reduce((n, m) => n + m.amountMinor, 0)).toBe(5000);
  });
  it.each(["newer-version", "undated-obligation"])("ne devine pas la version d'origine : %s", async situation => {
    const db = fixture();
    if (situation === "newer-version") db.records.get("feeAllocationVersions/version").effectiveFrom = "2026-10-01";
    else delete db.records.get("students/student").createdAt;
    const before = [...db.records];
    await expect(create(db)).rejects.toMatchObject({ code: "allocation-reconciliation-required" });
    expect([...db.records]).toEqual(before);
  });
});
