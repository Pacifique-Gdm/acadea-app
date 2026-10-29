import type { SchoolCurrency } from "./currency";

const usdStep = 1500;
const cdfStep = 1_500_000;

export function transactionChartAxis(rows: { payments: number; expenses: number }[], currency: SchoolCurrency) {
  const step = currency === "CDF" ? cdfStep : usdStep;
  const highest = Math.max(1, ...rows.map((row) => Math.max(row.payments, row.expenses)));
  const max = Math.max(step, Math.ceil(highest / step) * step);
  const ticks = Array.from({ length: max / step + 1 }, (_, index) => index * step);
  return { max, ticks };
}

export function formatTransactionAxisTick(value: number, currency: SchoolCurrency) {
  const amount = new Intl.NumberFormat("fr-FR").format(value);
  return currency === "CDF" ? `${amount} FC` : amount;
}
