// Lot 27b — catalogue des rubriques (décision du propriétaire, 16/11/2026).
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle, getAllocationSpendOptions } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationPhase2 } from "./feeAllocationPhase2.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", stateRubric = "a".repeat(32);
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());
const rubrics = (db, action, extra = {}, caller = admin) => manageFeeAllocationRubrics({ db, caller, now: at, body: { action, requestId: `rubric-test-${++sequence}-request`, ...extra } });
const drafts = (db, list, fee = "fee", revision = 0, key = `draft-test-${++sequence}-request`) => manageFeeAllocationPhase2({ db, caller: admin, body: {
  action: "save-drafts", schoolYearId: "year", baseFeeTypeId: fee, targets: [{ feeTypeId: fee, expectedRevision: revision }], rubrics: list, requestId: key } });

describe("lot 27b — catalogue des rubriques", () => {
  it("créer, lister (Caissier compris), refuser un doublon et « Non affecté » ; seul l'Administrateur modifie", async () => {
    const db = completeAllocationFixture();
    const { rubric } = await rubrics(db, "create-rubric", { name: "Salaires" });
    expect(rubric).toMatchObject({ schoolId: "school", schoolYearId: "year", name: "Salaires", hidden: false });
    expect(rubric.id).toMatch(/^[a-f0-9]{32}$/);
    await expect(rubrics(db, "create-rubric", { name: "  salaires " })).rejects.toThrow("déjà ce nom");
    await expect(rubrics(db, "create-rubric", { name: "Non affecté" })).rejects.toThrow("réservé");
    await expect(rubrics(db, "create-rubric", { name: "Primes" }, cashier)).rejects.toMatchObject({ status: 403 });
    const listed = await rubrics(db, "list-rubrics", {}, cashier);
    expect(listed).toMatchObject({ enabled: true, rubrics: [expect.objectContaining({ name: "Salaires" })] });
  });
  it("renommer, masquer ; supprimer seulement une rubrique qui n'a jamais servi", async () => {
    const db = completeAllocationFixture();
    const { rubric: unused } = await rubrics(db, "create-rubric", { name: "Fournitures" });
    const { rubric: used } = await rubrics(db, "create-rubric", { name: "Salaires" });
    await rubrics(db, "rename-rubric", { rubricId: used.id, name: "Salaires du personnel" });
    await drafts(db, [{ id: used.id, name: "nom ignoré", mode: "percent", basisPoints: 6000 }], "fee", 1);
    await expect(rubrics(db, "delete-rubric", { rubricId: used.id })).rejects.toThrow("seulement masquée");
    await rubrics(db, "set-rubric-hidden", { rubricId: used.id, hidden: true });
    await rubrics(db, "delete-rubric", { rubricId: unused.id });
    const { rubrics: list } = await rubrics(db, "list-rubrics");
    expect(list).toEqual([expect.objectContaining({ id: used.id, name: "Salaires du personnel", hidden: true })]);
    // Le brouillon garde le nom du catalogue, pas celui envoyé par l'écran.
    const config = [...db.records].find(([p]) => p.startsWith("feeAllocationConfigs/"))[1];
    expect(config.draft.rubrics[0]).toMatchObject({ id: used.id, name: "Salaires du personnel" });
  });
  it("avec le catalogue, une répartition n'accepte que des rubriques de la liste, non masquées ; réutilisation sans doublon", async () => {
    const db = completeAllocationFixture();
    db.records.set("feeTypes/fee-b", { ...db.records.get("feeTypes/fee"), id: "fee-b", className: "2ème" });
    const { rubric } = await rubrics(db, "create-rubric", { name: "Salaires" });
    await expect(drafts(db, [{ id: "c".repeat(32), name: "Inconnue", mode: "percent", basisPoints: 1000 }], "fee", 1)).rejects.toThrow("dans la liste");
    await drafts(db, [{ id: rubric.id, name: "Salaires", mode: "percent", basisPoints: 6000 }], "fee", 1);
    await drafts(db, [{ id: rubric.id, name: "Salaires", mode: "percent", basisPoints: 4000 }], "fee-b", 0);
    const configs = [...db.records].filter(([p]) => p.startsWith("feeAllocationConfigs/")).map(([, v]) => v);
    expect(new Set(configs.flatMap((c) => c.draft.rubrics.map((r) => r.id)))).toEqual(new Set([rubric.id]));
    await rubrics(db, "set-rubric-hidden", { rubricId: rubric.id, hidden: true });
    await expect(drafts(db, [{ id: rubric.id, name: "Salaires", mode: "percent", basisPoints: 5000 }], "fee", 2)).rejects.toThrow("non masquées");
  });
  it("une nouvelle année commence avec une liste vide", async () => {
    const db = completeAllocationFixture();
    await rubrics(db, "create-rubric", { name: "Salaires" });
    db.records.set("schoolYears/next", { id: "next", schoolId: "school", name: "2027-2028", status: "active", currency: "USD" });
    db.records.get("schools/school").activeSchoolYearId = "next";
    expect(await rubrics(db, "list-rubrics")).toMatchObject({ schoolYearId: "next", enabled: false, rubrics: [] });
  });
});

async function activeSchool() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `rubric-active-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId: stateRubric, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  // Comme après la migration : la rubrique de la répartition active est dans le catalogue de l'année.
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${stateRubric}`, { id: stateRubric, schoolId: "school", schoolYearId: "year", name: "Fonctionnement", hidden: false });
  return db;
}
const pay = (db, amount, key) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const spend = (db, amount, key, rubricId) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount, category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", reference: "", clientRequestId: key, allocationRubricId: rubricId } });

describe("lot 27b — dépenses et paiement du personnel avec le catalogue", () => {
  it("liste du Caissier : rubriques non masquées + « Non affecté », avec leur disponible", async () => {
    const db = await activeSchool(); await pay(db, 50, "catalog-payment-0001");
    const options = await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at });
    expect(options.rubrics).toEqual([expect.objectContaining({ id: stateRubric, name: "Fonctionnement", availableMinor: 4000 }), expect.objectContaining({ id: "UNALLOCATED", availableMinor: 1000 })]);
  });
  it("une rubrique masquée n'est plus proposée ni acceptée pour une nouvelle dépense, mais sa dépense passée peut être corrigée", async () => {
    const db = await activeSchool(); await pay(db, 50, "catalog-payment-0002");
    const { expense } = await spend(db, 10, "catalog-expense-0001", stateRubric);
    await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "set-rubric-hidden", rubricId: stateRubric, hidden: true, requestId: "catalog-hide-request-0001" } });
    const options = await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at });
    expect(options.rubrics.map((r) => r.id)).toEqual(["UNALLOCATED"]);
    await expect(spend(db, 5, "catalog-expense-0002", stateRubric)).rejects.toThrow("rubrique active");
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:00:00.000Z", body: { action: "update-expense", transactionId: expense.id, amount: 8, category: "Fournitures", description: "Achat", reason: "Correction", clientRequestId: "catalog-expense-correct-0001" } });
    const balance = [...db.records].find(([p, v]) => p.startsWith("feeAllocationBalances/") && v.rubricId === stateRubric)[1];
    expect(balance.spentMinor).toBe(800);
  });
  it("une rubrique du catalogue sans encaissement a un disponible nul : message clair", async () => {
    const db = await activeSchool(); await pay(db, 50, "catalog-payment-0003");
    const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "create-rubric", name: "Nouvelle", requestId: "catalog-create-request-0001" } });
    await expect(spend(db, 1, "catalog-expense-0003", rubric.id)).rejects.toThrow("insuffisant");
  });
});
