// F2 (décisions de l'utilisateur du 28/11/2026) — lignes « ↳ » propres à chaque tableau, calculées à partir de vrais
// mouvements d'essai : dans chaque tableau, la somme des sous-rubriques est égale à la rubrique, colonne par colonne ;
// toutes les colonnes sont remplies (le montant fixe est converti en %) ; tableau, PDF et Caissier donnent le même chiffre.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { getAllocationSpendOptions, manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { buildAllocationWorkspace } from "./feeAllocationPhase2.js";
import { filterWorkspaceForStaff } from "./feeAllocationSharing.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";
import { SUB_REST_NAME, allocationSubLines, buildAllocationTables, projectAllocations, prorataShares, splitLikeRubric, unbreakableMoney, type AllocationRow, type AllocationSubLine } from "../../src/utils/feeAllocationView";
import { feeAllocationPdfSections } from "../../src/utils/feeAllocationPdf";
import type { AllocationWorkspace } from "../../src/services/feeAllocation";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

/** École d'essai : 25 $ encaissés avant l'activation (ouverture de la rubrique), répartition activée, rubrique
 * « Personnel » (80 % du frais de 100 $) avec un montant fixe et un pourcentage, un élève normal (tableau 1) et un cas
 * social (tableau 2), des paiements et une dépense de sous-rubrique — tous réels. */
