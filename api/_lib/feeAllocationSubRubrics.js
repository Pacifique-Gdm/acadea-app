import { createHash, randomBytes } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";

/** Lots 5 et 6 — sous-rubriques d'une rubrique du catalogue (décisions de l'utilisateur, 25 et 27/11/2026).
 * - Une seule répartition par rubrique, valable pour tous les frais qui l'alimentent.
 * - Montant fixe : compté PAR ÉLÈVE ET PAR FRAIS PAYÉ (une ancre), servi en premier ; le reste en pourcentage.
 * - Ce qui n'est pas réparti reste dans « Non affecté (rubrique) », calculé : rubrique moins ses sous-rubriques.
 * - Les encaissements reçus avant la création restent dans « Non affecté (rubrique) » ; l'historique n'est pas réécrit. */
export const SUB_UNALLOCATED = "UNALLOCATED";
export const SUB_RUBRICS_PHRASE = "ENREGISTRER LES SOUS-RUBRIQUES";
/** « Fonctions concernées » : rôles du personnel avec compte, et « service » pour le personnel sans compte. */
export const SUB_RUBRIC_FUNCTIONS = ["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "service"];
const SUB_ID = /^[a-f0-9]{16}$/;
const CATALOG_RUBRIC_ID = /^[a-f0-9]{32}$/;
const MAX_SUB_RUBRICS = 20;
const KEYS = ["id", "name", "mode", "basisPoints", "fixedMinor", "functions"];
const invalid = (message) => { throw new FeeAllocationError(400, "invalid-argument", message); };
const reconcile = (message) => { throw new FeeAllocationError(409, "allocation-reconciliation-required", message); };
const safe = (n) => Number.isSafeInteger(n) && n >= 0;
const nameKey = (name) => String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const isSubRubricId = (value) => typeof value === "string" && SUB_ID.test(value);
export const isCatalogRubricId = (value) => typeof value === "string" && CATALOG_RUBRIC_ID.test(value);

/** Vérifie et nettoie la liste ; une ligne sans identifiant reçoit un identifiant neuf (création). */
export function validateSubRubrics(input, { newId = () => randomBytes(8).toString("hex") } = {}) {
  if (!Array.isArray(input) || input.length > MAX_SUB_RUBRICS) invalid(`Une rubrique a au plus ${MAX_SUB_RUBRICS} sous-rubriques.`);
  const ids = new Set(), names = new Set();
  let basisPoints = 0;
  const list = input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((key) => !KEYS.includes(key))) invalid("Sous-rubrique invalide.");
    const id = item.id === undefined ? newId() : item.id;
    if (!isSubRubricId(id) || ids.has(id)) invalid("Identifiant de sous-rubrique invalide ou en double.");
    const name = typeof item.name === "string" ? item.name.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
    if (!name || name.length > 80) invalid("Le nom d'une sous-rubrique doit contenir de 1 à 80 caractères.");
    if (nameKey(name).startsWith(nameKey("Non affecté"))) invalid("« Non affecté » est réservé : choisissez un autre nom.");
    if (names.has(nameKey(name))) invalid("Deux sous-rubriques portent le même nom.");
    const functions = item.functions ?? [];
    if (!Array.isArray(functions) || functions.some((f) => !SUB_RUBRIC_FUNCTIONS.includes(f)) || new Set(functions).size !== functions.length) invalid("Fonctions concernées invalides.");
    ids.add(id); names.add(nameKey(name));
    if (item.mode === "percent") {
      if (!Number.isInteger(item.basisPoints) || item.basisPoints < 1 || item.basisPoints > 10000 || item.fixedMinor !== undefined) invalid("Pourcentage de sous-rubrique invalide.");
      basisPoints += item.basisPoints;
      return { id, name, mode: "percent", basisPoints: item.basisPoints, functions: [...functions] };
    }
    if (item.mode !== "fixed" || !safe(item.fixedMinor) || item.fixedMinor === 0 || item.basisPoints !== undefined) invalid("Montant fixe de sous-rubrique invalide.");
    return { id, name, mode: "fixed", fixedMinor: item.fixedMinor, functions: [...functions] };
  });
  if (basisPoints > 10000) invalid("Les pourcentages des sous-rubriques dépassent 100 %.");
  return list;
}

/** Empreinte des seuls pourcentages et montants : un changement exige la phrase et repart des paiements suivants. */
export const subRubricAmountsKey = (subs) => hash((subs ?? []).map((s) => [s.id, s.mode, s.basisPoints ?? null, s.fixedMinor ?? null]));

/** Partage d'un montant cumulé d'une rubrique pour une ancre (un élève, un frais) : montants fixes d'abord, dans l'ordre,
 * puis les pourcentages sur le reste (arrondis vers le bas). Le reste non partagé va à « Non affecté (rubrique) ».
 * Chaque part ne baisse jamais quand le cumul monte : un paiement suivant n'enlève rien. */
