// « Répartir le Reste » après la fusion de 1.42.2 (28/11/2026) : l'aperçu et la répartition utilisent le même prévu à jour
// que les tableaux et le Caissier (un prévu gardé périmé ou faussé n'est jamais repris) ; montants au format des tableaux.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { SUB_REST_PHRASE, SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";
import { SubRubricDetail } from "../../src/modules/menu/SubRubricDetail";
import type { AllocationRow, AllocationSubLine } from "../../src/utils/feeAllocationView";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
afterEach(() => { vi.useRealTimers(); });

async function school() {
  const db = completeAllocationFixture();
  const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `rest-fresh-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 2500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  // Paiement avant les sous-rubriques : il reste dans « Reste ».
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 10, clientRequestId: "rest-fresh-payment-01" } });
  await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `rest-fresh-${++sequence}-request`,
    subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
  const call = (action: string, extra = {}) => manageFeeAllocationRubrics({ db, caller: admin, now: "2026-11-13T12:20:00.000Z", body: { action, rubricId, requestId: `rest-fresh-${++sequence}-request`, ...extra } });
  const caches = () => [...db.records.keys()].filter((key) => key.startsWith("feeAllocationForecastCaches/"));
  /** Prévu gardé faussé (prévu de la rubrique ×10) : s'il était repris, la part du montant fixe changerait. */
  const spoil = (extra: Record<string, unknown> = {}) => { for (const key of caches()) { const kept = db.records.get(key);
    db.records.set(key, { ...kept, ...extra, forecast: { ...kept.forecast, rows: kept.forecast.rows.map((row: { rubricId: string; amountMinor: number }) => row.rubricId === rubricId ? { ...row, amountMinor: row.amountMinor * 10 } : row) } }); } };
  return { db, call, caches, spoil };
}
type Plan = { preview: { restMinor: number; lines: { subRubricId: string; amountMinor: number }[] } };

describe("« Répartir le Reste » avec le prévu à jour", () => {
  it("aperçu et répartition identiques avec un prévu gardé absent, périmé (nouveau frais) ou trop ancien", async () => {
    const { db, call, caches, spoil } = await school();
    expect(caches()).toEqual([]);
    const reference = ((await call("preview-sub-rest")) as Plan).preview;
    expect(reference.lines.length).toBe(2);
    expect(caches().length).toBeGreaterThan(0);
    spoil({ savedAt: "2020-01-01T00:00:00.000Z" });
    expect(((await call("preview-sub-rest")) as Plan).preview).toEqual(reference);
    db.records.set("feeTypes/fee-new", { ...db.records.get("feeTypes/fee"), id: "fee-new", name: "Nouveau frais" });
    spoil();
    expect(((await call("preview-sub-rest")) as Plan).preview).toEqual(reference);
    // Répartition avec un prévu gardé trop ancien (et faussé) : il est recalculé, comme pour l’aperçu.
    spoil({ savedAt: "2020-01-01T00:00:00.000Z" });
    await call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE });
    const movement = [...db.records].find(([key, value]) => key.startsWith("feeAllocationMovements/") && (value as { type?: string }).type === "sub-rest-redistribution")![1] as { subLines: { subRubricId: string; amountMinor: number }[] };
    expect(movement.subLines.map(({ subRubricId, amountMinor }) => ({ subRubricId, amountMinor }))).toEqual(reference.lines.map(({ subRubricId, amountMinor }) => ({ subRubricId, amountMinor })));
  });

  it("détail de « ↳ … » : montants au format des tableaux (« $18,40 », « −$16,67 », « 18 400,00 FC »), jamais USD ni CDF", () => {
    const sub = (availableMinor: number): AllocationSubLine => ({ id: "s", name: "Entretien", plannedMinor: 1840, receivedMinor: 1840, openingMinor: 0, cumulativeReceivedMinor: 1840, cumulativeSpentMinor: 1840 - availableMinor, availableMinor });
    const render = (currency: "USD" | "CDF", availableMinor: number) => renderToStaticMarkup(createElement(SubRubricDetail, { row: { key: "k", schoolId: "s", schoolName: "École", yearName: "2026-2027", currency,
      rubricName: "Personnel", rubricId, amountMinor: 1840 } as AllocationRow, sub: sub(availableMinor), filterLabel: "Frais : Tous les frais", schoolId: "s", canRedistribute: false, restAvailableMinor: 0, onClose: () => {}, onDone: () => {} }));
    const usd = render("USD", -1667), cdf = render("CDF", 1840000);
    expect(usd).toContain("$18,40");
    expect(usd).toContain("−$16,67");
    expect(usd).not.toContain("$-");
    expect(cdf).toMatch(/18.400,00.FC/);
    for (const html of [usd, cdf]) { expect(html).not.toContain("USD"); expect(html).not.toContain("CDF"); }
  });
});
