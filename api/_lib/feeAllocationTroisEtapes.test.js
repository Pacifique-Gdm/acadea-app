import { describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageAllocationReconciliation } from "./feeAllocationReconciliation.js";
import { readAllocationActivation } from "./feeAllocationActivationView.js";
import { allocationBalanceId } from "./feeAllocationRuntime.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";

/** Lot « 3 étapes + école sans paiement + points bloquants » : chaque test échoue sur l'ancien serveur (1.20.3). */
const now = "2026-11-13T10:00:00.000Z", later = "2026-11-13T12:00:00.000Z", past = "2026-11-01T08:00:00.000Z", rubricId = "a".repeat(32);
const admin = { uid: "admin", role: "school_admin", schoolId: "school" };
const cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const ACTIVATE = "ACTIVER LA REPARTITION DE MON ETABLISSEMENT";
let counter = 0;
const request = () => `trois-etapes-request-${String(++counter).padStart(4, "0")}`;

function school() {
  const db = completeAllocationFixture(); db.projectId = "acadea-staging";
  vi.stubEnv("FIRESTORE_EMULATOR_HOST", ""); vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "");
  delete db.records.get("schools/school").fixtureId;
  for (const key of db.records.keys()) if (key.startsWith("feeAllocationTestScopes/")) db.records.delete(key);
  return db;
}
const lifecycle = (db, action, extra = {}, at = now, caller = admin) => manageFeeAllocationLifecycle({ db, caller, now: at, body: { action, requestId: request(), ...extra } });
const reconciliation = (db, body, extra = {}) => manageAllocationReconciliation({ db, caller: admin, now, body: { requestId: request(), ...body }, ...extra });
const balance = (db, id) => db.records.get(`feeAllocationBalances/${allocationBalanceId("school", "year", "USD", id)}`);
const history = (db, extra) => ({ schoolId: "school", schoolYearId: "year", currency: "USD", createdAt: past, provenance: "financial-api", clientRequestIdHash: `h-${Math.random()}`, ...extra });
const pay = (db, amount, key, at = later) => executeFinancialOperation({ db, caller: cashier, now: at, body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const spend = (db, amount, key, at = later) => executeFinancialOperation({ db, caller: cashier, now: at, body: { action: "create-expense", schoolYearId: "year", amount, category: "Fournitures", description: "Craies", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key } });

describe("lot « 3 étapes » — solde de départ validé en une fois", () => {
  it("valide le solde (préparer + approuver) avec une seule phrase, puis le même administrateur active", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "RAPPROCHER LA CAISSE" })).rejects.toThrow("VALIDER LE SOLDE DE DEPART");
    const opening = await lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" });
    expect(db.records.get(`feeAllocationOpeningAudits/${opening.openingId}`)).toMatchObject({ status: "approved", approvedBy: "admin", cashGapMinor: 0 });
    await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: ACTIVATE });
    expect(balance(db, rubricId)).toMatchObject({ openingMinor: 3000, availableMinor: 3000 });
  });

  it("annule un solde validé avec la phrase « ANNULER LE SOLDE DE DEPART », puis en accepte un nouveau", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    const first = await lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 1000 }, { rubricId: "UNALLOCATED", amountMinor: 2000 }], confirmation: "VALIDER LE SOLDE DE DEPART", unallocatedReason: "Erreur de saisie, à refaire." });
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" })).rejects.toThrow("annulez-le");
    await expect(lifecycle(db, "cancel-opening", { openingId: first.openingId, confirmation: "ANNULER" })).rejects.toThrow();
    await lifecycle(db, "cancel-opening", { openingId: first.openingId, confirmation: "ANNULER LE SOLDE DE DEPART" });
    expect(db.records.get(`feeAllocationOpeningAudits/${first.openingId}`).status).toBe("cancelled");
    await expect(lifecycle(db, "activate", { openingId: first.openingId, confirmation: ACTIVATE })).rejects.toThrow();
    const second = await lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" });
    await lifecycle(db, "activate", { openingId: second.openingId, confirmation: ACTIVATE });
    expect(balance(db, rubricId).openingMinor).toBe(3000);
  });

  it("point 6 : « Non affecté » positif demande une justification écrite, gardée avec le solde", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    const lines = [{ rubricId, amountMinor: 2000 }, { rubricId: "UNALLOCATED", amountMinor: 1000 }];
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines, confirmation: "VALIDER LE SOLDE DE DEPART" })).rejects.toThrow("justification");
    const opening = await lifecycle(db, "validate-opening", { cashCountMinor: 3000, lines, confirmation: "VALIDER LE SOLDE DE DEPART", unallocatedReason: "Reliquat du minerval à décider en conseil." });
    expect(db.records.get(`feeAllocationOpeningAudits/${opening.openingId}`).reasons.unallocated).toBe("Reliquat du minerval à décider en conseil.");
  });

  it("point 4 : un écart de caisse est déclaré avec un motif et va dans « Non affecté »", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    const lines = [{ rubricId, amountMinor: 3000 }];
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 2500, lines, confirmation: "VALIDER LE SOLDE DE DEPART" })).rejects.toThrow("écart");
    const opening = await lifecycle(db, "validate-opening", { cashCountMinor: 2500, lines, confirmation: "VALIDER LE SOLDE DE DEPART", cashGapReason: "Billet de 5 $ manquant au comptage." });
    await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: ACTIVATE });
    expect(balance(db, rubricId)).toMatchObject({ openingMinor: 3000, availableMinor: 3000 });
    expect(balance(db, "UNALLOCATED")).toMatchObject({ openingMinor: 0, spentMinor: 500, availableMinor: -500, openingDeficitMinor: 500 });
  });
});

