// F2 — montant fixe d'une sous-rubrique modifié pendant qu'un élève paie encore (décisions de l'utilisateur, 27 et 28/11/2026) :
// le fixe est fixe PAR ÉLÈVE ET PAR FRAIS PAYÉ, converti en % (fixe ÷ part de la rubrique pour l'élève : ici 80 $) ;
// un changement vaut pour les paiements suivants seulement ; ce qui a déjà été servi compte dans le nouveau fixe, jamais deux fois.
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeAllocationFixture } from "./feeAllocationLifecycle.test.js";
import { manageFeeAllocationLifecycle } from "./feeAllocationLifecycle.js";
import { manageFeeAllocationRubrics } from "./feeAllocationRubrics.js";
import { executeFinancialOperation } from "./financialTransactions.js";
import { reconcileFixture } from "./feeAllocationTestHelpers.js";
import { SUB_RUBRICS_PHRASE } from "./feeAllocationSubRubrics.js";
import { buildAllocationWorkspace } from "./feeAllocationPhase2.js";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
const admin = { uid: "admin", role: "school_admin", schoolId: "school" }, cashier = { uid: "cashier", role: "cashier", schoolId: "school" };
const at = "2026-11-13T10:00:00.000Z", rubricId = "a".repeat(32);
let sequence = 0;

async function activeSchool() {
  const db = completeAllocationFixture();
  const lifecycle = (action, extra = {}) => manageFeeAllocationLifecycle({ db, caller: admin, now: at, body: { action, requestId: `fixed-change-${++sequence}-request`, ...extra } });
  await lifecycle("publish-configuration", { versionId: "version" });
  await reconcileFixture(db, admin, at);
  const opening = await lifecycle("prepare-opening", { cashCountMinor: 0, lines: [{ rubricId, amountMinor: 0 }], confirmation: "RAPPROCHER LA CAISSE" });
  await lifecycle("approve-opening", { openingId: opening.openingId, confirmation: "APPROUVER LE RAPPROCHEMENT" });
  await lifecycle("activate", { openingId: opening.openingId, confirmation: "ACTIVER LA REPARTITION FICTIVE" });
  db.records.set("feeAllocationRubricCatalogs/school__year", { schoolId: "school", schoolYearId: "year" });
  db.records.set(`feeAllocationRubrics/${rubricId}`, { id: rubricId, schoolId: "school", schoolYearId: "year", name: "Personnel", hidden: false });
  return db;
}
const rubrics = (db, action, extra = {}) => manageFeeAllocationRubrics({ db, caller: admin, now: at, body: { action, requestId: `fixed-change-rubric-${++sequence}`, ...extra } });
const saveSubs = (db, subRubrics) => rubrics(db, "save-sub-rubrics", { rubricId, subRubrics, confirmation: SUB_RUBRICS_PHRASE });
// Dans ce jeu d'essai, la rubrique reçoit 80 % de chaque paiement : 7,50 $ payés = 6 $ pour la rubrique.
const pay = (db, amount, key) => executeFinancialOperation({ db, caller: cashier, now: "2026-11-13T11:00:00.000Z", body: { action: "create-payment", schoolYearId: "year", studentId: "student", feeTypeId: "fee", amount, clientRequestId: key } });
const view = async (db) => Object.fromEntries((await rubrics(db, "list-rubrics")).rubrics[0].subView.map((r) => [r.name, r.receivedMinor]));
const movements = (db) => [...db.records].filter(([p]) => p.startsWith("feeAllocationMovements/")).map(([p, v]) => [p, structuredClone(v)]);

describe("F2 — montant fixe changé pendant que l'élève paie encore", () => {
  it("fixe 10 $ (12,5 %), le fixe passe à 15 $ : les paiements suivants suivent le nouveau %, les anciens ne sont pas réécrits", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, [{ name: "Ouvrier", mode: "fixed", fixedMinor: 1000 }]);
    await pay(db, 7.5, "fixed-change-pay-0001"); // rubrique : 6 $ ; Ouvrier 12,5 % = 0,75 $
    expect(await view(db)).toEqual({ Ouvrier: 75, "Non affecté (Personnel)": 525 });
    const written = movements(db);
    await saveSubs(db, [{ ...rubric.subRubrics[0], fixedMinor: 1500 }]);
    await pay(db, 42.5, "fixed-change-pay-0002"); // rubrique : 34 $ de plus ; Ouvrier 18,75 % = 6,37 $
    expect(await view(db)).toEqual({ Ouvrier: 712, "Non affecté (Personnel)": 3288 });
    // Les mouvements déjà écrits ne sont ni réécrits ni effacés.
    for (const [path, value] of written) expect(db.records.get(path)).toEqual(value);
    // Tableaux 1-2-3, PDF et vue partagée : mêmes soldes (lus par l'espace de travail, à la date de la fixture).
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:00:00.000Z"));
    const workspace = await buildAllocationWorkspace({ db, caller: admin, school: db.records.get("schools/school"), schoolId: "school", body: {}, retryPending: false });
    const row = workspace.ledger.balances.find((b) => b.rubricId === rubricId);
    expect(row.subView.map((r) => [r.name, r.receivedMinor])).toEqual([["Ouvrier", 712], ["Non affecté (Personnel)", 3288]]);
  });

  it("élève payé en partie AVANT la correction (cumul sans « served ») : le fixe changé n'est servi qu'une fois, rien n'est réécrit", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, [{ name: "Ouvrier", mode: "fixed", fixedMinor: 1000 }]);
    await pay(db, 7.5, "fixed-change-pay-0007"); // rubrique : 6 $ ; Ouvrier 0,75 $
    // Cumul écrit par l'ancienne version (lot 5) : seulement { key, baseMinor }.
    const [path, total] = [...db.records].find(([p]) => p.startsWith("feeAllocationRequests/obligation_"));
    db.records.set(path, { ...total, subBase: Object.fromEntries(Object.entries(total.subBase).map(([id, { key, baseMinor }]) => [id, { key, baseMinor }])) });
    const written = movements(db);
    await saveSubs(db, [{ ...rubric.subRubrics[0], fixedMinor: 1500 }]);
    await pay(db, 42.5, "fixed-change-pay-0008");
    expect(await view(db)).toEqual({ Ouvrier: 712, "Non affecté (Personnel)": 3288 });
    for (const [p, value] of written) expect(db.records.get(p)).toEqual(value);
  });

  it("un fixe baissé sous ce qui est déjà servi ne sert plus rien ; jamais plus que le fixe par élève", async () => {
    const db = await activeSchool();
    const { rubric } = await saveSubs(db, [{ name: "Ouvrier", mode: "fixed", fixedMinor: 1000 }, { name: "Enseignant", mode: "percent", basisPoints: 5000 }]);
    await pay(db, 50, "fixed-change-pay-0003"); // rubrique 4 000 : Ouvrier 12,5 % = 500, Enseignant 2 000
    expect(await view(db)).toEqual({ Ouvrier: 500, Enseignant: 2000, "Non affecté (Personnel)": 1500 });
    await saveSubs(db, [{ ...rubric.subRubrics[0], fixedMinor: 500 }, rubric.subRubrics[1]]);
    await pay(db, 50, "fixed-change-pay-0004"); // rubrique +4 000 : Ouvrier a déjà ses 5 $, Enseignant 2 000
    expect(await view(db)).toEqual({ Ouvrier: 500, Enseignant: 4000, "Non affecté (Personnel)": 3500 });
  });
});
