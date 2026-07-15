export function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 min-w-0">
      <h1 className="break-words text-2xl font-bold text-ink">{title}</h1>
      <p className="break-words text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}
