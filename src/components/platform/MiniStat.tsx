export function MiniStat({ label, value, compact }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <div className={`rounded bg-slate-50 ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`${compact ? "text-lg" : "text-2xl"} mt-1 font-bold text-ink`}>{value}</p>
    </div>
  );
}
