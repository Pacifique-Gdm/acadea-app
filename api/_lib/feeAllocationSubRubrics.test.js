// Lots 5 et 6 — sous-rubriques (décisions de l'utilisateur des 25 et 27/11/2026).
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { getAllocationSpendOptions, manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { createPersonnelPayment } from "./personnelPayroll.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { SUB_RUBRICS_PHRASE, nextSubBalances, splitSubRubricCumulative, subRubricBalanceView, subRubricDeltas, validateSubRubrics } from "./feeAllocationSubRubrics.js";

const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;
afterEach(() => vi.unstubAllEnvs());

describe("calcul des sous-rubriques", () => {
  const subs = validateSubRubrics([
    { id: "1".repeat(16), name: "Ouvrier", mode: "fixed", fixedMinor: 400 },
    { id: "2".repeat(16), name: "Administratif", mode: "percent", basisPoints: 5000, functions: ["secretary"] },
    { id: "3".repeat(16), name: "Enseignant", mode: "percent", basisPoints: 3000, functions: ["teacher"] },
  ]);
  it("le montant fixe est servi en premier, les pourcentages se partagent le reste", () => {
    expect(Object.fromEntries(splitSubRubricCumulative(subs, 4000))).toEqual({ ["1".repeat(16)]: 400, ["2".repeat(16)]: 1800, ["3".repeat(16)]: 1080 });
    // Paiement en deux fois : le fixe est pris au premier paiement, une seule fois par élève et par frais.
    const first = subRubricDeltas(subs, 0, 2000), second = subRubricDeltas(subs, 2000, 4000);
    expect(first).toEqual([{ subRubricId: "1".repeat(16), amountMinor: 400 }, { subRubricId: "2".repeat(16), amountMinor: 800 }, { subRubricId: "3".repeat(16), amountMinor: 480 }]);
    expect(second).toEqual([{ subRubricId: "2".repeat(16), amountMinor: 1000 }, { subRubricId: "3".repeat(16), amountMinor: 600 }]);
    // Un paiement plus petit que le fixe : la sous-rubrique fixe reçoit seulement ce qui est payé.
    expect(subRubricDeltas(subs, 0, 300)).toEqual([{ subRubricId: "1".repeat(16), amountMinor: 300 }]);
    // Base : la répartition commence au cumul déjà atteint (paiements reçus avant la création).
    expect(subRubricDeltas(subs, 2000, 4000, 2000)).toEqual(first);
  });
  it("refuse plus de 100 %, un nom réservé, un doublon et une fonction inconnue", () => {
    expect(() => validateSubRubrics([{ name: "A", mode: "percent", basisPoints: 6000 }, { name: "B", mode: "percent", basisPoints: 5000 }])).toThrow("100 %");
    expect(() => validateSubRubrics([{ name: "Non affecté (Personnel)", mode: "percent", basisPoints: 10 }])).toThrow("réservé");
    expect(() => validateSubRubrics([{ name: "A", mode: "percent", basisPoints: 10 }, { name: " a ", mode: "fixed", fixedMinor: 5 }])).toThrow("même nom");
    expect(() => validateSubRubrics([{ name: "A", mode: "percent", basisPoints: 10, functions: ["inconnue"] }])).toThrow("Fonctions");
  });
  it("« Non affecté (rubrique) » = la rubrique moins ses sous-rubriques, ouverture et anciennes dépenses comprises", () => {
    const view = subRubricBalanceView({ openingMinor: 1000, receivedMinor: 4000, spentMinor: 1500, reservedMinor: 0,
      subBalances: { ["1".repeat(16)]: { receivedMinor: 400, spentMinor: 300 } } }, subs, "Personnel");
    expect(view.at(-1)).toEqual({ id: "UNALLOCATED", name: "Non affecté (Personnel)", functions: [], receivedMinor: 4600, spentMinor: 1200, availableMinor: 3400 });
    expect(view[0]).toMatchObject({ name: "Ouvrier", availableMinor: 100 });
  });
});

async function activeSchool() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `sub-active-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  return db;
}
const rubrics = (db, action, extra = {}, caller = admin) => manageFeeAllocationRubrics({ db, caller, now: at, body: { action, requestId: `sub-rubric-${++sequence}-request`, ...extra } });
const saveSubs = (db, subRubrics, extra = {}) => rubrics(db, "save-sub-rubrics", { rubricId, subRubrics, confirmation: SUB_RUBRICS_PHRASE, ...extra });
const pay = (db, amount, key, now = "2026-11-13T11:00:00.000Z") => executeFinancialOperation({ db, caller: cashier, now, body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const spend = (db, amount, key, extra = {}) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T12:00:00.000Z", body: { action: "create-expense", schoolYearId: "year", amount, category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: key, allocationRubricId: rubricId, ...extra } });
const balance = (db) => [...db.records].find(([p, v]) => p.startsWith("feeAllocationBalances/") && v.rubricId === rubricId)[1];
const options = (db) => getAllocationSpendOptions({ db, caller: cashier, body: { schoolId: "school", schoolYearId: "year" }, now: at });
const twoSubs = [{ name: "Ouvrier", mode: "fixed", fixedMinor: 500, functions: ["service"] }, { name: "Enseignant", mode: "percent", basisPoints: 5000, functions: ["teacher"] }];

describe("lot 5 — créer les sous-rubriques", () => {
  it("seul l'Administrateur enregistre ; la phrase est exigée pour un pourcentage ou un montant ; le nom seul n'en a pas besoin", async () => {
    const db = await activeSchool();
    await expect(saveSubs(db, twoSubs, { confirmation: "oui" })).rejects.toThrow(SUB_RUBRICS_PHRASE);
    await expect(rubrics(db, "save-sub-rubrics", { rubricId, subRubrics: twoSubs, confirmation: SUB_RUBRICS_PHRASE }, cashier)).rejects.toMatchObject({ status: 403 });
    const { rubric } = await saveSubs(db, twoSubs);
    expect(rubric.subRubrics).toEqual([expect.objectContaining({ name: "Ouvrier", mode: "fixed", fixedMinor: 500 }), expect.objectContaining({ name: "Enseignant", basisPoints: 5000 })]);
    const renamed = rubric.subRubrics.map((s, i) => ({ ...s, name: i ? "Enseignants" : s.name }));
    await rubrics(db, "save-sub-rubrics", { rubricId, subRubrics: renamed });
    await expect(rubrics(db, "save-sub-rubrics", { rubricId, subRubrics: renamed.map((s, i) => i ? { ...s, basisPoints: 4000 } : s) })).rejects.toThrow(SUB_RUBRICS_PHRASE);
    const listed = await rubrics(db, "list-rubrics");
    expect(listed.rubrics[0].subView.map((r) => r.name)).toEqual(["Ouvrier", "Enseignants", "Non affecté (Personnel)"]);
  });
  it("les encaissements suivants alimentent les sous-rubriques ; ceux d'avant restent dans « Non affecté (rubrique) »", async () => {
    const db = await activeSchool();
    await pay(db, 25, "sub-payment-before-01"); // rubrique : 2 000 avant la création
    await saveSubs(db, twoSubs);
    await pay(db, 25, "sub-payment-after-001"); // rubrique : 2 000 de plus, partagés
    const { rubrics: list } = await rubrics(db, "list-rubrics");
    const view = Object.fromEntries(list[0].subView.map((r) => [r.name, r.receivedMinor]));
    expect(view).toEqual({ Ouvrier: 500, Enseignant: 750, "Non affecté (Personnel)": 2750 });
    expect(balance(db).receivedMinor).toBe(4000);
  });
  it("une sous-rubrique qui a servi ne peut pas être retirée", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, twoSubs);
    await pay(db, 50, "sub-payment-used-0001");
    await expect(saveSubs(db, [rubric.subRubrics[1]])).rejects.toThrow("a déjà servi");
  });
});

describe("lot 6 — sorties d'argent avec sous-rubrique", () => {
  it("le Caissier voit les sous-rubriques et « Non affecté (rubrique) » avec leur disponible ; sous-rubrique obligatoire ; blocage au-delà du solde", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, twoSubs);
    await pay(db, 50, "sub-payment-spend-001"); // rubrique 4 000 : Ouvrier 500, Enseignant 1 750, Non affecté 1 750
    const listed = (await options(db)).rubrics.find((r) => r.id === rubricId);
    expect(listed.subRubrics.map((s) => [s.name, s.availableMinor])).toEqual([["Ouvrier", 500], ["Enseignant", 1750], ["Non affecté (Personnel)", 1750]]);
    const [ouvrier, enseignant] = rubric.subRubrics.map((s) => s.id);
    await expect(spend(db, 1, "sub-expense-none-0001")).rejects.toThrow("sous-rubrique");
    const before = structuredClone([...db.records]);
    await expect(spend(db, 6, "sub-expense-over-0001", { allocationSubRubricId: ouvrier })).rejects.toThrow("Ouvrier");
    expect([...db.records]).toEqual(before);
    const { expense } = await spend(db, 5, "sub-expense-ok-00001", { allocationSubRubricId: ouvrier });
    expect(expense.allocationSubRubricId).toBe(ouvrier);
    expect(balance(db).subBalances[ouvrier]).toEqual({ receivedMinor: 500, spentMinor: 500 });
    await spend(db, 17.5, "sub-expense-na-000001", { allocationSubRubricId: "UNALLOCATED" });
    await expect(spend(db, 0.01, "sub-expense-na-000002", { allocationSubRubricId: "UNALLOCATED" })).rejects.toThrow("Non affecté (Personnel)");
    // Modification : la sous-rubrique d'origine est reprise ; une hausse au-delà du solde est refusée, une baisse acceptée.
    await expect(executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:00:00.000Z", body: { action: "update-expense", transactionId: expense.id, amount: 6, category: "Fournitures", description: "Achat", reason: "Correction", clientRequestId: "sub-expense-up-000001" } })).rejects.toThrow("Ouvrier");
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T13:00:00.000Z", body: { action: "update-expense", transactionId: expense.id, amount: 3, category: "Fournitures", description: "Achat", reason: "Correction", clientRequestId: "sub-expense-down-0001" } });
    expect(balance(db).subBalances[ouvrier].spentMinor).toBe(300);
    // Annulation : l'argent revient dans la même sous-rubrique.
    await executeFinancialOperation({ db, caller: admin, now: "2026-11-13T14:00:00.000Z", body: { action: "delete-expense", transactionId: expense.id, reason: "Annulation", clientRequestId: "sub-expense-del-00001" } });
    expect(balance(db).subBalances[ouvrier].spentMinor).toBe(0);
    expect(balance(db).subBalances[enseignant]).toEqual({ receivedMinor: 1750, spentMinor: 0 });
  });
  it("une rubrique sans sous-rubrique refuse une sous-rubrique ; sans répartition active, aucune sous-rubrique n'est acceptée", async () => {
    const db = await activeSchool(); await pay(db, 50, "sub-payment-plain-001");
    await expect(spend(db, 1, "sub-expense-plain-001", { allocationSubRubricId: "1".repeat(16) })).rejects.toThrow("Sous-rubrique inconnue");
    await spend(db, 1, "sub-expense-plain-002");
    const idle = completeAllocationFixture();
    await expect(executeFinancialOperation({ db: idle, caller: cashier, now: at, body: { action: "create-expense", schoolYearId: "year", amount: 1, category: "Fournitures", description: "Achat", beneficiary: "Fournisseur", paymentMethod: "Espèces", clientRequestId: "sub-expense-idle-0001", allocationSubRubricId: "1".repeat(16) } })).rejects.toThrow("Aucune répartition active");
  });
  it("paie : la sous-rubrique est enregistrée avec le paiement du personnel et bloquée au-delà du solde", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, twoSubs);
    await pay(db, 50, "sub-payment-payroll01");
    const enseignant = rubric.subRubrics[1].id;
    const body = { action: "create-personnel-payment", schoolYearId: "year", beneficiaryId: "teacher", kind: "salary", periodMonth: 11, periodYear: 2026, paidAt: "2026-11-13", amount: 10, deduction: 0, deductionReason: "", cnss: 0, tax: 0, recoveries: [], description: "Test", allocationRubricId: rubricId, allocationSubRubricId: enseignant, clientRequestId: "sub-salary-request-01" };
    await createPersonnelPayment({ db, caller: cashier, body, now: "2026-11-13T12:00:00.000Z" });
    expect(balance(db).subBalances[enseignant].spentMinor).toBe(1000);
    await expect(createPersonnelPayment({ db, caller: cashier, body: { ...body, amount: 8, clientRequestId: "sub-salary-request-02" }, now: "2026-11-13T12:00:00.000Z" })).rejects.toThrow("Enseignant");
  });
  it("une correction d'encaissement reprend la part des sous-rubriques, jamais sous ce qui a été dépensé", () => {
    const subs = validateSubRubrics(twoSubs.map((s, i) => ({ ...s, id: String(i + 1).repeat(16) })));
    const deltas = subRubricDeltas(subs, 4000, 2000); // 50 → 25 : Enseignant 1 750 → 750
    expect(deltas).toEqual([{ subRubricId: "2".repeat(16), amountMinor: -1000 }]);
    const balanceDoc = { subBalances: { ["2".repeat(16)]: { receivedMinor: 1750, spentMinor: 1000 } } };
    expect(() => nextSubBalances(balanceDoc, deltas)).toThrow("sous-rubrique");
    expect(nextSubBalances(balanceDoc, subRubricDeltas(subs, 4000, 3200))).toEqual({ ["2".repeat(16)]: { receivedMinor: 1350, spentMinor: 1000 } });
    // Changement de classe (sortie de l'ancienne ancre) : même règle que la rubrique, le retrait est accepté.
    expect(nextSubBalances(balanceDoc, deltas, { allowBelowSpent: true })).toEqual({ ["2".repeat(16)]: { receivedMinor: 750, spentMinor: 1000 } });
  });
});
