import { formatCurrencyMoney, type SchoolCurrency } from "../../utils/currency";

export function DashboardArrearsValue({ totals, error, currency }: { totals?: { USD: number; CDF: number }; error?: string; currency?: SchoolCurrency }) {
  if (error) return <span role="alert" className="text-sm text-red-700">Arriérés indisponibles : {error}</span>;
  if (!totals) return <span role="status" className="text-sm">Chargement des arriérés…</span>;
  const currencies = (["USD", "CDF"] as const).filter((item) => !currency || currency === item || totals[item] > 0);
  return <span className="grid gap-1 text-xl" title="Dettes des années antérieures, calculées par le service financier officiel">{currencies.map((item) => <span key={item}>{item} : {formatCurrencyMoney(totals[item], item)}</span>)}</span>;
}
