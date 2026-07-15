export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words font-semibold text-ink">{value}</p>
    </div>
  );
}
