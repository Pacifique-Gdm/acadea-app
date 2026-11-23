import { toMoneyMinor } from "../../utils/money";

/** Lot « 3 étapes » : calcul affiché à l'étape « Valider le solde de départ ».
 * - « Non affecté » reçoit automatiquement le reste (fonds scolaires − rubriques) ; il est négatif seulement s'il y a un déficit.
 * - L'écart de caisse = caisse comptée − caisse attendue ; il ira dans « Non affecté » (le serveur l'ajoute à l'activation).
 * Le serveur refait tous ces contrôles : ce calcul sert seulement à guider l'Administrateur. */
export type OpeningPlan = {
  lines: Array<{ rubricId: string; amountMinor: number }>;
  rubricTotalMinor: number;
  unallocatedMinor: number;
  cashCountMinor: number | null;
  cashGapMinor: number | null;
  deficit: boolean;
  needsDeficitReason: boolean;
  needsCashGapReason: boolean;
  needsUnallocatedReason: boolean;
  error: string | null;
};

const AMOUNT = /^\d+(?:[.,]\d{1,2})?$/;
export const parseOpeningAmount = (value: string): number | null => {
  const text = value.trim();
  if (!text) return 0;
  return AMOUNT.test(text) ? toMoneyMinor(Number(text.replace(",", "."))) : null;
};

export function openingPlan(input: { rubricIds: string[]; amounts: Record<string, string>; schoolAvailableMinor: number; cashExpectedMinor: number; cash: string }): OpeningPlan {
  const deficit = input.schoolAvailableMinor < 0;
  let error: string | null = null;
  const lines: OpeningPlan["lines"] = [];
  for (const rubricId of input.rubricIds) {
    const amount = deficit ? 0 : parseOpeningAmount(input.amounts[rubricId] ?? "");
    if (amount === null) { error = "Indiquez des montants positifs, avec deux décimales au plus."; continue; }
    if (amount > 0) lines.push({ rubricId, amountMinor: amount });
  }
  const rubricTotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const unallocatedMinor = input.schoolAvailableMinor - rubricTotalMinor;
  if (!error && unallocatedMinor < Math.min(0, input.schoolAvailableMinor)) error = "Les rubriques reçoivent plus que les fonds scolaires justifiés : baissez un montant.";
  const cashCountMinor = input.cash.trim() ? parseOpeningAmount(input.cash) : null;
  if (input.cash.trim() && cashCountMinor === null && !error) error = "Indiquez la caisse comptée avec deux décimales au plus.";
  const cashGapMinor = cashCountMinor === null ? null : cashCountMinor - input.cashExpectedMinor;
  if (unallocatedMinor !== 0 || !lines.length) lines.push({ rubricId: "UNALLOCATED", amountMinor: unallocatedMinor });
  return { lines, rubricTotalMinor, unallocatedMinor, cashCountMinor, cashGapMinor, deficit,
    needsDeficitReason: deficit, needsCashGapReason: cashGapMinor !== null && cashGapMinor !== 0, needsUnallocatedReason: unallocatedMinor > 0, error };
}

export const reasonReady = (value: string) => value.trim().length >= 10 && value.length <= 500;
