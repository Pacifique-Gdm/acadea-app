import { formatCurrencyMoney, type SchoolCurrency } from "../../utils/currency";

type ArrearsTotals = { USD: number; CDF: number };

export function DashboardArrearsValue({ totals, error, currency, currencies }: {
  totals?: ArrearsTotals;
  error?: string;
  currency?: SchoolCurrency;
  currencies?: readonly SchoolCurrency[];
}) {
  if (error) return <span role="alert" className="text-sm text-red-700">Arriérés indisponibles : {error}</span>;
  if (!totals) return <span role="status" className="text-sm">Chargement des arriérés…</span>;
  const visibleCurrencies = currencies ?? (["USD", "CDF"] as const).filter((item) => !currency || currency === item || totals[item] > 0);
  if (!visibleCurrencies.length) return <span className="text-sm text-slate-500">Aucune devise financière applicable.</span>;
  return <span className="grid gap-1 text-xl" title="Dettes des années antérieures, calculées par le service financier officiel">{visibleCurrencies.map((item) => <span key={item}>{formatCurrencyMoney(totals[item], item)}</span>)}</span>;
}
