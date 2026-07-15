export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-slate-50 p-2">
      <p className="break-words text-xs text-slate-500">{label}</p>
      <p className="break-words font-bold text-ink">{value}</p>
    </div>
  );
}
