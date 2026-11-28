import { createHash, randomBytes } from "node:crypto";
import { FeeAllocationError } from "./feeAllocationMath.js";
import { allocationHash } from "./feeAllocationRuntime.js";

/** Lots 5 et 6 — sous-rubriques d'une rubrique du catalogue (décisions de l'utilisateur, 25 et 27/11/2026).
 * - Une seule répartition par rubrique, valable pour tous les frais qui l'alimentent.
 * - Montant fixe : compté PAR ÉLÈVE ET PAR FRAIS PAYÉ (une ancre), converti en pourcentage (F2, 28/11/2026).
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
// F2 (28/11/2026, « Même règle partout ») : la marque « montant-fixe-en-pourcentage » fait repartir chaque élève du cumul
// déjà atteint : la nouvelle règle vaut pour les paiements suivants seulement ; les anciens ne sont pas réécrits.
export const subRubricAmountsKey = (subs) => hash(["montant-fixe-en-pourcentage", (subs ?? []).map((s) => [s.id, s.mode, s.basisPoints ?? null, s.fixedMinor ?? null])]);

/** F2 (décision du 28/11/2026, « Même règle partout ») — partage d'un montant cumulé d'une rubrique pour une ancre (un
 * élève, un frais) : chaque sous-rubrique reçoit son pourcentage ; un montant fixe est d'abord converti en pourcentage
 * (montant fixe ÷ part de la rubrique pour cet élève et ce frais, `fullMinor` ; part réduite pour un cas social).
 * Un montant fixe ne reçoit jamais plus que lui-même par élève (`carry` = déjà reçu avant le dernier changement).
 * Si montants fixes convertis et pourcentages dépassent 100 %, les montants fixes se partagent ce qui reste après les
 * pourcentages. Arrondis vers le bas ; le reste va à « Reste ». Une part ne baisse jamais quand le cumul monte. */
export function splitSubRubricCumulative(subs, amountMinor, carry = {}, fullMinor = 0) {
  const cumul = BigInt(Math.max(0, amountMinor)), full = BigInt(Math.max(0, fullMinor));
  const percent = BigInt(subs.reduce((n, sub) => n + (sub.mode === "percent" ? sub.basisPoints : 0), 0));
  const fixedTotal = BigInt(subs.reduce((n, sub) => n + (sub.mode === "fixed" ? sub.fixedMinor : 0), 0));
  const over = full === 0n || fixedTotal * 10000n > (10000n - percent) * full;
  const result = new Map();
  for (const sub of subs) {
    if (sub.mode === "percent") { result.set(sub.id, Number((cumul * BigInt(sub.basisPoints)) / 10000n)); continue; }
    const share = fixedTotal === 0n ? 0n : over ? (cumul * BigInt(sub.fixedMinor) * (10000n - percent)) / (fixedTotal * 10000n) : (cumul * BigInt(sub.fixedMinor)) / full;
    result.set(sub.id, Math.min(Number(share), Math.max(0, sub.fixedMinor - (carry[sub.id] ?? 0))));
  }
  return result;
}

/** Différence de partage entre deux cumuls, comptés à partir de la base (cumul atteint quand la répartition actuelle a commencé). */
export function subRubricDeltas(subs, beforeMinor, afterMinor, baseMinor = 0, carry = {}, fullMinor = 0) {
  const before = splitSubRubricCumulative(subs, beforeMinor - baseMinor, carry, fullMinor), after = splitSubRubricCumulative(subs, afterMinor - baseMinor, carry, fullMinor);
  return subs.map((sub) => ({ subRubricId: sub.id, amountMinor: after.get(sub.id) - before.get(sub.id) })).filter((line) => line.amountMinor !== 0);
}

/** Sous-rubriques appliquées à chaque tableau (1 : partie 1 ; 2 : cas sociaux, partie 1 si elles dépasseraient 100 %). */
export function subRubricsByTable(subs, socialOverrides) {
  const social = effectiveSocialSubRubrics(subs, socialOverrides);
  return { 1: subs ?? [], 2: social.reduce((n, sub) => n + (sub.mode === "percent" ? sub.basisPoints : 0), 0) > 10000 ? subs ?? [] : social };
}

/** F2 (28/11/2026) — prévu de chaque sous-rubrique, tableau par tableau, à partir des lignes du prévu de la rubrique
 * (`rows` : { table, amountMinor, studentsCount }) : un pourcentage s'applique au prévu ; un montant fixe vaut son
 * montant par élève (c'est sa conversion en pourcentage), avec la même limite à 100 % que les encaissements. */
