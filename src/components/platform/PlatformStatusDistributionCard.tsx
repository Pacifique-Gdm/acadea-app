import type { PlatformStatusChartItem } from "../../utils/platformStatusDistribution";

export function PlatformStatusDistributionCard({ title, description, total, totalLabel, items }: {
  title: string;
  description: string;
  total: number;
  totalLabel: string;
  items: PlatformStatusChartItem[];
}) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  return <div className="min-w-0 max-w-full rounded border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="break-words font-bold text-ink">{title}</h2>
        <p className="break-words text-sm text-slate-500">{description}</p>
      </div>
      <span className="w-fit shrink-0 rounded bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{total} {totalLabel}</span>
    </div>
    <div className="mt-5 grid min-w-0 gap-3">
      {items.map((item) => <div key={item.label} className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
          <span className="min-w-0 break-words font-semibold text-slate-700">{item.label}</span>
          <span className={`shrink-0 font-bold ${item.textClassName}`}>{item.value}</span>
        </div>
        <div className="h-3 max-w-full overflow-hidden rounded-full bg-slate-100">
          <div className={`h-full rounded-full ${item.className}`} style={{ width: item.value === 0 ? "0%" : `${Math.max(4, (item.value / maximum) * 100)}%` }} />
        </div>
      </div>)}
    </div>
  </div>;
}