describe("lot « 3 étapes » — dépenses supérieures aux encaissements (point 2)", () => {
  it("termine la vérification, exige un motif et met la différence en négatif dans « Non affecté »", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    db.records.set("expenses/chalk", history(db, { id: "chalk", amount: 50 }));
    db.records.set("cashInflows/uniforms", history(db, { id: "uniforms", amount: 40 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    const run = await reconcileFixture(db, admin, now);
    expect(run).toMatchObject({ status: "COMPLETE", deficitMinor: 2000 });
    const lines = [{ rubricId: "UNALLOCATED", amountMinor: -2000 }];
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 2000, lines, confirmation: "VALIDER LE SOLDE DE DEPART" })).rejects.toThrow("Dépenses supérieures");
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 2000, lines: [{ rubricId, amountMinor: 1000 }, { rubricId: "UNALLOCATED", amountMinor: -3000 }], confirmation: "VALIDER LE SOLDE DE DEPART", deficitReason: "Craies payées avec la vente de tenues." })).rejects.toThrow("plus que les fonds");
    const opening = await lifecycle(db, "validate-opening", { cashCountMinor: 2000, lines, confirmation: "VALIDER LE SOLDE DE DEPART", deficitReason: "Craies payées avec la vente de tenues." });
    await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: ACTIVATE });
    expect(balance(db, "UNALLOCATED")).toMatchObject({ availableMinor: -2000, spentMinor: 2000, openingMinor: 0 });
    // Un paiement suivant (70 $) est réparti normalement ; sa part « Non affecté » (20 %) réduit le négatif.
    await pay(db, 70, "after-deficit-payment-001");
    expect(balance(db, rubricId).receivedMinor).toBe(5600);
    expect(balance(db, "UNALLOCATED")).toMatchObject({ receivedMinor: 1400, availableMinor: -600 });
  });
});

describe("lot « 3 étapes » — justification par motif écrit (point 1)", () => {
  it("accepte un motif écrit pour une ancienne écriture sans preuve serveur et débloque la vérification", async () => {
    const db = school();
    db.records.set("payments/legacy", { id: "legacy", schoolId: "school", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 30, currency: "USD", createdAt: past });
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    expect((await reconcileFixture(db, admin, now)).blockedCount).toBe(1);
    await expect(reconciliation(db, { action: "justify-history", collection: "payments", sourceId: "legacy", evidenceType: "declaration", reason: "court" })).rejects.toThrow();
    await expect(reconciliation(db, { action: "justify-history", collection: "payments", sourceId: "legacy", evidenceType: "declaration", reason: "Ancien cahier de caisse, reçu papier n° 12.", photoPath: "autre/chemin/photo-0001.jpg" }, { fileExists: async () => true })).rejects.toThrow("Photo");
    const decision = await reconciliation(db, { action: "justify-history", collection: "payments", sourceId: "legacy", evidenceType: "declaration", reason: "Ancien cahier de caisse, reçu papier n° 12.",
      photoPath: "fee-allocation-proofs/school/admin/recu-papier-0012.jpg" }, { fileExists: async () => true });
    expect(decision.decision).toBe("accepted");
    const declarations = [...db.records].filter(([k]) => k.startsWith("feeAllocationHistoricalDeclarations/"));
    expect(declarations).toHaveLength(1);
    expect(declarations[0][1]).toMatchObject({ reason: "Ancien cahier de caisse, reçu papier n° 12.", photoPath: "fee-allocation-proofs/school/admin/recu-papier-0012.jpg" });
    const run = await reconcileFixture(db, admin, now);
    expect(run).toMatchObject({ status: "COMPLETE", blockedCount: 0 });
  });
});

