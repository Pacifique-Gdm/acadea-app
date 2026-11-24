// Lot E du caissier : plan de rattachement des paiements de l'année lors d'un changement de classe.
// Calcul pur (aucune lecture ni écriture) : le serveur le refait dans sa transaction, l'écran l'affiche en aperçu.
// Montants en unités mineures (centimes).

const sameName = (a, b) => String(a ?? "").trim().toLocaleLowerCase("fr") === String(b ?? "").trim().toLocaleLowerCase("fr");
const safe = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * @param {object} input
 * @param {{ id: string, feeTypeId: string, amountMinor: number, createdAt?: string }[]} input.payments paiements de l'année de l'élève (hors arriérés)
 * @param {{ id: string, name: string }[]} input.oldFees frais de l'année (pour retrouver le nom du frais d'origine)
 * @param {{ id: string, name: string, netMinor: number }[]} input.newFees frais de la nouvelle classe, dans l'ordre d'affichage
 * @returns {{ stays: string[], moves: { paymentId: string, fromFeeTypeId: string, pieces: { feeTypeId: string, amountMinor: number }[], overpaidMinor: number }[], overpaidMinor: number }}
 */
export function planClassChangePayments({ payments, oldFees, newFees }) {
  if (!Array.isArray(payments) || !Array.isArray(oldFees) || !Array.isArray(newFees)) throw new Error("Plan de changement de classe invalide.");
  for (const fee of newFees) if (!fee?.id || !safe(fee.netMinor)) throw new Error("Frais de la nouvelle classe invalide.");
  for (const payment of payments) if (!payment?.id || !payment.feeTypeId || !safe(payment.amountMinor)) throw new Error("Paiement invalide.");
  const newIds = new Set(newFees.map((fee) => fee.id));
  const capacity = new Map(newFees.map((fee) => [fee.id, fee.netMinor]));
  const stays = [];
  // 1. Les paiements déjà sur un frais de la nouvelle classe (frais commun à toutes les classes) ne bougent pas.
  for (const payment of payments) {
    if (!newIds.has(payment.feeTypeId)) continue;
    stays.push(payment.id);
    capacity.set(payment.feeTypeId, Math.max(0, capacity.get(payment.feeTypeId) - payment.amountMinor));
  }
  const nameOf = new Map(oldFees.map((fee) => [fee.id, fee.name]));
  const ordered = payments.filter((payment) => !newIds.has(payment.feeTypeId))
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.id.localeCompare(b.id));
  const moves = [];
  let overpaidMinor = 0;
  for (const payment of ordered) {
    let left = payment.amountMinor;
    const pieces = [];
    const take = (feeTypeId) => {
      const amount = Math.min(left, capacity.get(feeTypeId));
      if (amount <= 0) return;
      capacity.set(feeTypeId, capacity.get(feeTypeId) - amount);
      left -= amount;
      const existing = pieces.find((piece) => piece.feeTypeId === feeTypeId);
      if (existing) existing.amountMinor += amount; else pieces.push({ feeTypeId, amountMinor: amount });
    };
    // 2. D'abord le frais de même nom (Minerval → Minerval), 3. puis les autres frais impayés, dans l'ordre d'affichage.
    for (const fee of newFees) if (sameName(fee.name, nameOf.get(payment.feeTypeId))) take(fee.id);
    for (const fee of newFees) take(fee.id);
    // 4. Ce qui reste est le trop-perçu.
    overpaidMinor += left;
    moves.push({ paymentId: payment.id, fromFeeTypeId: payment.feeTypeId, pieces, overpaidMinor: left });
  }
  return { stays, moves, overpaidMinor };
}
