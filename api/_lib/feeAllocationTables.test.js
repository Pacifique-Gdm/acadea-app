// Lot 27c-1 — chaque encaissement réparti retient son tableau (1 : élève normal, 2 : réduction ou prise en charge).
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z";
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());

async function activeSchool() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `tables-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: "a".repeat(32), amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  return db;
}
const pay = (db, amount, key) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const receipts = (db) => [...db.records].filter(([p, v]) => p.startsWith("feeAllocationMovements/") && v.sourceType === "payment").map(([, v]) => v);

describe("lot 27c-1 — tableau de chaque encaissement", () => {
  it("élève sans réduction : tableau 1", async () => {
    const db = await activeSchool(); await pay(db, 40, "table-one-0001");
    expect(receipts(db).map((m) => m.socialCase)).toEqual([false]);
  });
  it("élève avec réduction sur ce frais : tableau 2, et sa correction reste au tableau 2 même si la réduction change", async () => {
    const db = await activeSchool();
    db.records.get("students/student").financialSupport = { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000 } } } };
    const { payment } = await pay(db, 30, "table-two-0001");
    expect(receipts(db).map((m) => m.socialCase)).toEqual([true]);
    db.records.get("students/student").financialSupport = {};
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T12:00:00.000Z", body: { action: "update-payment", transactionId: payment.id, amount: 20, reason: "Correction", confirmation: "MODIFIER CE PAIEMENT", expectedUpdatedAt: payment.updatedAt ?? payment.createdAt, clientRequestId: "table-two-correct-0001" } });
    expect(receipts(db).map((m) => m.socialCase)).toEqual([true, true]);
  });
});

describe("lot 27c-2 — encaissement d'un ancien élève repéré dans le registre", () => {
  it("la marque « ancien élève » de la copie du paiement est transmise à l'écran, sans autre donnée de l'élève", async () => {
    const { readFeeAllocationLedger } = await import("./feeAllocationLedger.js");
    const db = await activeSchool(); await pay(db, 40, "former-mark-0001");
    const read = async () => (await readFeeAllocationLedger({ db, schoolId: "school", schoolYearId: "year", currency: "USD", now: "2026-11-13T12:00:00.000Z" })).movements.filter((m) => m.sourceType === "payment");
    expect((await read()).map((m) => m.formerStudent)).toEqual([false]);
    const [path, movement] = [...db.records].find(([p, v]) => p.startsWith("feeAllocationMovements/") && v.sourceType === "payment");
    db.records.set(path, { ...movement, sourceSnapshot: { ...movement.sourceSnapshot, formerStudent: true } });
    const [row] = await read();
    expect(row.formerStudent).toBe(true);
    expect(row).not.toHaveProperty("sourceSnapshot");
  });
});
