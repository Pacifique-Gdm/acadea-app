// « Répartir le Reste » (décisions de l'utilisateur du 28/11/2026) : l'Administrateur répartit UNE fois l'argent de
// « ↳ Reste » vers les sous-rubriques, selon leur % (un montant fixe est converti en % : son prévu ÷ prévu de la rubrique),
// après avoir tapé exactement « RÉPARTIR CE RESTE ». Un mouvement daté est créé ; les anciens mouvements ne changent pas ;
// le total de la rubrique ne change pas ; tableau, PDF et Caissier donnent ensuite les mêmes chiffres.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { getAllocationSpendOptions, manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { buildAllocationWorkspace } from "./feeAllocationPhase2.js";
import { SUB_REST_PHRASE, SUB_RUBRICS_PHRASE, subRestShares } from "./feeAllocationSubRubrics.js";
import { SUB_REST_NAME, buildAllocationTables, projectAllocations, unbreakableMoney, type AllocationRow } from "../../src/utils/feeAllocationView";
import { feeAllocationPdfSections } from "../../src/utils/feeAllocationPdf";
import { SUB_REST_PHRASE as SCREEN_PHRASE, restRedistributedText } from "../../src/modules/menu/SubRubricDetail";
import type { AllocationWorkspace } from "../../src/services/feeAllocation";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32), later = "2026-11-13T12:20:00.000Z";
let sequence = 0;
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

/** Même école d'essai que les tests des tableaux F2 : ouverture de 25 $, un paiement avant la création des sous-rubriques
 * (il reste dans « Reste »), puis un élève normal, un cas social et une dépense de sous-rubrique — tous réels. */
async function school() {
  const db = completeAllocationFixture();
  const lifecycle = (action: string, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `sub-rest-${++sequence}-request`, ...extra } });
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
  await pay("student", 10, "sub-rest-before-00001");
  const { rubric } = await manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action: "save-sub-rubrics", rubricId, confirmation: SUB_RUBRICS_PHRASE, requestId: `sub-rest-${++sequence}-request`,
    subRubrics: [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: [] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: [] }] } });
  await pay("student", 30, "sub-rest-normal-00001");
  db.records.set("students/social", { ...structuredClone(db.records.get("students/student")), id: "social", financialSupport: { d: { id: "d", schoolYearId: "year", lines: { fee: { reductionMinor: 5000 } } } } });
  await pay("social", 25, "sub-rest-social-00001");
  await executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount: 4, category: "Fournitures", description: "Achat",
    beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: "sub-rest-expense-00001", allocationRubricId: rubricId, allocationSubRubricId: rubric.subRubrics[1].id } });
  delete db.records.get("students/social").financialSupport;
  const workspace = async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:30:00.000Z"));
    try { return await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false }) as unknown as AllocationWorkspace; }
    finally { vi.useRealTimers(); }
  };
  const call = (action: string, extra = {}, caller = admin) => manageFeeAllocationRubrics({ db, caller, now: later, body: { action, rubricId, requestId: `sub-rest-${++sequence}-request`, ...extra } });
  return { db, rubric, workspace, call };
}
const all = { kind: "fee" as const, value: "", from: "", to: "" };
const personnel = (rows: AllocationRow[]) => rows.find((row) => row.rubricId === rubricId)!;
type Line = { subRubricId: string; name: string; amountMinor: number };
type Plan = { restMinor: number; totalMinor: number; remainingMinor: number; lines: Line[] };
const movements = (db: { records: Map<string, unknown> }) => [...db.records].filter(([key]) => key.startsWith("feeAllocationMovements/"));

