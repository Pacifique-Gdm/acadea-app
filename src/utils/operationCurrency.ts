import { formatCurrencyMoney, type SchoolCurrency } from "./currency";

type MonetaryOperation = { amount: number; currency?: SchoolCurrency };

export function totalsByRecordedCurrency(operations: readonly MonetaryOperation[]) {
  const totals = { CDF: 0, USD: 0, unknownCount: 0 };
  for (const operation of operations) {
    if (operation.currency === "CDF" || operation.currency === "USD") totals[operation.currency] += operation.amount;
    else totals.unknownCount++;
  }
  return totals;
}

export function formatRecordedTotals(totals: ReturnType<typeof totalsByRecordedCurrency>, emptyCurrency: SchoolCurrency) {
  const parts = (["CDF", "USD"] as const).filter((currency) => totals[currency] !== 0)
    .map((currency) => formatCurrencyMoney(totals[currency], currency));
  return parts.join(" / ") || formatCurrencyMoney(0, emptyCurrency);
}

export function formatRecordedOperation(operation: MonetaryOperation) {
  return operation.currency === "CDF" || operation.currency === "USD"
    ? formatCurrencyMoney(operation.amount, operation.currency)
    : "Devise historique inconnue";
}