async function schoolWithMovements() {
  const db = completeAllocationFixture();
  const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `tables-sub-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  db.records.set("payments/old", { schoolId: "school", schoolYearId: "year", currency: "USD", amount: 25, createdAt: "2026-11-01", provenance: "financial-api", clientRequestIdHash: "proof" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 2500, lines: [{ rubricId, amountMinor: 2500 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  const pay = (studentId: string, amount: number, key: string) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z",
    body: { action: "create-payment", schoolYearId: "year", studentId, feeTypeId: "fee", amount, clientRequestId: key } });
  await pay("student", 10, "tables-sub-before-0001"); // avant la création : reste dans « Reste »
  const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `tables-sub-${++sequence}-request`,
    subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
  await pay("student", 30, "tables-sub-normal-0001");
  // Cas social : même élève d'essai copié, avec une réduction sur ce frais (tableau 2).
  db.records.set("students/social", { ...structuredClone(db.records.get("students/student")), id: "social", financialSupport: { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000 } } } } });
  await pay("social", 25, "tables-sub-social-0001");
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount: 4, category: "Fournitures", description: "Achat",
    beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: "tables-sub-expense-0001", allocationRubricId: rubricId, allocationSubRubricId: rubric.subRubrics[1].id } });
  // Le paiement garde son tableau (socialCase) une fois enregistré ; la réduction est retirée avant la lecture parce que
  // le Firestore d'essai ne sait pas faire la requête « in » du prévu des cas sociaux.
  delete db.records.get("students/social").financialSupport;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:30:00.000Z"));
  const workspace = await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false }) as unknown as AllocationWorkspace;
  return { db, workspace, rubric };
}
const fields = ["openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor", "receivedMinor"] as const;
const personnel = (rows: AllocationRow[]) => rows.find((row) => row.rubricId === rubricId)!;
const sumOf = (row: AllocationRow, field: typeof fields[number] | "plannedMinor") => row.subLines!.reduce((n, line) => n + ((line as AllocationSubLine)[field] ?? 0), 0);
const all = { kind: "fee" as const, value: "", from: "", to: "" };

describe("F2 — lignes « ↳ » propres à chaque tableau (vrais mouvements)", () => {
  it("dans chaque tableau, la somme des lignes « ↳ » est égale à la rubrique, colonne par colonne ; aucune colonne vide", async () => {
    const { workspace } = await schoolWithMovements();
    const tables = buildAllocationTables(projectAllocations([workspace], all));
    for (const table of [tables.one, tables.two, tables.three]) {
      const row = personnel(table);
      expect(row.subLines!.map((line) => line.name)).toEqual(["Ouvrier ($5/⁠élève)", "Enseignant (50 %)", SUB_REST_NAME]);
      for (const field of fields) expect(sumOf(row, field), `${field} (tableau ${row.table})`).toBe(row.financial![field]);
      expect(sumOf(row, "plannedMinor"), `prévu (tableau ${row.table})`).toBe(row.amountMinor);
      for (const line of row.subLines!) {
        // Aucune colonne vide (jamais « — ») et rien de négatif.
        for (const value of [line.plannedMinor, line.receivedMinor, line.openingMinor, line.cumulativeReceivedMinor, line.cumulativeSpentMinor, line.availableMinor]) {
          expect(value, line.name).not.toBeNull(); expect(value, line.name).not.toBeUndefined(); expect(value!, line.name).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("le % s'applique à toutes les colonnes : ouverture et prévu ; le montant fixe est converti en % (5 $ sur 80 $ = 6,25 %)", async () => {
    const { workspace } = await schoolWithMovements();
    const three = personnel(buildAllocationTables(projectAllocations([workspace], all)).three);
    const [ouvrier, enseignant, reste] = three.subLines!;
    // Ouverture de la rubrique : 25 $. Enseignant 50 % ; Ouvrier = son prévu ÷ prévu de la rubrique.
    expect(three.financial!.openingMinor).toBe(2500);
    expect(enseignant.openingMinor).toBe(1250);
    expect(ouvrier.openingMinor).toBe(Math.floor((2500 * ouvrier.plannedMinor!) / three.amountMinor));
    expect(reste.openingMinor).toBe(2500 - 1250 - ouvrier.openingMinor!);
    // Prévu : Enseignant 50 % du prévu, Ouvrier 5 $ par élève (2 élèves).
    expect(enseignant.plannedMinor).toBe(Math.floor(three.amountMinor / 2));
    expect(ouvrier.plannedMinor).toBe(1000);
    // Encaissé : le paiement de 10 $ fait avant la création reste dans « Reste » (8 $ pour la rubrique).
    expect(reste.cumulativeReceivedMinor).toBeGreaterThanOrEqual(800);
  });

  it("partage des dépenses entre les tableaux 1 et 2 : somme exacte, jamais négatif, jamais plus que le montant", () => {
    for (const [parts, w1, w2] of [[[360000, 0], 2880000, 1800000], [[100, 33, 1], 7, 3], [[1, 1, 1], 1, 1], [[0, 5], 2, 0], [[0, 5], 0, 2]] as [number[], number, number][]) {
      const total = parts.reduce((n, x) => n + x, 0), two = prorataShares(total, w1, w2)[1];
      const shares = splitLikeRubric(parts, two, w1, w2);
      expect(shares.reduce((n, x) => n + x, 0)).toBe(two);
      shares.forEach((share, i) => { expect(share).toBeGreaterThanOrEqual(0); expect(share).toBeLessThanOrEqual(parts[i]); });
    }
  });

  it("chaque tableau a ses propres chiffres, cohérents avec sa rubrique ; le tableau 3 additionne les tableaux 1 et 2", async () => {
    const { db, workspace } = await schoolWithMovements();
    const tables = buildAllocationTables(projectAllocations([workspace], all));
    const [one, two, three] = [tables.one, tables.two, tables.three].map(personnel);
    const byName = (row: AllocationRow) => Object.fromEntries(row.subLines!.map((line) => [line.name.split(" (")[0], [line.cumulativeReceivedMinor, line.cumulativeSpentMinor, line.availableMinor]]));
    // Les parts enregistrées dans les mouvements, par tableau (élève normal : tableau 1 ; cas social : tableau 2).
    const parts = (social: boolean) => [...db.records].filter(([p, v]) => p.startsWith("feeAllocationMovements/") && v.sourceType === "payment" && v.socialCase === social)
      .flatMap(([, v]) => v.subLines ?? []).reduce((acc: Record<string, number>, line: { subRubricId: string; amountMinor: number }) => ({ ...acc, [line.subRubricId]: (acc[line.subRubricId] ?? 0) + line.amountMinor }), {});
    const ids = one.subLines!.slice(0, 2).map((line) => line.id);
    expect(one.subLines!.slice(0, 2).map((line) => line.cumulativeReceivedMinor)).toEqual(ids.map((id) => parts(false)[id] ?? 0));
    expect(two.subLines!.slice(0, 2).map((line) => line.cumulativeReceivedMinor)).toEqual(ids.map((id) => parts(true)[id] ?? 0));
    expect(byName(one)).not.toEqual(byName(two));
    for (const [i, line] of three.subLines!.entries()) for (const field of ["plannedMinor", "receivedMinor", "openingMinor", "cumulativeReceivedMinor", "cumulativeSpentMinor", "availableMinor"] as const)
      expect(line[field], `${line.name} ${field}`).toBe((one.subLines![i][field] ?? 0) + (two.subLines![i][field] ?? 0));
    // La dépense de 4 $ sur « Enseignant » se retrouve en entier au tableau 3.
    expect(three.subLines![1].cumulativeSpentMinor).toBe(400);
    // Le tableau 3 reste identique aux soldes enregistrés de l'école (sans filtre de date).
    const global = allocationSubLines(workspace.ledger!.balances.find((b) => b.rubricId === rubricId), "USD")!;
    expect(three.subLines!.map((line) => [line.openingMinor, line.cumulativeReceivedMinor, line.cumulativeSpentMinor, line.availableMinor]))
      .toEqual(global.map((line) => [line.openingMinor, line.cumulativeReceivedMinor, line.cumulativeSpentMinor, line.availableMinor]));
    // Vue partagée (personnel) : mêmes lignes du tableau 3, rubrique partagée seulement.
    const staff = buildAllocationTables(projectAllocations([filterWorkspaceForStaff(workspace as never, [rubricId]) as unknown as AllocationWorkspace], all));
    for (const field of fields) expect(sumOf(personnel(staff.three), field)).toBe(personnel(staff.three).financial![field]);
  });

  it("tableau, PDF et Caissier donnent le même disponible pour chaque sous-rubrique et pour « Reste »", async () => {
    const { db, workspace, rubric } = await schoolWithMovements();
    const rows = projectAllocations([workspace], all);
    const three = personnel(buildAllocationTables(rows).three);
    const cashier = (await getAllocationSpendOptions({ db, caller: { uid: "cashier", role: "cashier", schoolId: "school" }, body: { schoolId: "school", schoolYearId: "year" }, now: at }) as { rubrics: { id: string; subRubrics?: { id: string; availableMinor: number }[] }[] })
      .rubrics.find((r) => r.id === rubricId)!.subRubrics!;
    expect(cashier.map((sub) => sub.id)).toEqual([...rubric.subRubrics.map((sub: { id: string }) => sub.id), "UNALLOCATED"]);
    expect(cashier.map((sub) => sub.availableMinor)).toEqual(three.subLines!.map((line) => line.availableMinor));
    // Le Caissier voit bien une part de l'ouverture dans les sous-rubriques (pas seulement dans « Reste »).
    expect(three.subLines![1].openingMinor).toBeGreaterThan(0);
    const pdf = feeAllocationPdfSections(rows, "Frais : Tous les frais", "", false)[2];
    for (const line of three.subLines!) {
      expect(pdf).toContain(`↳ ${line.name}`);
      expect(pdf).toContain(unbreakableMoney(line.availableMinor, "USD"));
    }
    // Une dépense au-delà de ce disponible est refusée ; jusqu'au disponible, elle passe (même chiffre que l'écran).
    const enseignant = rubric.subRubrics[1].id, available = three.subLines![1].availableMinor;
    const spend = (amount: number, key: string) => executeFinancialOperation({ db, caller: { uid: "cashier", role: "cashier", schoolId: "school" }, now: "2026-11-13T12:40:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount,
      category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key, allocationRubricId: rubricId, allocationSubRubricId: enseignant } });
    await expect(spend((available + 1) / 100, "tables-sub-expense-over1")).rejects.toThrow("Enseignant");
    await spend(available / 100, "tables-sub-expense-exact1");
  });

  it("PDF : chaque tableau imprime ses propres lignes « ↳ », sans tiret, dont la somme est la rubrique", async () => {
    const { workspace } = await schoolWithMovements();
    const rows = projectAllocations([workspace], all);
    const html = feeAllocationPdfSections(rows, "Frais : Tous les frais", "", false);
    const tables = buildAllocationTables(rows);
    [tables.one, tables.two, tables.three].forEach((table, index) => {
      for (const line of personnel(table).subLines!) {
        expect(html[index]).toContain(`↳ ${line.name}`);
        for (const value of [line.plannedMinor!, line.receivedMinor!, line.openingMinor!, line.availableMinor]) expect(html[index]).toContain(unbreakableMoney(value, "USD"));
      }
    });
  });

  it("libellé dans la devise du document : un PDF en francs écrit « FC/élève », jamais « $ »", () => {
    const lines = allocationSubLines({ openingMinor: 0, subView: [{ id: "1".repeat(16), name: "Entretien", mode: "fixed", fixedMinor: 500000, receivedMinor: 0, spentMinor: 0, availableMinor: 0 },
      { id: "UNALLOCATED", name: "Non affecté (Bibliothèque)", receivedMinor: 0, spentMinor: 0, availableMinor: 0 }] }, "CDF")!;
    expect(lines[0].name).toMatch(/^Entretien \(5.000 FC\/⁠élève\)$/);
    expect(lines[0].name).not.toContain("$");
  });
});
