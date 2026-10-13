import { createHash } from "node:crypto";

export class CashBalanceError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.name = "CashBalanceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function moneyCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))
    || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) {
    throw new CashBalanceError(409, "cash-balance-inconsistent", "Solde de caisse incohérent : paiement bloqué.");
  }
  return Math.round(amount * 100);
}

function documentCurrency(data, fallback) {
  if (data.currency === "CDF" || data.currency === "USD") return data.currency;
  if (data.currency !== undefined && data.currency !== null && data.currency !== "") {
    throw new CashBalanceError(409, "cash-balance-inconsistent", "Devise financière incohérente : paiement bloqué.");
  }
  if (!fallback) throw new CashBalanceError(409, "cash-balance-inconsistent", "Devise d'un encaissement historique inconnue : paiement bloqué.");
  return fallback;
}

function cashQueries(db, { schoolId, schoolYearId }) {
  return [
    db.collection("payments").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId),
    db.collection("payments").where("schoolId", "==", schoolId).where("collectionSchoolYearId", "==", schoolYearId),
    db.collection("expenses").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId),
  ];
}

// Same annual sources as the school financial report, plus arrears collected in
// the active year. An arrears receipt is counted once, in its own currency.
export async function readCashBalance({ db, reader, schoolId, schoolYearId, currency, yearCurrency }) {
  if (!schoolId || !schoolYearId || !["CDF", "USD"].includes(currency) || !["CDF", "USD"].includes(yearCurrency)) {
    throw new CashBalanceError(409, "cash-balance-unavailable", "Caisse ou devise indisponible : paiement bloqué.");
  }
  try {
    const snapshots = await Promise.all(cashQueries(db, { schoolId, schoolYearId }).map((query) => reader ? reader.get(query) : query.get()));
    const payments = new Map([...snapshots[0].docs, ...snapshots[1].docs].map((document) => [document.id, document]));
    let receivedCents = 0;
    for (const document of payments.values()) {
      const data = document.data();
      const collectedHere = data.collectionSchoolYearId === schoolYearId;
      const annualHere = data.schoolYearId === schoolYearId && !data.collectionSchoolYearId;
      if (data.schoolId !== schoolId || !collectedHere && !annualHere) continue;
      if (documentCurrency(data, collectedHere && data.schoolYearId !== schoolYearId ? null : yearCurrency) === currency) receivedCents += moneyCents(data.amount);
    }
    let spentCents = 0;
    for (const document of snapshots[2].docs) {
      const data = document.data();
      if (data.schoolId !== schoolId || data.schoolYearId !== schoolYearId) continue;
      if (documentCurrency(data, yearCurrency) === currency) spentCents += moneyCents(data.amount);
    }
    if (!Number.isSafeInteger(receivedCents) || !Number.isSafeInteger(spentCents)) throw new CashBalanceError(409, "cash-balance-inconsistent", "Solde de caisse incohérent : paiement bloqué.");
    return { schoolId, schoolYearId, currency, availableCents: receivedCents - spentCents, receivedCents, spentCents };
  } catch (error) {
    if (error instanceof CashBalanceError) throw error;
    throw new CashBalanceError(503, "cash-balance-unavailable", "Solde de caisse indisponible : paiement bloqué.");
  }
}

export async function protectCashMutation({ db, transaction, schoolId, schoolYearId, currency, yearCurrency, deltaCents, now }) {
  if (!Number.isSafeInteger(deltaCents)) throw new CashBalanceError(409, "cash-balance-inconsistent", "Variation financière incohérente : opération bloquée.");
  const lockId = createHash("sha256").update(`${schoolId}:${schoolYearId}:${currency}`).digest("hex");
  const lockRef = db.doc(`financialCashLocks/${lockId}`);
  await transaction.get(lockRef);
  const balance = await readCashBalance({ db, reader: transaction, schoolId, schoolYearId, currency, yearCurrency });
  if (deltaCents < 0 && balance.availableCents < 0) {
    throw new CashBalanceError(409, "cash-balance-inconsistent", "Solde de caisse déjà négatif : aucun nouveau décaissement autorisé.", { ...balance, requestedCents: -deltaCents });
  }
  if (deltaCents < 0 && balance.availableCents < -deltaCents) {
    throw new CashBalanceError(409, "insufficient-funds", "Paiement impossible : solde de caisse insuffisant.", {
      ...balance, requestedCents: -deltaCents, shortfallCents: -deltaCents - balance.availableCents,
    });
  }
  transaction.set(lockRef, { schoolId, schoolYearId, currency, updatedAt: now }, { merge: true });
  return balance;
}
