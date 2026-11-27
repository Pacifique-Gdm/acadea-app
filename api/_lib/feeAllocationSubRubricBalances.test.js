// Soldes des sous-rubriques dans les tableaux 1-2-3, le PDF et la vue partagée (décision de l'utilisateur du 27/11/2026).
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { buildAllocationWorkspace, withSubRubricViews } from "./feeAllocationPhase2.js";
import { filterWorkspaceForStaff } from "./feeAllocationSharing.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32), sub = "1".repeat(16);
let sequence = 0;
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("soldes des sous-rubriques envoyés à l'écran", () => {
  const balance = { rubricId, openingMinor: 100, receivedMinor: 900, spentMinor: 50, reservedMinor: 0, availableMinor: 950, subBalances: { [sub]: { receivedMinor: 300, spentMinor: 20 } } };
  const rubrics = [{ id: rubricId, name: "Fonctionnement", subRubrics: [{ id: sub, name: "Craies", mode: "percent", basisPoints: 3000, functions: [] }] }];
  it("chaque sous-rubrique puis « Non affecté (rubrique) » ; les soldes bruts ne sortent pas", () => {
    const [row] = withSubRubricViews({ balances: [balance] }, rubrics).balances;
    expect(row).not.toHaveProperty("subBalances");
    expect(row.subView.map((r) => [r.name, r.receivedMinor, r.spentMinor, r.availableMinor])).toEqual([["Craies", 300, 20, 280], ["Non affecté (Fonctionnement)", 700, 30, 670]]);
    expect(row.subView.reduce((n, r) => n + r.availableMinor, 0)).toBe(balance.availableMinor);
  });
  it("une rubrique sans sous-rubrique ne change pas ; pas de registre, rien à faire", () => {
    const { subBalances: _drop, ...plain } = balance;
    expect(withSubRubricViews({ balances: [balance] }, []).balances).toEqual([plain]);
    expect(withSubRubricViews(null, rubrics)).toBeNull();
  });
  it("vue partagée : seulement les lignes des rubriques partagées", () => {
    const other = { ...balance, rubricId: "c".repeat(32), subView: [{ id: "UNALLOCATED" }] };
    const workspace = { school: {}, year: {}, currency: "USD", fees: [], configs: [], ledger: { rubrics: [], movements: [], balances: [{ ...balance, subView: [{ id: sub }] }, other] } };
    expect(filterWorkspaceForStaff(workspace, [rubricId]).ledger.balances.map((b) => [b.rubricId, b.subView])).toEqual([[rubricId, [{ id: sub }]]]);
  });
  it("le drawer reçoit les soldes réels après un paiement", async () => {
    const db = completeAllocationFixture();
    const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `solde-${++sequence}-request`, ...extra } });
    await lifecycle("publish-configuration", { versionId: "version" });
    await reconcileFixture(db, admin, at);
    const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
    await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
    db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
    db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Fonctionnement", hidden: false });
    await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, subRubrics: [{ name: "Craies", mode: "percent", basisPoints: 5000, functions: [] }], confirmation: SUB_RUBRICS_PHRASE, requestId: `solde-${++sequence}-request` } });
    await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 25, clientRequestId: "solde-paiement-00001" } });
    // Le périmètre de recette de la fixture expire le 14/11 : lecture faite à la date de la fixture.
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
    const workspace = await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false });
    const row = workspace.ledger.balances.find((b) => b.rubricId === rubricId);
    expect(row).not.toHaveProperty("subBalances");
    expect(row.subView.map((r) => [r.name, r.receivedMinor])).toEqual([["Craies", 1000], ["Non affecté (Fonctionnement)", 1000]]);
  });
});
