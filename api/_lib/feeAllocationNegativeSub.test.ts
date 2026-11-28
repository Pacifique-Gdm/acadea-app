// F2 (décision de l'utilisateur du 28/11/2026) : quand le prévu est mis à jour, la part de l'ouverture d'une sous-rubrique
// peut BAISSER alors que le Caissier a déjà dépensé plus. Aucun ancien mouvement n'est réécrit ; le disponible s'affiche
// tel quel (négatif, en rouge dans les tableaux) ; toute nouvelle dépense sur cette sous-rubrique est refusée tant qu'il
// est négatif ; le total de la rubrique reste juste.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { getAllocationSpendOptions, manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { buildAllocationWorkspace } from "./feeAllocationPhase2.js";
import { validateFeeAllocationRubrics } from "./feeAllocationMath.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";
import { buildAllocationTables, projectAllocations, type AllocationRow } from "../../src/utils/feeAllocationView";
import type { AllocationWorkspace } from "../../src/services/feeAllocation";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
afterEach(() => { vi.useRealTimers(); });

describe("F2 — part de l'ouverture d'une sous-rubrique qui baisse après une mise à jour du prévu", () => {
  it("disponible négatif affiché tel quel, mouvements inchangés, nouvelle dépense de 1 centime refusée, total de la rubrique juste", async () => {
    const db = completeAllocationFixture();
    const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `negative-${++sequence}-request`, ...extra } });
    await lifecycle("publish-configuration", { versionId: "version" });
    db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
    await reconcileFixture(db, admin, at);
    const opening = await lifecycle("prepare-opening", { cashCountMinor: 2500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
    await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
    await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
    db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
    db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
    const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `negative-${++sequence}-request`,
      subRubrics: [{ name: "Entretien", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
    await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount: 30, clientRequestId: "negative-payment-0001" } });
    const entretien = rubric.subRubrics[0].id;
    const spend = (amount: number, key: string) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:40:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount,
      category: "Fournitures", description: "Entretien", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key, allocationRubricId: rubricId, allocationSubRubricId: entretien } });
    const tableThree = async () => {
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:30:00.000Z"));
      try {
        const workspace = await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false }) as unknown as AllocationWorkspace;
        return buildAllocationTables(projectAllocations([workspace], { kind: "fee", value: "", from: "", to: "" })).three.find((row: AllocationRow) => row.rubricId === rubricId)!;
      } finally { vi.useRealTimers(); }
    };
    const cashierView = async () => ((await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at }) as { rubrics: { id: string; subRubrics?: { availableMinor: number }[] }[] })
      .rubrics.find((r) => r.id === rubricId)!.subRubrics!.map((sub) => sub.availableMinor));

    // Le Caissier dépense tout le disponible d'Entretien (part de l'ouverture comprise).
    const before = await tableThree();
    const opened = before.subLines![0].openingMinor!;
    expect(opened).toBeGreaterThan(0);
    await spend(before.subLines![0].availableMinor / 100, "negative-expense-0001");
    const spent = await tableThree();
    expect(spent.subLines![0].availableMinor).toBe(0);
    const movements = structuredClone([...db.records].filter(([key]) => key.startsWith("feeAllocationMovements/")));
    const balanceKey = [...db.records.keys()].find((key) => key.startsWith("feeAllocationBalances/") && db.records.get(key).rubricId === rubricId)!;
    const balance = structuredClone(db.records.get(balanceKey));

    // Nouveau frais de 1 000 $ réparti à 80 % sur la même rubrique : le prévu de la rubrique monte beaucoup, celui du
    // montant fixe d'Entretien de seulement 5 $ → sa part de l'ouverture baisse.
    const version = db.records.get("feeAllocationVersions/version"), configKey = [...db.records.keys()].find((key) => key.startsWith("feeAllocationConfigs/"))!;
    db.records.set("feeTypes/fee-new", { ...db.records.get("feeTypes/fee"), id: "fee-new", name: "Frais d'examen", amount: 1000 });
    db.records.set("feeAllocationVersions/version-new", { ...version, id: "version-new", configId: "config-new", feeTypeId: "fee-new", feeAmountMinor: 100000, shares: validateFeeAllocationRubrics(version.rubrics, 100000).shares });
    db.records.set("feeAllocationConfigs/config-new", { ...db.records.get(configKey), id: "config-new", feeTypeId: "fee-new", currentVersionId: "version-new" });

    const after = await tableThree();
    expect(after.subLines![0].openingMinor!).toBeLessThan(opened);
    // Disponible négatif affiché tel quel ; le Caissier voit le même chiffre.
    expect(after.subLines![0].availableMinor).toBe(after.subLines![0].openingMinor! - opened);
    expect(after.subLines![0].availableMinor).toBeLessThan(0);
    expect(await cashierView()).toEqual(after.subLines!.map((line) => line.availableMinor));
    // Le total de la rubrique reste juste : la somme des lignes « ↳ » est égale à la rubrique ; ouverture et solde inchangés.
    for (const field of ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const) {
      expect(after.subLines!.reduce((n, line) => n + (line[field] ?? 0), 0), field).toBe(after.financial![field]);
      expect(after.financial![field], field).toBe(spent.financial![field]);
    }
    // Aucun ancien mouvement réécrit, aucun solde changé.
    expect(structuredClone([...db.records].filter(([key]) => key.startsWith("feeAllocationMovements/")))).toEqual(movements);
    expect(db.records.get(balanceKey)).toEqual(balance);
    // Nouvelle dépense de 1 centime refusée tant que le disponible est négatif ; rien n'a bougé.
    await expect(spend(0.01, "negative-expense-0002")).rejects.toThrow("Entretien");
    expect(db.records.get(balanceKey)).toEqual(balance);
  });

  it("tableaux : un disponible négatif d'une ligne « ↳ » s'affiche en rouge (colonne Solde disponible seulement)", () => {
    const drawer = readFileSync(new URL("../../src/modules/menu/FeeAllocationDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain('<span className={i === 2 && value < 0 ? "text-red-700" : undefined} data-negative-available={i === 2 && value < 0 ? "" : undefined}>{formatSignedCurrencyMoney(value / 100, row.currency)}</span>');
  });
});
