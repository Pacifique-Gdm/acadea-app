const RUBRIC_ID = /^[a-f0-9]{32}$/;
export const UNALLOCATED_RUBRIC_ID = "UNALLOCATED";
/** Lot 27c-3a : ligne d'arriéré = rubrique à part entière, par année d'origine (« Non affecté (arriéré 2025-2026) »).
 * Son identifiant garde l'année d'origine et la rubrique de cette année ; son solde est distinct de l'année en cours. */
const ARREARS_KEY = /^ARR__([A-Za-z0-9_-]{1,120})__(UNALLOCATED|[a-f0-9]{32})$/;
export const arrearsRubricKey = (originSchoolYearId, rubricId) => `ARR__${originSchoolYearId}__${rubricId}`;
export function parseArrearsRubricKey(key) {
  const match = typeof key === "string" ? ARREARS_KEY.exec(key) : null;
  return match ? { originSchoolYearId: match[1], rubricId: match[2] } : null;
}

export class FeeAllocationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = (message) => { throw new FeeAllocationError(400, "invalid-argument", message); };
const safeMinor = (value) => Number.isSafeInteger(value) && value >= 0;
const normalizedName = (name) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");

/** Validates one exact fee target; fixed amounts remain fixed across different tariffs. */
export function validateFeeAllocationRubrics(rubrics, feeAmountMinor) {
  if (!safeMinor(feeAmountMinor) || feeAmountMinor === 0) invalid("Tarif de référence invalide.");
  if (!Array.isArray(rubrics) || rubrics.length < 1 || rubrics.length > 40) invalid("Sélectionnez entre 1 et 40 rubriques personnalisées.");
  const names = new Set();
  const ids = new Set();
  let fixedMinor = 0n;
  let percentNumerator = 0n;
  const normalized = rubrics.map((input) => {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["id", "name", "mode", "basisPoints", "fixedMinor", "description"].includes(key))) invalid("Rubrique invalide.");
    if (typeof input.id !== "string" || !RUBRIC_ID.test(input.id) || ids.has(input.id)) invalid("Identifiant de rubrique invalide ou en double.");
    if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 80 || normalizedName(input.name) === normalizedName("Non affecté")) invalid("Nom de rubrique invalide ou réservé.");
    const name = normalizedName(input.name);
    if (names.has(name)) invalid("Deux rubriques portent le même nom.");
    if (input.description !== undefined && (typeof input.description !== "string" || input.description.length > 500)) invalid("Description de rubrique invalide.");
    ids.add(input.id); names.add(name);
    if (input.mode === "percent") {
      if (!Number.isInteger(input.basisPoints) || input.basisPoints <= 0 || input.basisPoints > 10000 || input.fixedMinor !== undefined) invalid("Pourcentage de rubrique invalide.");
      percentNumerator += BigInt(feeAmountMinor) * BigInt(input.basisPoints);
      return { id: input.id, name: input.name.trim(), mode: "percent", basisPoints: input.basisPoints, ...(input.description?.trim() ? { description: input.description.trim() } : {}) };
    }
    if (input.mode !== "fixed" || !safeMinor(input.fixedMinor) || input.fixedMinor === 0 || input.basisPoints !== undefined) invalid("Montant fixe de rubrique invalide.");
    fixedMinor += BigInt(input.fixedMinor);
    return { id: input.id, name: input.name.trim(), mode: "fixed", fixedMinor: input.fixedMinor, ...(input.description?.trim() ? { description: input.description.trim() } : {}) };
  });
  const denominator = 10000n;
  const total = BigInt(feeAmountMinor) * denominator;
  if (fixedMinor * denominator + percentNumerator > total) invalid("Les rubriques dépassent le tarif du frais.");
  const fractional = normalized.filter((item) => item.mode === "percent").map((item) => ({ id: item.id, numerator: BigInt(feeAmountMinor) * BigInt(item.basisPoints) }));
  fractional.push({ id: UNALLOCATED_RUBRIC_ID, numerator: total - fixedMinor * denominator - percentNumerator });
  const shares = normalized.filter((item) => item.mode === "fixed").map((item) => ({ rubricId: item.id, amountMinor: item.fixedMinor }));
  const rounded = fractional.map((item) => ({ rubricId: item.id, amountMinor: Number(item.numerator / denominator), remainder: item.numerator % denominator }));
  const remaining = feeAmountMinor - Number(fixedMinor) - rounded.reduce((sum, item) => sum + item.amountMinor, 0);
  rounded.sort((a, b) => a.remainder === b.remainder ? a.rubricId.localeCompare(b.rubricId) : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < remaining; index += 1) rounded[index].amountMinor += 1;
  shares.push(...rounded.map(({ rubricId, amountMinor }) => ({ rubricId, amountMinor })));
  shares.sort((a, b) => a.rubricId.localeCompare(b.rubricId));
  return { rubrics: normalized, shares, unallocatedMinor: shares.find((item) => item.rubricId === UNALLOCATED_RUBRIC_ID).amountMinor };
}