describe("« Répartir le Reste »", () => {
  it("calcul : un % garde son % ; un montant fixe est converti en % (son prévu ÷ prévu de la rubrique) ; jamais plus que le Reste", () => {
    const subs = [{ id: "craies", name: "Craies", mode: "percent", basisPoints: 3000 }, { id: "entretien", name: "Entretien", mode: "fixed", fixedMinor: 1000 }];
    const planned = { rubric: { 1: 14400, 2: 0 }, planned: { 1: new Map([["entretien", 2000]]), 2: new Map() } };
    // Exemple de la maquette : 79,38 $ ; 30 % = 23,81 $ ; 20 ÷ 144 = 13,89 % = 11,02 $ ; il reste 44,55 $.
    expect(subRestShares(subs, 7938, planned)).toEqual([{ subRubricId: "craies", name: "Craies", amountMinor: 2381 }, { subRubricId: "entretien", name: "Entretien", amountMinor: 1102 }]);
    expect(subRestShares(subs, 0, planned)).toEqual([]);
    expect(subRestShares([{ id: "x", name: "X", mode: "percent", basisPoints: 10000 }, ...subs], 100, planned).reduce((n, l) => n + l.amountMinor, 0)).toBe(100);
  });

  it("aperçu sans écriture, phrase exacte obligatoire, puis un seul mouvement daté ; le total de la rubrique ne change pas ; une seule fois", async () => {
    const { db, call, workspace } = await school();
    const before = personnel(buildAllocationTables(projectAllocations([await workspace()], all)).three);
    const restBefore = before.subLines!.at(-1)!;
    const oldMovements = movements(db).map(([key, value]) => [key, structuredClone(value)]);
    const oldBalance = structuredClone(db.records.get([...db.records.keys()].find((key) => key.startsWith("feeAllocationBalances/") && db.records.get(key).rubricId === rubricId)!));

    const { preview } = await call("preview-sub-rest") as unknown as { preview: Plan };
    expect(preview.restMinor).toBe(restBefore.availableMinor);
    expect(preview.totalMinor + preview.remainingMinor).toBe(preview.restMinor);
    expect(preview.lines.map((line) => line.name)).toEqual(["Ouvrier", "Enseignant"]);
    expect(movements(db)).toHaveLength(oldMovements.length);

    // Refus : phrase manquante ou approximative ; Caissier.
    await expect(call("redistribute-sub-rest")).rejects.toThrow(SUB_REST_PHRASE);
    await expect(call("redistribute-sub-rest", { confirmation: "repartir ce reste" })).rejects.toThrow(SUB_REST_PHRASE);
    await expect(call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE }, cashier)).rejects.toThrow("Administrateur");
    expect(SCREEN_PHRASE).toBe(SUB_REST_PHRASE);

    const done = await call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE }) as unknown as { redistributed: Plan };
    expect(done.redistributed.totalMinor).toBe(preview.totalMinor);
    const created = movements(db).filter(([key]) => !oldMovements.some(([old]) => old === key));
    expect(created).toHaveLength(1);
    const movement = created[0][1] as { subLines: Line[] };
    expect(movement).toMatchObject({ sourceType: "transfer", type: "sub-rest-redistribution", amountMinor: 0, postedAt: later, actorId: "admin", lines: [{ rubricId, amountMinor: 0 }] });
    expect(movement.subLines.reduce((n, l) => n + l.amountMinor, 0)).toBe(preview.totalMinor);
    // Les anciens mouvements ne sont pas réécrits ; le total de la rubrique est inchangé.
    for (const [key, value] of oldMovements) expect(db.records.get(key as string)).toEqual(value);
    const balance = db.records.get([...db.records.keys()].find((key) => key.startsWith("feeAllocationBalances/") && db.records.get(key).rubricId === rubricId)!);
    for (const field of ["openingMinor", "receivedMinor", "spentMinor", "reservedMinor", "availableMinor"]) expect(balance[field]).toBe(oldBalance[field]);
    expect(db.records.get(`feeAllocationRubrics/${rubricId}`).restRedistribution).toMatchObject({ at: later, by: "admin", amountMinor: preview.totalMinor });

    // Une seule fois : ni un deuxième aperçu, ni une deuxième répartition.
    await expect(call("preview-sub-rest")).rejects.toThrow("une fois");
    await expect(call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE })).rejects.toThrow("une fois");
    expect(movements(db)).toHaveLength(oldMovements.length + 1);
  });

  it("après : encaissé (cumul) + pour les sous-rubriques, − pour « Reste » ; prévu, ouverture et filtre inchangés ; tableau = PDF = Caissier", async () => {
    const { db, call, workspace, rubric } = await school();
    const tablesBefore = buildAllocationTables(projectAllocations([await workspace()], all));
    const done = await call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE }) as unknown as { redistributed: Plan };
    const ws = await workspace();
    expect(ws.rubricCatalog?.find((r) => r.id === rubricId)?.restRedistributedAt).toBe(later);
    const rows = projectAllocations([ws], all), tables = buildAllocationTables(rows);
    const moved = new Map(done.redistributed.lines.map((line) => [line.subRubricId, line.amountMinor]));
    for (const key of ["one", "two", "three"] as const) {
      const was = personnel(tablesBefore[key]), now = personnel(tables[key]);
      // Rubrique inchangée.
      expect(now.financial).toEqual(was.financial);
      expect(now.amountMinor).toBe(was.amountMinor);
      for (const [i, line] of now.subLines!.entries()) {
        const old = was.subLines![i];
        expect([line.plannedMinor, line.openingMinor, line.receivedMinor, line.cumulativeSpentMinor]).toEqual([old.plannedMinor, old.openingMinor, old.receivedMinor, old.cumulativeSpentMinor]);
        expect(line.availableMinor - old.availableMinor).toBe(line.cumulativeReceivedMinor - old.cumulativeReceivedMinor);
        if (line.name === SUB_REST_NAME) expect(line.cumulativeReceivedMinor).toBeLessThanOrEqual(old.cumulativeReceivedMinor);
        else expect(line.cumulativeReceivedMinor).toBeGreaterThanOrEqual(old.cumulativeReceivedMinor);
        expect(line.availableMinor, line.name).toBeGreaterThanOrEqual(0);
      }
      for (const field of ["cumulativeReceivedMinor", "availableMinor"] as const) expect(now.subLines!.reduce((n, l) => n + l[field], 0)).toBe(now.financial![field]);
    }
    // Tableau 3 : exactement les montants répartis.
    const three = personnel(tables.three), threeBefore = personnel(tablesBefore.three);
    rubric.subRubrics.forEach((sub: { id: string }, i: number) => expect(three.subLines![i].cumulativeReceivedMinor - threeBefore.subLines![i].cumulativeReceivedMinor).toBe(moved.get(sub.id) ?? 0));
    expect(threeBefore.subLines!.at(-1)!.availableMinor - three.subLines!.at(-1)!.availableMinor).toBe(done.redistributed.totalMinor);
    // Caissier et PDF : mêmes disponibles que le tableau 3.
    const spend = (await getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at }) as { rubrics: { id: string; subRubrics?: { availableMinor: number }[] }[] })
      .rubrics.find((r) => r.id === rubricId)!.subRubrics!;
    expect(spend.map((sub) => sub.availableMinor)).toEqual(three.subLines!.map((line) => line.availableMinor));
    const pdf = feeAllocationPdfSections(rows, "Frais : Tous les frais", "", false)[2];
    for (const line of three.subLines!) expect(pdf).toContain(unbreakableMoney(line.availableMinor, "USD"));
    // Écran : message après la répartition.
    expect(restRedistributedText(later)).toMatch(/^Reste réparti le 13\/11\/2026 à \d{2}:\d{2} par l'administrateur\.$/);
  });

  it("refus : rubrique sans sous-rubriques, ou « Reste » vide", async () => {
    const { db, call } = await school();
    const record = db.records.get(`feeAllocationRubrics/${rubricId}`);
    db.records.set(`feeAllocationRubrics/${rubricId}`, { ...record, subRubrics: [] });
    await expect(call("preview-sub-rest")).rejects.toThrow("pas de sous-rubriques");
    db.records.set(`feeAllocationRubrics/${rubricId}`, record);
    await call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE });
    // Même sans la marque (copie ancienne), le mouvement déjà créé empêche une deuxième répartition.
    const withoutMark = { ...db.records.get(`feeAllocationRubrics/${rubricId}`) };
    delete withoutMark.restRedistribution;
    db.records.set(`feeAllocationRubrics/${rubricId}`, withoutMark);
    await expect(call("redistribute-sub-rest", { confirmation: SUB_REST_PHRASE })).rejects.toThrow(/une fois|vide/);
  });
});
