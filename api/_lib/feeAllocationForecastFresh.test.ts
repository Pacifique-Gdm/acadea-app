// F2 (28/11/2026) — défaut trouvé sur le staging : la part de l'ouverture des sous-rubriques était calculée avec le
// prévu gardé sans vérifier s'il était à jour. Absent : toute l'ouverture allait dans « Reste » ; périmé (nouveau frais…) :
// ancien prévu. Le Caissier, le contrôle des dépenses et la liste des rubriques utilisent maintenant le prévu à jour,
// le même que les tableaux.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { getAllocationSpendOptions, manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { buildAllocationWorkspace } from "./feeAllocationPhase2.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";
import { buildAllocationTables, projectAllocations, type AllocationRow } from "../../src/utils/feeAllocationView";
import type { AllocationWorkspace } from "../../src/services/feeAllocation";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
afterEach(() => { vi.useRealTimers(); });

/** École d'essai : 25 $ d'ouverture, rubrique « Personnel » avec un montant fixe et un pourcentage, des paiements. */
async function school() {
  const db = completeAllocationFixture();
  const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `fresh-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 2500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `fresh-${++sequence}-request`,
    subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 30, clientRequestId: "fresh-payment-000001" } });
  const caches = () => [...db.records.keys()].filter((key) => key.startsWith("feeAllocationForecastCaches/"));
  const cashierView = async () => ((await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at }) as { rubrics: { id: string; subRubrics?: { id: string; availableMinor: number }[] }[] })
    .rubrics.find((r) => r.id === rubricId)!.subRubrics!);
  const tableThree = async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:30:00.000Z"));
    try {
      const workspace = await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false }) as unknown as AllocationWorkspace;
      return buildAllocationTables(projectAllocations([workspace], { kind: "fee", value: "", from: "", to: "" })).three.find((row: AllocationRow) => row.rubricId === rubricId)!;
    } finally { vi.useRealTimers(); }
  };
  /** Prévu gardé faussé (prévu du montant fixe multiplié par 10) : s'il était repris, la part de l'ouverture changerait. */
  const spoilCaches = (extra: Record<string, unknown> = {}) => {
    for (const key of caches()) {
      const kept = db.records.get(key);
      db.records.set(key, { ...kept, ...extra, forecast: { ...kept.forecast, rows: kept.forecast.rows.map((row: { rubricId: string; amountMinor: number }) => row.rubricId === rubricId ? { ...row, amountMinor: row.amountMinor * 10 } : row) } });
    }
  };
  const spend = (amount: number, key: string) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:40:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount,
    category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key, allocationRubricId: rubricId, allocationSubRubricId: rubric.subRubrics[0].id } });
  return { db, rubric, caches, cashierView, tableThree, spoilCaches, spend };
}

describe("F2 — part de l'ouverture des sous-rubriques avec le prévu à jour", () => {
  it("prévu gardé absent (tableaux jamais ouverts) : le Caissier voit déjà la part de l'ouverture, comme le tableau 3", async () => {
    const { caches, cashierView, tableThree } = await school();
    expect(caches()).toEqual([]);
    const shown = await cashierView();
    // Avant la correction : toute l'ouverture restait dans « Reste » (Ouvrier = seulement sa part des paiements).
    const three = await tableThree();
    expect(three.subLines![0].openingMinor).toBeGreaterThan(0);
    expect(shown.map((sub) => sub.availableMinor)).toEqual(three.subLines!.map((line) => line.availableMinor));
  });

  it("prévu gardé périmé après l'ajout d'un frais : il n'est pas repris ; Caissier = tableau 3", async () => {
    const { db, cashierView, tableThree, spoilCaches } = await school();
    const three = await tableThree();
    // Nouveau frais (sans répartition) : la clé du prévu gardé change ; on fausse aussi son contenu pour le voir s'il était repris.
    db.records.set("feeTypes/fee-new", { ...db.records.get("feeTypes/fee"), id: "fee-new", name: "Nouveau frais" });
    spoilCaches();
    const shown = await cashierView();
    const threeAfter = await tableThree();
    expect(threeAfter.subLines!.map((line) => line.availableMinor)).toEqual(three.subLines!.map((line) => line.availableMinor));
    expect(shown.map((sub) => sub.availableMinor)).toEqual(threeAfter.subLines!.map((line) => line.availableMinor));
  });

  it("prévu gardé trop ancien : il n'est pas repris non plus", async () => {
    const { cashierView, tableThree, spoilCaches } = await school();
    const three = await tableThree();
    spoilCaches({ savedAt: "2020-01-01T00:00:00.000Z" });
    expect((await cashierView()).map((sub) => sub.availableMinor)).toEqual(three.subLines!.map((line) => line.availableMinor));
  });

  it("contrôle des dépenses juste avec un prévu gardé absent ou périmé : jusqu'au disponible du tableau 3, pas un centime de plus", async () => {
    const { db, caches, tableThree, spoilCaches, spend } = await school();
    const available = (await tableThree()).subLines![0].availableMinor;
    expect(available).toBeGreaterThan(0);
    // Périmé (nouveau frais + contenu faussé) puis absent : la dépense est contrôlée avec le prévu à jour.
    db.records.set("feeTypes/fee-new", { ...db.records.get("feeTypes/fee"), id: "fee-new", name: "Nouveau frais" });
    spoilCaches();
    await expect(spend((available + 1) / 100, "fresh-expense-over-001")).rejects.toThrow("Ouvrier");
    for (const key of caches()) db.records.delete(key);
    await expect(spend((available + 1) / 100, "fresh-expense-over-002")).rejects.toThrow("Ouvrier");
    for (const key of caches()) db.records.delete(key);
    await spend(available / 100, "fresh-expense-exact-01");
  });
});
