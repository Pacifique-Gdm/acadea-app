import { toMoneyMinor, fromMoneyMinor } from "./money.js";

const recordedMinor = (value) =>
  toMoneyMinor(
    typeof value === "string" && /^\d+(?:\.\d{1,2})?$/.test(value)
      ? Number(value)
      : value,
  );

/** Financial projection contains no administrative reason or observation. */
export function supportBalance(student, fee, payments = []) {
  const official = recordedMinor(fee.amount);
  const entries = Object.values(student?.financialSupport ?? {}).filter(
    (item) => item.schoolYearId === fee.schoolYearId,
  );
  const reduction = entries.reduce(
    (sum, item) => sum + (item.lines?.[fee.id]?.reductionMinor ?? 0),
    0,
  );
  const commitments = entries.flatMap((item) =>
    Object.entries(item.lines ?? {})
      .filter(([id]) => id === fee.id)
      .map(([, line]) => ({
        decisionId: item.id,
        name: item.thirdPartyName ?? "",
        amount: line.commitmentMinor ?? 0,
      })),
  );
  const relevant = payments.filter(
    (p) =>
      p.studentId === student.id &&
      p.feeTypeId === fee.id &&
      p.schoolYearId === fee.schoolYearId,
  );
  const paid = relevant.reduce((sum, p) => sum + recordedMinor(p.amount), 0);
  const thirdPaid = relevant
    .filter((p) => p.supportDecisionId)
    .reduce((sum, p) => sum + recordedMinor(p.amount), 0);
  const promised = commitments.reduce((sum, c) => sum + c.amount, 0);
  const thirdRemaining = commitments.reduce(
    (sum, c) =>
      sum +
      Math.max(
        0,
        c.amount -
          relevant
            .filter((p) => p.supportDecisionId === c.decisionId)
            .reduce((s, p) => s + recordedMinor(p.amount), 0),
      ),
    0,
  );
  if (
    ![official, reduction, paid, promised, thirdPaid, thirdRemaining].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    reduction > official
  )
    throw new Error("Projection financière incohérente.");
  const net = Math.max(0, official - reduction);
  return {
    official: fromMoneyMinor(official),
    reduction: fromMoneyMinor(reduction),
    net: fromMoneyMinor(net),
    paid: fromMoneyMinor(paid),
    remaining: fromMoneyMinor(Math.max(0, net - paid)),
    credit: fromMoneyMinor(Math.max(0, paid - net)),
    commitment: fromMoneyMinor(promised),
    thirdPaid: fromMoneyMinor(thirdPaid),
    thirdRemaining: fromMoneyMinor(thirdRemaining),
    studentRemaining: fromMoneyMinor(Math.max(0, net - paid - thirdRemaining)),
    commitments,
  };
}

export function supportAmount(nature, value, eligibleMinor) {
  if (!Number.isSafeInteger(eligibleMinor) || eligibleMinor < 0)
    throw new Error("Plafond financier invalide.");
  if (nature === "full") return eligibleMinor;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Montant invalide.");
  if (nature === "percent") {
    if (!Number.isInteger(value) || value > 100)
      throw new Error("Le pourcentage doit être un entier entre 0 et 100.");
    return Number((BigInt(eligibleMinor) * BigInt(value) + 50n) / 100n);
  }
  if (nature !== "fixed") throw new Error("Nature invalide.");
  const minor = toMoneyMinor(value);
  if (minor > eligibleMinor)
    throw new Error("Le montant dépasse le plafond disponible.");
  return minor;
}

/** Additional school reduction may only use the outstanding student share. */
export function supportReductionCeiling(balance) {
  return Math.max(0, Math.min(toMoneyMinor(balance.net - balance.commitment), toMoneyMinor(balance.studentRemaining)));
}

export function supportCeilingMessage(ceilingMinor, currency) {
  if (currency !== 'USD' && currency !== 'CDF') throw new Error('Devise invalide.');
  return `Réduction non autorisée. Le montant demandé dépasse le plafond applicable à ce frais. Le montant maximal pouvant être accordé est de ${fromMoneyMinor(ceilingMinor).toFixed(2)} ${currency}, compte tenu des réductions et des paiements déjà enregistrés. Veuillez ajuster le montant pour poursuivre.`;
}