export function subRubricPlanned(subsByTable, rows) {
  const planned = { 1: new Map(), 2: new Map() }, rubric = { 1: 0, 2: 0 }, detail = new Map();
  for (const row of rows ?? []) {
    const table = row.table === 2 ? 2 : 1, subs = subsByTable[table] ?? [];
    const amount = Math.max(0, row.amountMinor ?? 0), count = Math.max(0, row.studentsCount ?? 0);
    rubric[table] += amount;
    const percent = BigInt(subs.reduce((n, sub) => n + (sub.mode === "percent" ? sub.basisPoints : 0), 0));
    const fixedTotal = BigInt(subs.reduce((n, sub) => n + (sub.mode === "fixed" ? sub.fixedMinor : 0), 0));
    const over = fixedTotal * BigInt(count) * 10000n > (10000n - percent) * BigInt(amount);
    for (const sub of subs) {
      const share = sub.mode === "percent" ? (BigInt(amount) * BigInt(sub.basisPoints)) / 10000n
        : over ? (BigInt(amount) * BigInt(sub.fixedMinor) * (10000n - percent)) / (fixedTotal * 10000n) : BigInt(sub.fixedMinor) * BigInt(count);
      planned[table].set(sub.id, (planned[table].get(sub.id) ?? 0) + Number(share));
      // Détail par frais et par classe : l'écran applique ses filtres (frais, classe) au prévu des sous-rubriques.
      if (!detail.has(sub.id)) detail.set(sub.id, []);
      detail.get(sub.id).push({ table, feeTypeId: String(row.feeTypeId ?? ""), classKey: String(row.classOptionKey || row.className || ""), amountMinor: Number(share) });
    }
  }
  return { planned, rubric, detail };
}

/** F2 (28/11/2026) — part de l'ouverture de chaque sous-rubrique : ouverture de la rubrique × (prévu de la sous-rubrique
 * ÷ prévu de la rubrique), tableaux 1 et 2 ensemble. Un pourcentage garde donc son pourcentage ; un montant fixe y entre
 * converti en pourcentage. Arrondi vers le bas ; le reste reste dans « Reste ». */
export function subRubricOpeningShares(openingMinor, { planned, rubric }) {
  const total = BigInt(rubric[1] + rubric[2]), shares = {};
  if (!(openingMinor > 0) || total === 0n) return shares;
  for (const id of new Set([...planned[1].keys(), ...planned[2].keys()])) shares[id] = Number((BigInt(openingMinor) * BigInt((planned[1].get(id) ?? 0) + (planned[2].get(id) ?? 0))) / total);
  return shares;
}

/** F2 (28/11/2026) — options de la vue des soldes d'une rubrique du catalogue (`entry`) : prévu par tableau et part de
 * l'ouverture, à partir des lignes du prévu annuel. Sans prévu lisible : vue sans ces deux colonnes (comme avant). */
export function subRubricViewOptions(entry, balance, forecastRows) {
  if (!Array.isArray(forecastRows) || !Array.isArray(entry?.subRubrics) || !entry.subRubrics.length) return {};
  const plan = subRubricPlanned(subRubricsByTable(entry.subRubrics, entry.socialSubRubrics), forecastRows.filter((row) => row?.rubricId === entry.id && !row.arrearsYearName));
  return { planned: plan, openingShares: subRubricOpeningShares(balance?.openingMinor ?? 0, plan) };
}

/** Lignes du prévu gardées (dernier prévu calculé par l'application) : lecture d'un seul document, aussi dans une
 * transaction. Le Caissier et le contrôle des dépenses lisent ainsi le même prévu que les tableaux. */
export async function readKeptForecastRows(reader, db, schoolId, yearId, currency) {
  // Même identifiant que forecastCacheId (feeAllocationForecast.js), recalculé ici pour éviter une boucle d'imports.
  const ref = db.doc(`feeAllocationForecastCaches/${allocationHash(["forecast-cache", schoolId, yearId, currency])}`);
  const kept = (await (reader ? reader.get(ref) : ref.get())).data();
  return kept?.forecast?.status === "complete" && Array.isArray(kept.forecast.rows) ? kept.forecast.rows : null;
}

