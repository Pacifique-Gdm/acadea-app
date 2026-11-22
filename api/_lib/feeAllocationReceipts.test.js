import { afterEach, describe, expect, it, vi } from "vitest";
import { allocateFeeReceiptCumulative, feeAllocationAnchorId, feeAllocationBalanceId, feeAllocationStateId, isFeeAllocationReceiptSandbox, prepareFeeAllocationReceipt } from "./feeAllocationReceipts.js";
import { sameAllocationRubrics, socialCaseShares, socialCumulativeLines, socialSegmentLines, validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { manageSocialPart } from "./feeAllocationSocialPart.js";
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
  const query = (name, filters = []) => ({ where: (k, op, v) => { expect(["==", ">=", "<"]).toContain(op); return query(name, [...filters, [k, v, op]]); }, get: async () => ({ docs: [...records].filter(([p, d]) => p.startsWith(`${name}/`) && filters.every(([k, v, op]) => op === ">=" ? d[k] >= v : op === "<" ? d[k] < v : d[k] === v)).map(([p]) => snap(p)) }) });
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
// Lot 27a (décision du propriétaire) : la répartition ne bloque JAMAIS un paiement d'élève ; elle le met en attente.
const pendings = db => [...db.records].filter(([p]) => p.startsWith("feeAllocationPending/")).map(([, d]) => d);
const balances = db => JSON.stringify([...db.records].filter(([p]) => p.startsWith("feeAllocationBalances/")));

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

describe("paiements du handler, frontières de projet et registre atomique", () => {
  it.each(["another-project", undefined])("aucune lecture d'allocation dans le projet non autorisé %s", async projectId => {
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
  it("version historique modifiée : paiement encaissé, aucune répartition devinée, mise en attente (lot 27a)", async () => {
    const db = fixture(); await create(db); db.records.get("feeAllocationVersions/version").rubrics[0].basisPoints = 1000;
    const before = balances(db), count = movements(db).length; const { payment } = await create(db, 10, "payment-request-002");
    expect(movements(db)).toHaveLength(count); expect(balances(db)).toBe(before);
    expect(pendings(db)).toEqual([expect.objectContaining({ paymentId: payment.id, kind: "creation", status: "pending" })]);
  });
  it("fonds réservés : la correction du paiement passe, sa répartition est mise en attente (lot 27a)", async () => {
    const db = fixture(); const { payment } = await create(db);
    const b = db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "a".repeat(32))}`); b.reservedMinor = b.receivedMinor;
    const before = balances(db), count = movements(db).length; await correct(db, payment, 20);
    expect(movements(db)).toHaveLength(count); expect(balances(db)).toBe(before);
    expect(pendings(db)).toEqual([expect.objectContaining({ paymentId: payment.id, kind: "correction", status: "pending" })]);
  });
  it("interruption transactionnelle : ni paiement ni allocation, puis reprise unique", async () => {
    const db = fixture(); const before = [...db.records]; db.interrupt = true;
    await expect(create(db)).rejects.toThrow("interruption"); expect([...db.records]).toEqual(before);
    db.interrupt = false; await create(db); expect(movements(db)).toHaveLength(1);
  });
  it("lot 26c : réduction et paiements ordinaires ; un paiement « tiers » est refusé sans mouvement", async () => {
    const db = fixture(); db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000 } } } };
    expect(movements(db)).toHaveLength(0);
    await create(db, 20); await create(db, 10, "ordinary-payment-001");
    await expect(create(db, 10, "third-payment-001", { supportDecisionId: "d" })).rejects.toMatchObject({ code: "invalid-argument" });
    expect(movements(db).reduce((n, m) => n + m.amountMinor, 0)).toBe(3000);
    expect((await create(db, 10, "ordinary-payment-001")).idempotent).toBe(true);
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
  it("ancre étrangère : paiement encaissé sans écriture de répartition, mis en attente (lot 27a)", async () => {
    const db = fixture(); const key = feeAllocationAnchorId({ schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee", currency: "USD" });
    db.records.set(`feeAllocationAnchors/${key}`, { schoolId: "foreign" });
    await create(db); expect(movements(db)).toHaveLength(0); expect(pendings(db)).toHaveLength(1);
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
    // Lot 27a : le paiement est encaissé ; la répartition n'est jamais devinée, elle attend.
    await create(db);
    expect(movements(db)).toHaveLength(0);
    expect(pendings(db)).toEqual([expect.objectContaining({ kind: "creation", status: "pending" })]);
  });
});

describe("lot 27c-3a — arriéré encaissé : sa propre ligne « … (arriéré AAAA-AAAA) »", () => {
  function arrearsFixture() {
    const db = fixture();
    db.records.set("schoolYears/old", { schoolId: "school", status: "archived", currency: "USD", name: "2025-2026" });
    db.records.set("students/old-student", { id: "old-student", schoolId: "school", schoolYearId: "old", status: "ARCHIVED", className: "1ère", createdAt: "2025-09-02" });
    db.records.set("feeTypes/old-fee", { id: "old-fee", schoolId: "school", schoolYearId: "old", amount: 80, name: "Minerval", className: "1ère", createdAt: "2025-09-01" });
    return db;
  }
  const arrearsPayment = { id: "arrears-1", schoolId: "school", schoolYearId: "old", collectionSchoolYearId: "year", studentId: "old-student", feeTypeId: "old-fee",
    currency: "USD", amount: 30, paidAt: "2026-11-12", createdAt: "2026-11-12T09:00:00.000Z", provenance: "financial-api", clientRequestIdHash: "h".repeat(64) };
  const allocate = (db, payment, requestId = "arrears-request-01") => db.runTransaction(async (transaction) => (await prepareFeeAllocationReceipt({ db, transaction, caller: cashier, payment, requestId, now }))());
  it("jamais dans le « Non affecté » de l'année : ligne d'arriéré avec son année d'origine et son propre solde", async () => {
    const db = arrearsFixture();
    await allocate(db, arrearsPayment);
    const [movement] = movements(db);
    expect(movement).toMatchObject({ originSchoolYearId: "old", collectionSchoolYearId: "year", amountMinor: 3000, lines: [{ rubricId: "ARR__old__UNALLOCATED", amountMinor: 3000 }] });
    const balance = db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "ARR__old__UNALLOCATED")}`);
    expect(balance).toMatchObject({ receivedMinor: 3000, rubricId: "ARR__old__UNALLOCATED", arrearsOf: { originSchoolYearId: "old", originYearName: "2025-2026", rubricId: "UNALLOCATED", rubricName: "Non affecté" } });
    expect(db.records.has(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "UNALLOCATED")}`)).toBe(false);
  });
  it("une correction reste sur la même ligne d'arriéré", async () => {
    const db = arrearsFixture();
    await allocate(db, arrearsPayment);
    const { sourceDigest } = await import("./feeAllocationReceipts.js");
    expect(typeof sourceDigest).toBe("function");
    await db.runTransaction(async (transaction) => (await prepareFeeAllocationReceipt({ db, transaction, caller: admin, payment: { ...arrearsPayment, amount: 20 }, previous: arrearsPayment, requestId: "arrears-request-02", now }))());
    expect(movements(db).at(-1).lines).toEqual([{ rubricId: "ARR__old__UNALLOCATED", amountMinor: -1000 }]);
    expect(db.records.get(`feeAllocationBalances/${feeAllocationBalanceId("school", "year", "USD", "ARR__old__UNALLOCATED")}`).receivedMinor).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// Lot 27c-4 : partie 2 de la répartition (cas sociaux).
const part2 = [{ id: "a".repeat(32), mode: "percent", basisPoints: 3000 }, { id: "b".repeat(32), mode: "fixed", fixedMinor: 2000 }, { id: "c".repeat(32), mode: "percent", basisPoints: 2500 }];
const withDocGet = (db) => { db.doc = path => ({ path, get: async () => ({ id: path.split("/").at(-1), exists: db.records.has(path), data: () => structuredClone(db.records.get(path)) }) }); return db; };
let socialRequest = 0;
const publish = (db, rubricsInput = part2, extra = {}, at = "2026-11-13T09:00:00.000Z") => manageSocialPart({ db: withDocGet(db), caller: admin, now: at,
  body: { action: "publish-social-part", feeTypeId: "fee", requestId: `social-request-${String(++socialRequest).padStart(4, "0")}`, expectedPartOneVersionId: "version", expectedSocialVersionId: null, rubrics: rubricsInput, ...extra } });
const reduce = (db, minor) => { db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: minor } } } }; };
const anchors = db => [...db.records].filter(([p]) => p.startsWith("feeAllocationAnchors/")).map(([, d]) => d);
const lineMap = lines => Object.fromEntries(lines.filter(l => l.amountMinor).map(l => [l.rubricId, l.amountMinor]));
const delta = (next, prior) => next.map((l, i) => ({ rubricId: l.rubricId, amountMinor: l.amountMinor - prior[i].amountMinor }));

describe("lot 27c-4 : calcul de la partie 2", () => {
  it("copie exacte en pourcentages : mêmes poids que la partie 1, au centime, pour chaque montant", () => {
    const percent = [{ id: "a".repeat(32), name: "A", mode: "percent", basisPoints: 4000 }, { id: "b".repeat(32), name: "B", mode: "percent", basisPoints: 2000 }, { id: "c".repeat(32), name: "C", mode: "percent", basisPoints: 4000 }];
    const p1 = validateFeeAllocationRubrics(percent, 12000).shares;
    for (const reduction of [1, 333, 5000, 11999]) {
      const net = 12000 - reduction, p2 = socialCaseShares(percent, percent.map(r => ({ ...r })), 12000, net);
      expect(p2).toEqual(p1);
      for (let paid = 0; paid <= net; paid += 7) expect(socialCumulativeLines(p1, p2, net, paid)).toEqual(allocateFeeReceiptCumulative(p1, paid));
    }
    expect(sameAllocationRubrics(percent, [...percent].reverse())).toBe(true);
    // Un montant fixe s'applique au net : ce n'est plus une copie.
    expect(sameAllocationRubrics(rubrics, rubrics)).toBe(false);
  });
  it("pourcentages appliqués au net, montant fixe gardé, « Non affecté » = reste du net", () => {
    expect(lineMap(socialCaseShares(rubrics, part2, 10000, 5000))).toEqual({ ["a".repeat(32)]: 1500, ["b".repeat(32)]: 2000, ["c".repeat(32)]: 1250, UNALLOCATED: 250 });
  });
  it("montants plus grands que le net : toutes les lignes réduites à proportion, total exact", () => {
    const p2 = socialCaseShares(rubrics, [{ id: "a".repeat(32), mode: "fixed", fixedMinor: 3000 }, { id: "b".repeat(32), mode: "fixed", fixedMinor: 3000 }, { id: "c".repeat(32), mode: "percent", basisPoints: 4000 }], 10000, 4000);
    // 30 + 30 + 40 % de 40 = 76 USD demandés pour 40 USD dus : chaque ligne × 40/76.
    expect(p2.reduce((n, s) => n + s.amountMinor, 0)).toBe(4000);
    expect(lineMap(p2)).toEqual({ ["a".repeat(32)]: 1579, ["b".repeat(32)]: 1579, ["c".repeat(32)]: 842 });
  });
  it("cumul croissant ligne par ligne, puis partie 1 au-delà du net", () => {
    const p1 = validateFeeAllocationRubrics(rubrics, 10000).shares, p2 = socialCaseShares(rubrics, part2, 10000, 5000);
    let previous = socialCumulativeLines(p1, p2, 5000, 0);
    for (let paid = 1; paid <= 10000; paid += 13) {
      const next = socialCumulativeLines(p1, p2, 5000, paid);
      expect(next.reduce((n, l) => n + l.amountMinor, 0)).toBe(paid);
      next.forEach((line, i) => expect(line.amountMinor).toBeGreaterThanOrEqual(previous[i].amountMinor));
      previous = next;
    }
    expect(lineMap(socialCumulativeLines(p1, p2, 5000, 5000))).toEqual(lineMap(p2));
  });
  it("la partie 2 doit reprendre exactement les rubriques de la partie 1", () => {
    expect(() => socialCaseShares(rubrics, part2.slice(0, 2), 10000, 5000)).toThrow("rubriques de la partie 1");
  });
});

describe("lot 27c-4 : publication de la partie 2", () => {
  it("publie une version à part ; partie 1, ancres et registre inchangés ; audit écrit", async () => {
    const db = fixture(); const before = structuredClone(db.records.get("feeAllocationVersions/version"));
    const { social } = await publish(db);
    expect(social).toMatchObject({ version: 1, status: "published", partOneVersionId: "version", copyOfPartOne: false });
    expect(db.records.get(`feeAllocationConfigs/${feeAllocationConfigId("school", "year", "fee")}`).socialVersionId).toBe(social.id);
    expect(db.records.get("feeAllocationVersions/version")).toEqual(before);
    expect(movements(db)).toHaveLength(0); expect(anchors(db)).toHaveLength(0);
    expect([...db.records.keys()].some(p => p.startsWith("auditLogs/"))).toBe(true);
  });
  it("refuse un autre rôle, une rubrique en trop ou manquante, et une partie 1 changée", async () => {
    const db = withDocGet(fixture());
    await expect(manageSocialPart({ db, caller: cashier, body: { action: "publish-social-part", feeTypeId: "fee" } })).rejects.toMatchObject({ status: 403 });
    await expect(publish(db, part2.slice(0, 2))).rejects.toMatchObject({ status: 400 });
    await expect(publish(db, [...part2, { id: "d".repeat(32), mode: "percent", basisPoints: 100 }])).rejects.toMatchObject({ status: 400 });
    await expect(publish(db, part2, { expectedPartOneVersionId: "other" })).rejects.toMatchObject({ status: 409 });
    expect(db.records.get(`feeAllocationConfigs/${feeAllocationConfigId("school", "year", "fee")}`).socialVersionId).toBeUndefined();
  });
  it("une nouvelle publication remplace la précédente, avec la version attendue", async () => {
    const db = fixture(); const first = (await publish(db)).social;
    await expect(publish(db, part2)).rejects.toMatchObject({ status: 409 });
    const copy = rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, mode, ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) }));
    const second = (await publish(db, copy, { expectedSocialVersionId: first.id })).social;
    expect(second.version).toBe(2); expect(db.records.get(`feeAllocationSocialVersions/${first.id}`).status).toBe("superseded");
  });
  it("la lecture montre la partie 1, la partie 2 en service et l'historique", async () => {
    const db = fixture(); const { social } = await publish(db);
    const read = await manageSocialPart({ db, caller: admin, body: { action: "get-social-part", feeTypeId: "fee" } });
    expect(read.partOne.id).toBe("version"); expect(read.social.id).toBe(social.id); expect(read.history).toHaveLength(1);
  });
});

describe("lot 27c-4 : encaissements des cas sociaux", () => {
  const social = () => socialCaseShares(rubrics, part2, 10000, 5000);
  it("premier paiement d'un cas social après publication : partage selon la partie 2 au net", async () => {
    const db = fixture(); await publish(db); reduce(db, 5000);
    await create(db, 50);
    const [movement] = movements(db);
    expect(movement.socialCase).toBe(true);
    expect(lineMap(movement.lines)).toEqual(lineMap(social()));
    expect(anchors(db)[0]).toMatchObject({ socialNetMinor: 5000 });
  });
  it("paiements partiels cumulés : même total qu'un paiement unique", async () => {
    const db = fixture(); await publish(db); reduce(db, 5000);
    await create(db, 20); await create(db, 17, "payment-request-002"); await create(db, 13, "payment-request-003");
    const total = {}; for (const m of movements(db)) for (const l of m.lines) total[l.rubricId] = (total[l.rubricId] ?? 0) + l.amountMinor;
    expect(lineMap(Object.entries(total).map(([rubricId, amountMinor]) => ({ rubricId, amountMinor })))).toEqual(lineMap(social()));
  });
  it("élève normal : aucune différence avec la partie 1", async () => {
    const db = fixture(); await publish(db); await create(db, 40);
    expect(movements(db)[0].lines).toEqual(allocateFeeReceiptCumulative(shares, 4000));
    expect(anchors(db)[0].socialVersionId).toBeUndefined();
  });
  it("cas social déjà réparti avant la publication : il garde la partie 1 pour tout ce frais", async () => {
    const db = fixture(); reduce(db, 5000); await create(db, 20);
    await publish(db, part2, {}, "2026-11-13T09:30:00.000Z"); await create(db, 30, "payment-request-002");
    expect(movements(db)[1].lines).toEqual(delta(allocateFeeReceiptCumulative(shares, 5000), allocateFeeReceiptCumulative(shares, 2000)));
  });
  it("partie 2 publiée après la date du paiement : non appliquée", async () => {
    const db = fixture(); reduce(db, 5000); await publish(db, part2, {}, "2026-11-13T12:00:00.000Z");
    await create(db, 50); expect(anchors(db)[0].socialVersionId).toBeUndefined();
  });
  it("correction d'un paiement de cas social : écriture inverse selon la même partie 2", async () => {
    const db = fixture(); await publish(db); reduce(db, 5000);
    const { payment } = await create(db, 50); await correct(db, payment, 30);
    const fix = movements(db)[1];
    expect(fix.type).toBe("correction");
    expect(fix.lines).toEqual(delta(socialCumulativeLines(shares, social(), 5000, 3000), socialCumulativeLines(shares, social(), 5000, 5000)));
  });
  it("réduction diminuée après le premier paiement : le surplus suit la partie 1", async () => {
    const db = fixture(); await publish(db); reduce(db, 5000); await create(db, 50);
    reduce(db, 4000); await create(db, 10, "payment-request-002");
    expect(movements(db)[1].lines).toEqual(delta(socialCumulativeLines(shares, social(), 5000, 6000), socialCumulativeLines(shares, social(), 5000, 5000)));
  });
});

// ---------------------------------------------------------------------------
// Correction 27c-4 : une nouvelle partie 2 s'applique aux paiements SUIVANTS des cas sociaux déjà rattachés.
describe("correction 27c-4 : changement de partie 2", () => {
  const corrected = rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, mode, ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) }));
  const sum = (db) => { const total = {}; for (const m of movements(db)) for (const l of m.lines) total[l.rubricId] = (total[l.rubricId] ?? 0) + l.amountMinor; return total; };
  it("calcul : un seul segment = calcul d'origine ; plusieurs segments croissants et exacts", () => {
    const p1 = validateFeeAllocationRubrics(rubrics, 10000).shares, wrong = socialCaseShares(rubrics, part2, 10000, 5000), right = socialCaseShares(rubrics, corrected, 10000, 5000);
    for (let paid = 0; paid <= 10000; paid += 37) expect(socialSegmentLines(p1, [{ shares: wrong, fromMinor: 0 }], 5000, paid)).toEqual(socialCumulativeLines(p1, wrong, 5000, paid));
    const segments = [{ shares: wrong, fromMinor: 0 }, { shares: right, fromMinor: 2000 }];
    let previous = socialSegmentLines(p1, segments, 5000, 0);
    for (let paid = 1; paid <= 10000; paid += 11) {
      const next = socialSegmentLines(p1, segments, 5000, paid);
      expect(next.reduce((n, l) => n + l.amountMinor, 0)).toBe(paid);
      next.forEach((line, i) => expect(line.amountMinor).toBeGreaterThanOrEqual(previous[i].amountMinor));
      previous = next;
    }
    // Avant le changement : rien ne bouge.
    expect(socialSegmentLines(p1, segments, 5000, 2000)).toEqual(socialCumulativeLines(p1, wrong, 5000, 2000));
  });
  it("après une partie 2 corrigée, le paiement suivant suit la nouvelle ; le premier mouvement ne change pas", async () => {
    const db = fixture(); const first = (await publish(db)).social; reduce(db, 5000);
    await create(db, 20); const original = structuredClone(movements(db)[0]);
    const second = (await publish(db, corrected, { expectedSocialVersionId: first.id }, "2026-11-13T09:30:00.000Z")).social;
    await create(db, 30, "payment-request-002");
    expect(movements(db)[0]).toEqual(original);
    const anchor = anchors(db)[0];
    expect(anchor.socialCurrentVersionId).toBe(second.id);
    expect(anchor.socialSegments).toEqual([{ socialVersionId: second.id, fromMinor: 2000, at: now }]);
    // Ce qui manquait encore à chaque rubrique pour atteindre la nouvelle partie 2 a été complété, total exact.
    const total = sum(db), target = lineMap(socialCaseShares(rubrics, corrected, 10000, 5000));
    expect(Object.values(total).reduce((n, v) => n + v, 0)).toBe(5000);
    const p1 = validateFeeAllocationRubrics(rubrics, 10000).shares;
    expect(lineMap(Object.entries(total).map(([rubricId, amountMinor]) => ({ rubricId, amountMinor }))))
      .toEqual(lineMap(socialSegmentLines(p1, [{ shares: socialCaseShares(rubrics, part2, 10000, 5000), fromMinor: 0 }, { shares: socialCaseShares(rubrics, corrected, 10000, 5000), fromMinor: 2000 }], 5000, 5000)));
    expect(Object.keys(lineMap(Object.entries(total).map(([rubricId, amountMinor]) => ({ rubricId, amountMinor }))))).toEqual(expect.arrayContaining(Object.keys(target).filter((id) => id !== "UNALLOCATED")));
  });
  it("correction d'un ancien paiement après le changement : écriture inverse cohérente, sans erreur", async () => {
    const db = fixture(); const first = (await publish(db)).social; reduce(db, 5000);
    const { payment } = await create(db, 20);
    await publish(db, corrected, { expectedSocialVersionId: first.id }, "2026-11-13T09:30:00.000Z");
    await create(db, 10, "payment-request-002");
    await correct(db, payment, 15);
    expect(movements(db)).toHaveLength(3);
    expect(Object.values(sum(db)).reduce((n, v) => n + v, 0)).toBe(2500);
  });
  it("nouvelle partie 2 publiée après la date du paiement : le paiement garde l'ancienne", async () => {
    const db = fixture(); const first = (await publish(db)).social; reduce(db, 5000); await create(db, 20);
    await publish(db, corrected, { expectedSocialVersionId: first.id }, "2026-11-13T12:00:00.000Z");
    await create(db, 10, "payment-request-002");
    expect(anchors(db)[0].socialSegments).toBeUndefined();
  });
  it("l'écran compte les cas sociaux déjà payés avec la partie 2 en service (sans identité)", async () => {
    const db = fixture(); await publish(db); reduce(db, 5000); await create(db, 20);
    const read = await manageSocialPart({ db, caller: admin, body: { action: "get-social-part", feeTypeId: "fee" } });
    expect(read.paidWithCurrent).toBe(1); expect(JSON.stringify(read)).not.toContain("student");
  });
});

describe("correction du prévu : signal de recalcul", () => {
  const signals = db => [...db.records].filter(([p]) => p.startsWith("feeAllocationForecastSignals/")).map(([, d]) => d);
  it("le premier paiement réparti d'un cas social fait recalculer le prévu ; pas celui d'un élève normal", async () => {
    const normal = fixture(); await create(normal, 40);
    expect(signals(normal)).toHaveLength(0);
    const db = fixture(); reduce(db, 5000); await create(db, 20);
    expect(signals(db)).toHaveLength(1);
    expect(signals(db)[0]).toMatchObject({ schoolId: "school", schoolYearId: "year" });
    const first = signals(db)[0].revision; await create(db, 10, "payment-request-002");
    expect(signals(db)[0].revision).toBe(first);
  });
});

// Correction partie 2 : une ligne retirée part comme une rubrique à 0 % et ne reçoit plus rien des cas sociaux.
describe("partie 2 : lignes retirées", () => {
  const withoutA = [{ id: "a".repeat(32), mode: "percent", basisPoints: 0 }, { id: "b".repeat(32), mode: "fixed", fixedMinor: 2000 }, { id: "c".repeat(32), mode: "percent", basisPoints: 5000 }];
  it("publication acceptée en cours d'année, puis paiement du cas social réparti sans la rubrique retirée", async () => {
    const db = fixture();
    const { social } = await publish(db, withoutA);
    expect(social.rubrics.find((r) => r.id === "a".repeat(32))).toMatchObject({ mode: "percent", basisPoints: 0 });
    reduce(db, 5000); await create(db, 50);
    const [movement] = movements(db);
    expect(movement.socialCase).toBe(true);
    expect(lineMap(movement.lines)["a".repeat(32)]).toBeUndefined();
    expect(movement.lines.reduce((sum, l) => sum + l.amountMinor, 0)).toBe(5000);
  });
  it("« Non affecté » retiré : total exactement 100 % en pourcentages, sinon refus clair", async () => {
    const full = [{ id: "a".repeat(32), mode: "percent", basisPoints: 0 }, { id: "b".repeat(32), mode: "percent", basisPoints: 5000 }, { id: "c".repeat(32), mode: "percent", basisPoints: 5000 }];
    await expect(publish(fixture(), full.map((r, i) => i === 2 ? { ...r, basisPoints: 4000 } : r), { unallocatedRemoved: true })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("exactement 100 %") });
    await expect(publish(fixture(), withoutA, { unallocatedRemoved: true })).rejects.toMatchObject({ status: 400 });
    const { social } = await publish(fixture(), full, { unallocatedRemoved: true });
    expect(social.unallocatedRemoved).toBe(true);
  });
});
