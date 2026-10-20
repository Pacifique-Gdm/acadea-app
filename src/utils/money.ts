/** Acadéa stores USD and CDF amounts as Firestore numbers with two decimal places.
 * Calculations use integer hundredths; only the final boundary converts to a number.
 * The tiny tolerance below accepts binary representations of valid hundredths, never
 * a different cent (notably a real 0.01 balance).
 */
export const MONEY_SCALE = 100;

export function toMoneyMinor(value: number): number {
  const scaled = value * MONEY_SCALE;
  const minor = Math.round(scaled);
  // Multiplication itself can drift by several ULPs near the existing API cap
  // of 1 billion. The tolerance remains far below one hundredth of a minor unit.
  const binaryTolerance = Math.min(1e-4, Math.max(1e-7, Number.EPSILON * Math.abs(scaled) * 4));
  if (!Number.isFinite(value) || !Number.isSafeInteger(minor) || Math.abs(scaled - minor) > binaryTolerance) {
    throw new Error("Montant invalide ou précision supérieure à deux décimales.");
  }
  return minor;
}

export function fromMoneyMinor(minor: number): number {
  if (!Number.isSafeInteger(minor)) throw new Error("Montant en unités mineures invalide.");
  return minor / MONEY_SCALE;
}

export function sumMoney(values: readonly number[]): number {
  return fromMoneyMinor(values.reduce((sum, value) => {
    const next = sum + toMoneyMinor(value);
    if (!Number.isSafeInteger(next)) throw new Error("Total financier trop élevé.");
    return next;
  }, 0));
}

export function remainingMoney(expected: number, paid: number, discount = 0): number {
  return fromMoneyMinor(Math.max(0, toMoneyMinor(expected) - toMoneyMinor(paid) - toMoneyMinor(discount)));
}