/** A proposal is never an approved or spendable opening balance. */
export function validateFeeAllocationOpeningProposal({ cutoffAt, cashAvailableMinor, justifiedSchoolFeeMinor, proposedOpeningMinor, evidence }) {
  if (typeof cutoffAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffAt)
    || Number.isNaN(Date.parse(`${cutoffAt}T00:00:00Z`))
    || new Date(`${cutoffAt}T00:00:00Z`).toISOString().slice(0, 10) !== cutoffAt) invalid("Date de coupure invalide.");
  if (![cashAvailableMinor, justifiedSchoolFeeMinor, proposedOpeningMinor].every(safeMinor) || !Array.isArray(evidence) || evidence.length > 500) invalid("Proposition de solde d'ouverture invalide.");
  if (proposedOpeningMinor > cashAvailableMinor || proposedOpeningMinor > justifiedSchoolFeeMinor) invalid("Le solde d'ouverture dépasse les fonds vérifiés.");
  if (proposedOpeningMinor > 0 && evidence.length === 0) invalid("Des références financières sont requises pour le solde d'ouverture.");
  const seen = new Set();
  for (const item of evidence) {
    if (!item || !["payments", "expenses"].includes(item.collection) || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(item.id)) invalid("Référence financière invalide.");
    const key = `${item.collection}/${item.id}`;
    if (seen.has(key)) invalid("Référence financière en double.");
    seen.add(key);
  }
  return { cutoffAt, proposedOpeningMinor, eligibleForReview: true, approved: false };
}

export function assertFeeAllocationMovement(movement) {
  if (!movement || !["payment", "expense"].includes(movement.sourceType) || !movement.sourceId || !movement.sourceRevision || !safeMinor(Math.abs(movement.amountMinor)) || !Array.isArray(movement.lines) || movement.lines.length === 0) invalid("Mouvement de répartition invalide.");
  if (!movement.lines.every((line) => line && typeof line.rubricId === "string" && (line.rubricId === UNALLOCATED_RUBRIC_ID || RUBRIC_ID.test(line.rubricId) || parseArrearsRubricKey(line.rubricId)) && Number.isSafeInteger(line.amountMinor))) invalid("Ligne de mouvement invalide.");
  // A movement already has one source/revision and one configuration version.
  // Its line key is therefore rubricId, including the reserved UNALLOCATED line.
  if (new Set(movement.lines.map((line) => line.rubricId)).size !== movement.lines.length) invalid("Une rubrique ne peut apparaître qu'une fois par mouvement.");
  if (movement.lines.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n) !== BigInt(movement.amountMinor)) invalid("Le mouvement ne conserve pas le montant source.");
  return movement;
}

/** Publication and operational activation are intentionally impossible in phase 1. */
export function assertFeeAllocationActivationBlocked() {
  throw new FeeAllocationError(409, "phase-not-ready", "La répartition ne peut pas être activée avant l'intégration du circuit financier complet.");
}

const cumulFail = (message) => { throw new FeeAllocationError(409, "allocation-reconciliation-required", message); };
const safeCount = (n) => Number.isSafeInteger(n) && n >= 0;
/** Monotone highest-averages apportionment, using exact BigInt comparisons.
 * Start at lower quotas, then assign at most k-1 units by w/(allocated+1).
 * Unlike largest remainders on successive partial receipts, this cannot take
 * a cent away from a rubric when the cumulative amount increases (Alabama
 * paradox). At the complete tariff, every fixed/percentage share is exact.
 */
export function allocateFeeReceiptCumulative(shares, totalMinor) {
  if (!Array.isArray(shares) || shares.length < 1 || shares.length > 41 || !safeCount(totalMinor)
    || shares.some(s => !s || !safeCount(s.amountMinor)) || new Set(shares.map(s => s.rubricId)).size !== shares.length) cumulFail("Poids de répartition invalides.");
  assertFeeAllocationMovement({ sourceType: "payment", sourceId: "validation", sourceRevision: "1", amountMinor: 0,
    lines: shares.map(s => ({ rubricId: s.rubricId, amountMinor: 0 })) });
  const denominator = shares.reduce((n, s) => n + BigInt(s.amountMinor), 0n);
  if (denominator <= 0n || denominator > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(totalMinor) > denominator) cumulFail("Cumul hors tarif ancré.");
  const rows = [...shares].sort((a, b) => a.rubricId < b.rubricId ? -1 : 1).map(s => ({ ...s, allocated: Number(BigInt(totalMinor) * BigInt(s.amountMinor) / denominator) }));
  let left = totalMinor - rows.reduce((n, s) => n + s.allocated, 0);
  while (left-- > 0) {
    let best = rows[0];
    for (const row of rows) if (BigInt(row.amountMinor) * BigInt(best.allocated + 1) > BigInt(best.amountMinor) * BigInt(row.allocated + 1)) best = row;
    best.allocated++;
  }
  return rows.map(s => ({ rubricId: s.rubricId, amountMinor: s.allocated }));
}


