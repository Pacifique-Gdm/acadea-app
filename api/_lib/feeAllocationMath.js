const RUBRIC_ID = /^[a-f0-9]{32}$/;
export const UNALLOCATED_RUBRIC_ID = "UNALLOCATED";

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
  if (!movement.lines.every((line) => line && typeof line.rubricId === "string" && (line.rubricId === UNALLOCATED_RUBRIC_ID || RUBRIC_ID.test(line.rubricId)) && Number.isSafeInteger(line.amountMinor))) invalid("Ligne de mouvement invalide.");
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