describe("lot « 3 étapes » — école sans aucun paiement ni dépense (B)", () => {
  it("active directement, tout à zéro, avec la seule phrase d'activation", async () => {
    const db = school();
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    await expect(lifecycle(db, "activate-without-history", { confirmation: "ACTIVER" })).rejects.toThrow();
    await lifecycle(db, "activate-without-history", { confirmation: ACTIVATE });
    const state = [...db.records].find(([k]) => k.startsWith("feeAllocationStates/"))[1];
    expect(state.status).toBe("ACTIVE");
    expect(balance(db, rubricId)).toMatchObject({ openingMinor: 0, availableMinor: 0 });
    expect(balance(db, "UNALLOCATED")).toMatchObject({ openingMinor: 0, availableMinor: 0 });
  });

  it("refuse l'activation directe dès qu'une écriture existe", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    await expect(lifecycle(db, "activate-without-history", { confirmation: ACTIVATE })).rejects.toThrow("Des écritures existent");
  });
});

describe("lot « 3 étapes » — encaissement pendant la mise en route (point 5)", () => {
  it("garde la vérification, compte le paiement dans la caisse attendue et le répartit à l'activation", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    await pay(db, 50, "setup-payment-0001", "2026-11-13T10:30:00.000Z");
    const view = await readAllocationActivation({ db, caller: admin, body: { action: "get-activation" }, now: "2026-11-13T10:40:00.000Z" });
    expect(view.reconciliation.stale).toBe(false);
    expect(view.setupPayments).toMatchObject({ count: 1, receivedMinor: 5000 });
    // Caisse attendue : 30 $ vérifiés + 50 $ reçus depuis = 80 $.
    const opening = await lifecycle(db, "validate-opening", { cashCountMinor: 8000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" }, "2026-11-13T10:45:00.000Z");
    expect(db.records.get(`feeAllocationOpeningAudits/${opening.openingId}`)).toMatchObject({ cashGapMinor: 0, setupPaymentCount: 1 });
    const result = await lifecycle(db, "activate", { openingId: opening.openingId, confirmation: ACTIVATE }, "2026-11-13T11:00:00.000Z");
    expect(result.setupSettled).toBe(1);
    expect(balance(db, rubricId)).toMatchObject({ openingMinor: 3000, receivedMinor: 4000 });
    expect(balance(db, "UNALLOCATED").receivedMinor).toBe(1000);
  });

  it("une dépense pendant la mise en route oblige toujours à refaire la vérification", async () => {
    const db = school();
    db.records.set("payments/old", history(db, { id: "old", studentId: "student", feeTypeId: "fee", amount: 30 }));
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, now);
    await pay(db, 50, "setup-payment-0002", "2026-11-13T10:30:00.000Z");
    await spend(db, 10, "setup-expense-0001", "2026-11-13T10:35:00.000Z");
    await expect(lifecycle(db, "validate-opening", { cashCountMinor: 7000, lines: [{ rubricId, amountMinor: 3000 }], confirmation: "VALIDER LE SOLDE DE DEPART" }, "2026-11-13T10:45:00.000Z")).rejects.toThrow("refaire le rapprochement");
  });
});

describe("lot « 3 étapes » — bandeau du caissier (point 5)", () => {
  it("signale au caissier la mise en route dès que la vérification est lancée", async () => {
    const { getAllocationSpendOptions } = await import("./feeAllocationLifecycle.js");
    const db = school();
    await lifecycle(db, "publish-configuration", { versionId: "version" });
    expect((await getAllocationSpendOptions({ db, caller: cashier, body: {}, now })).setupInProgress).toBe(false);
    await reconcileFixture(db, admin, now);
    expect(await getAllocationSpendOptions({ db, caller: cashier, body: {}, now })).toMatchObject({ required: false, setupInProgress: true });
  });
});