/** Soldes affichés : chaque sous-rubrique, puis « Non affecté (rubrique) » = rubrique moins la somme des sous-rubriques.
 * F2 (28/11/2026) : `openingShares` = part de l'ouverture de chaque sous-rubrique (subRubricOpeningShares), comptée dans
 * son disponible ; `planned` (subRubricPlanned) = son prévu, par tableau, frais et classe. Même calcul pour les tableaux, le PDF et le Caissier. */
export function subRubricBalanceView(balance, subs, rubricName = "", { openingShares = {}, planned } = {}) {
  const rubricReceived = (balance?.openingMinor ?? 0) + (balance?.receivedMinor ?? 0);
  const rubricSpent = (balance?.spentMinor ?? 0) + (balance?.reservedMinor ?? 0);
  const rows = (subs ?? []).map((sub) => {
    const own = balance?.subBalances?.[sub.id] ?? {};
    const receivedMinor = own.receivedMinor ?? 0, spentMinor = own.spentMinor ?? 0, openingMinor = openingShares[sub.id] ?? 0;
    return { id: sub.id, name: sub.name, mode: sub.mode, ...(sub.mode === "fixed" ? { fixedMinor: sub.fixedMinor } : { basisPoints: sub.basisPoints }),
      functions: sub.functions ?? [], receivedMinor, spentMinor, availableMinor: openingMinor + receivedMinor - spentMinor,
      ...(planned || openingMinor ? { openingMinor } : {}), ...(planned ? { plannedMinor: planned.detail.get(sub.id) ?? [] } : {}) };
  });
  const receivedMinor = rubricReceived - rows.reduce((n, r) => n + r.receivedMinor + (r.openingMinor ?? 0), 0);
  const spentMinor = rubricSpent - rows.reduce((n, r) => n + r.spentMinor, 0);
  return [...rows, { id: SUB_UNALLOCATED, name: `Non affecté (${rubricName})`, functions: [], receivedMinor, spentMinor, availableMinor: receivedMinor - spentMinor }];
}

/** Encaissement : lit les sous-rubriques des rubriques touchées (lectures seulement, avant toute écriture) et renvoie
 * les parts de chaque sous-rubrique, plus la base gardée dans le cumul de l'ancre. */
export async function prepareSubRubricReceipt({ db, transaction, schoolId, schoolYearId, lines, priorLines, nextLines, fullLines, total, social = false }) {
  const byRubric = new Map();
  let movements = null;
  const subBase = { ...(total?.subBase && typeof total.subBase === "object" ? total.subBase : {}) };
  for (let index = 0; index < lines.length; index += 1) {
    const rubricId = lines[index].rubricId;
    if (!isCatalogRubricId(rubricId) || lines[index].amountMinor === 0) continue;
    const entry = (await transaction.get(db.doc(`feeAllocationRubrics/${rubricId}`))).data();
    if (!entry || entry.schoolId !== schoolId || entry.schoolYearId !== schoolYearId || !Array.isArray(entry.subRubrics) || !entry.subRubrics.length) continue;
    const partOneSubs = validateSubRubrics(entry.subRubrics, { newId: () => reconcile("Sous-rubrique enregistrée sans identifiant.") });
    // F2 : un cas social qui suit une partie 2 prend les sous-rubriques des cas sociaux (partie 1 si elles dépasseraient 100 %).
    const socialSubs = social ? effectiveSocialSubRubrics(partOneSubs, entry.socialSubRubrics) : partOneSubs;
    const subs = socialSubs.reduce((n, sub) => n + (sub.mode === "percent" ? sub.basisPoints : 0), 0) > 10000 ? partOneSubs : socialSubs;
    if (!subs.length) continue;
    const key = subRubricAmountsKey(subs);
    const before = priorLines[index].amountMinor, after = nextLines[index].amountMinor;
    const stored = subBase[rubricId];
    const same = stored && stored.key === key && safe(stored.baseMinor);
    const baseMinor = same ? stored.baseMinor : before;
    // F2 : au changement des montants, ce que chaque sous-rubrique a déjà reçu pour cet élève (`served`) devient `carry`.
    let previous = stored?.served;
    if (!same && stored && previous === undefined && typeof total?.anchorId === "string") {
      // Cumul écrit avant cette correction (sans `served`) : relu dans les mouvements déjà enregistrés de cet élève et de
      // ce frais (lecture seule, une fois par encaissement) ; rien n'est réécrit.
      movements ??= (await transaction.get(db.collection("feeAllocationMovements").where("anchorId", "==", total.anchorId))).docs.map((doc) => doc.data());
      previous = {};
      for (const movement of movements) if (movement?.schoolId === schoolId) for (const line of movement.subLines ?? []) {
        if (line?.rubricId === rubricId && isSubRubricId(line.subRubricId) && Number.isSafeInteger(line.amountMinor)) previous[line.subRubricId] = (previous[line.subRubricId] ?? 0) + line.amountMinor;
      }
    }
    const carry = cleanAmounts(same ? stored.carry : previous);
    // F2 : part de la rubrique pour cet élève et ce frais (net réduit pour un cas social) : convertit un montant fixe en %.
    const fullMinor = fullLines?.[index]?.amountMinor ?? 0;
    const deltas = subRubricDeltas(subs, before, after, baseMinor, carry, fullMinor);
    const served = { ...carry };
    for (const [id, amount] of splitSubRubricCumulative(subs, after - baseMinor, carry, fullMinor)) served[id] = (served[id] ?? 0) + amount;
    subBase[rubricId] = { key, baseMinor, carry, served };
    byRubric.set(rubricId, deltas);
  }
  return { byRubric, subBase };
}