/** Lot 27c-4 : partie 2 « cas sociaux ». Vrai si la partie 2 reprend exactement la partie 1
 * (mêmes rubriques, uniquement des pourcentages identiques) : on garde alors les poids de la partie 1,
 * pour des montants identiques au centime près (recalculer sur le net créerait des écarts d'arrondi). */
export function sameAllocationRubrics(part1, part2) {
  if (!Array.isArray(part1) || !Array.isArray(part2) || part1.length !== part2.length) return false;
  return part1.every((rubric) => {
    const other = part2.find((item) => item?.id === rubric.id);
    return rubric.mode === "percent" && other?.mode === "percent" && other.basisPoints === rubric.basisPoints;
  });
}

/** Poids de la partie 2 pour un cas social qui doit netMinor (tarif moins sa réduction).
 * Règles : pourcentages appliqués au net ; montants fixes gardés ; « Non affecté » = reste du net ;
 * si l'ensemble dépasse le net, toutes les lignes sont réduites à proportion. */
export function socialCaseShares(part1Rubrics, part2Rubrics, grossMinor, netMinor) {
  const part1 = validateFeeAllocationRubrics(part1Rubrics, grossMinor);
  if (!part2Rubrics || sameAllocationRubrics(part1.rubrics, part2Rubrics)) return part1.shares;
  if (!safeMinor(netMinor) || netMinor > grossMinor) invalid("Montant net du cas social invalide.");
  const ids = new Set(part1.rubrics.map((rubric) => rubric.id));
  if (part2Rubrics.length !== ids.size || part2Rubrics.some((rubric) => !ids.has(rubric?.id))) invalid("La partie 2 doit reprendre les rubriques de la partie 1.");
  // Les noms viennent toujours de la partie 1 (mêmes rubriques).
  const part2 = validateFeeAllocationRubrics(part2Rubrics.map(({ id, mode, basisPoints, fixedMinor }) => ({ id, name: part1.rubrics.find((r) => r.id === id).name, mode,
    ...(mode === "fixed" ? { fixedMinor } : { basisPoints }) })), grossMinor).rubrics;
  if (netMinor === 0) return part1.shares.map((share) => ({ rubricId: share.rubricId, amountMinor: 0 }));
  const scale = 10000n;
  const raw = part2.map((rubric) => ({ rubricId: rubric.id, weight: rubric.mode === "fixed" ? BigInt(rubric.fixedMinor) * scale : BigInt(netMinor) * BigInt(rubric.basisPoints) }));
  const needed = raw.reduce((sum, item) => sum + item.weight, 0n);
  if (needed <= BigInt(netMinor) * scale) {
    const shares = validateFeeAllocationRubrics(part2, netMinor).shares;
    return shares;
  }
  // Plus que le net : réduction à proportion de chaque ligne, « Non affecté » à zéro.
  // Poids non simplifiés : leur somme dépasse toujours le net, condition du partage cumulatif.
  const weights = raw.map((item) => ({ rubricId: item.rubricId, amountMinor: Number(item.weight) }));
  if (weights.some((item) => !Number.isSafeInteger(item.amountMinor))) invalid("Partie 2 hors limites.");
  const positive = weights.filter((item) => item.amountMinor > 0);
  const reduced = allocateFeeReceiptCumulative(positive, netMinor);
  return [...part1.shares.map((share) => ({ rubricId: share.rubricId, amountMinor: reduced.find((item) => item.rubricId === share.rubricId)?.amountMinor ?? 0 }))]
    .sort((a, b) => a.rubricId.localeCompare(b.rubricId));
}

/** Répartition cumulée d'un cas social : jusqu'à son net, selon la partie 2 ; au-delà (sa réduction a
 * été diminuée après le premier paiement), selon la partie 1. Toujours croissante, ligne par ligne. */
export function socialCumulativeLines(part1Shares, socialShares, socialNetMinor, totalMinor) {
  if (!safeCount(totalMinor) || !safeCount(socialNetMinor)) cumulFail("Cumul de cas social invalide.");
  const low = Math.min(totalMinor, socialNetMinor), high = totalMinor - low;
  const first = low > 0 ? allocateFeeReceiptCumulative(socialShares.filter((share) => share.amountMinor > 0), low) : [];
  const second = high > 0 ? allocateFeeReceiptCumulative(part1Shares, high) : [];
  const ids = [...new Set([...part1Shares, ...socialShares].map((share) => share.rubricId))].sort((a, b) => a < b ? -1 : 1);
  return ids.map((rubricId) => ({ rubricId, amountMinor: (first.find((s) => s.rubricId === rubricId)?.amountMinor ?? 0) + (second.find((s) => s.rubricId === rubricId)?.amountMinor ?? 0) }));
}