export function splitSubRubricCumulative(subs, amountMinor) {
  let rest = Math.max(0, amountMinor);
  const result = new Map();
  for (const sub of subs) if (sub.mode === "fixed") { const take = Math.min(rest, sub.fixedMinor); result.set(sub.id, take); rest -= take; }
  for (const sub of subs) if (sub.mode === "percent") result.set(sub.id, Number((BigInt(rest) * BigInt(sub.basisPoints)) / 10000n));
  return result;
}

/** Différence de partage entre deux cumuls, comptés à partir de la base (cumul atteint quand la répartition actuelle a commencé). */
export function subRubricDeltas(subs, beforeMinor, afterMinor, baseMinor = 0) {
  const before = splitSubRubricCumulative(subs, beforeMinor - baseMinor), after = splitSubRubricCumulative(subs, afterMinor - baseMinor);
  return subs.map((sub) => ({ subRubricId: sub.id, amountMinor: after.get(sub.id) - before.get(sub.id) })).filter((line) => line.amountMinor !== 0);
}

/** Soldes affichés : chaque sous-rubrique, puis « Non affecté (rubrique) » = rubrique moins la somme des sous-rubriques. */
export function subRubricBalanceView(balance, subs, rubricName = "") {
  const rubricReceived = (balance?.openingMinor ?? 0) + (balance?.receivedMinor ?? 0);
  const rubricSpent = (balance?.spentMinor ?? 0) + (balance?.reservedMinor ?? 0);
  const rows = (subs ?? []).map((sub) => {
    const own = balance?.subBalances?.[sub.id] ?? {};
    const receivedMinor = own.receivedMinor ?? 0, spentMinor = own.spentMinor ?? 0;
    return { id: sub.id, name: sub.name, mode: sub.mode, ...(sub.mode === "fixed" ? { fixedMinor: sub.fixedMinor } : { basisPoints: sub.basisPoints }),
      functions: sub.functions ?? [], receivedMinor, spentMinor, availableMinor: receivedMinor - spentMinor };
  });
  const receivedMinor = rubricReceived - rows.reduce((n, r) => n + r.receivedMinor, 0);
  const spentMinor = rubricSpent - rows.reduce((n, r) => n + r.spentMinor, 0);
  return [...rows, { id: SUB_UNALLOCATED, name: `Non affecté (${rubricName})`, functions: [], receivedMinor, spentMinor, availableMinor: receivedMinor - spentMinor }];
}

/** Encaissement : lit les sous-rubriques des rubriques touchées (lectures seulement, avant toute écriture) et renvoie
 * les parts de chaque sous-rubrique, plus la base gardée dans le cumul de l'ancre. */
export async function prepareSubRubricReceipt({ db, transaction, schoolId, schoolYearId, lines, priorLines, nextLines, total }) {
  const byRubric = new Map();
  const subBase = { ...(total?.subBase && typeof total.subBase === "object" ? total.subBase : {}) };
  for (let index = 0; index < lines.length; index += 1) {
    const rubricId = lines[index].rubricId;
    if (!isCatalogRubricId(rubricId) || lines[index].amountMinor === 0) continue;
    const entry = (await transaction.get(db.doc(`feeAllocationRubrics/${rubricId}`))).data();
    if (!entry || entry.schoolId !== schoolId || entry.schoolYearId !== schoolYearId || !Array.isArray(entry.subRubrics) || !entry.subRubrics.length) continue;
    const subs = validateSubRubrics(entry.subRubrics, { newId: () => reconcile("Sous-rubrique enregistrée sans identifiant.") });
    const key = subRubricAmountsKey(subs);
    const before = priorLines[index].amountMinor, after = nextLines[index].amountMinor;
    const stored = subBase[rubricId];
    const baseMinor = stored && stored.key === key && safe(stored.baseMinor) ? stored.baseMinor : before;
    subBase[rubricId] = { key, baseMinor };
    byRubric.set(rubricId, subRubricDeltas(subs, before, after, baseMinor));
  }
  return { byRubric, subBase };
}

/** Nouveaux soldes des sous-rubriques d'une rubrique après un encaissement (ou sa correction). */
export function nextSubBalances(balance, deltas, { allowBelowSpent = false } = {}) {
  const next = { ...(balance?.subBalances ?? {}) };
  for (const { subRubricId, amountMinor } of deltas) {
    const own = next[subRubricId] ?? {};
    const receivedMinor = (own.receivedMinor ?? 0) + amountMinor, spentMinor = own.spentMinor ?? 0;
    if (!safe(receivedMinor) || (!allowBelowSpent && amountMinor < 0 && receivedMinor < spentMinor)) reconcile("Correction incompatible avec des fonds déjà dépensés dans une sous-rubrique.");
    next[subRubricId] = { receivedMinor, spentMinor };
  }
  return next;
}