const cleanAmounts = (value) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([id, n]) => isSubRubricId(id) && safe(n))) : {};

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

/** F2 (décision du 27/11/2026) — sous-rubriques des cas sociaux (partie 2), une seule répartition par rubrique pour tous
 * les frais des cas sociaux. On ne garde que les écarts avec la partie 1 : `socialSubRubrics = { [subId]: { removed: true }
 * | { mode: "percent", basisPoints } | { mode: "fixed", fixedMinor } }`. Une sous-rubrique sans écart suit la partie 1. */
export function validateSocialSubOverrides(input, subs) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("Sous-rubriques des cas sociaux invalides.");
  const known = new Map((subs ?? []).map((sub) => [sub.id, sub]));
  const clean = {};
  for (const [subId, value] of Object.entries(input)) {
    if (!known.has(subId)) invalid("Sous-rubrique inconnue pour cette rubrique.");
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Sous-rubrique des cas sociaux invalide.");
    const keys = Object.keys(value);
    if (value.removed === true && keys.length === 1) { clean[subId] = { removed: true }; continue; }
    if (value.mode === "percent" && keys.length === 2 && Number.isInteger(value.basisPoints) && value.basisPoints >= 1 && value.basisPoints <= 10000) { clean[subId] = { mode: "percent", basisPoints: value.basisPoints }; continue; }
    if (value.mode === "fixed" && keys.length === 2 && safe(value.fixedMinor) && value.fixedMinor > 0) { clean[subId] = { mode: "fixed", fixedMinor: value.fixedMinor }; continue; }
    invalid("Sous-rubrique des cas sociaux invalide.");
  }
  if (socialPercentTotal(subs, clean) > 10000) invalid("Les pourcentages des sous-rubriques des cas sociaux dépassent 100 %.");
  return clean;
}

const socialPercentTotal = (subs, overrides) => effectiveSocialSubRubrics(subs, overrides).reduce((n, sub) => n + (sub.mode === "percent" ? sub.basisPoints : 0), 0);

/** Sous-rubriques appliquées aux cas sociaux : celles de la partie 1, moins les lignes retirées, avec les valeurs modifiées. */
export function effectiveSocialSubRubrics(subs, overrides) {
  const own = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
  return (subs ?? []).flatMap((sub) => {
    const change = own[sub.id];
    if (!change) return [sub];
    if (change.removed === true) return [];
    return [{ id: sub.id, name: sub.name, ...(change.mode === "fixed" ? { mode: "fixed", fixedMinor: change.fixedMinor } : { mode: "percent", basisPoints: change.basisPoints }), functions: sub.functions ?? [] }];
  });
}

/** Après un changement de la partie 1 : écarts des sous-rubriques retirées oubliés ; refus si les cas sociaux dépasseraient 100 %. */
export function keptSocialSubOverrides(overrides, subs) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return null;
  const kept = Object.fromEntries(Object.entries(overrides).filter(([subId]) => subs.some((sub) => sub.id === subId)));
  if (socialPercentTotal(subs, kept) > 10000) invalid("Avec ces valeurs, les sous-rubriques des cas sociaux dépasseraient 100 % : corrigez-les d'abord dans la partie 2.");
  return kept;
}
