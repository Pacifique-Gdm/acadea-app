// Keep Firestore's numeric schema; calculate with integer hundredths for USD/CDF.
export function toMoneyMinor(value) {
  const scaled = value * 100;
  const minor = Math.round(scaled);
  const binaryTolerance = Math.min(1e-4, Math.max(1e-7, Number.EPSILON * Math.abs(scaled) * 4));
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(minor) || Math.abs(scaled - minor) > binaryTolerance) {
    throw new Error("Montant invalide ou précision supérieure à deux décimales.");
  }
  return minor;
}

export function fromMoneyMinor(minor) {
  if (!Number.isSafeInteger(minor)) throw new Error("Montant en unités mineures invalide.");
  return minor / 100;
}

export function sumMoneyMinor(values) {
  return values.reduce((total, value) => {
    const next = total + toMoneyMinor(value);
    if (!Number.isSafeInteger(next)) throw new Error("Total financier trop élevé.");
    return next;
  }, 0);
}
