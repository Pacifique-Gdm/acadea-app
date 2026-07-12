import type { DisciplineStats } from "../../utils/disciplineStats";

type DisciplineStatisticsProps = {
  stats: DisciplineStats;
};

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xl font-bold text-ink">{value}</p>
    </div>
  );
}

export function DisciplineStatistics({ stats }: DisciplineStatisticsProps) {
  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Total sanctions" value={stats.total} />
        <MetricCard label="En cours" value={stats.active} />
        <MetricCard label="Purgées" value={stats.completed} />
        <MetricCard label="Élèves sanctionnés" value={stats.sanctionedStudents} />
        <MetricCard label="Récidives" value={stats.recurrences} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-ink">Répartition par type</h3>
          <div className="mt-3 grid gap-2">
            {stats.byType.length === 0 && <p className="text-sm text-slate-500">Aucune donnée.</p>}
            {stats.byType.map((row) => (
              <div key={row.type} className="flex items-center justify-between gap-3 rounded bg-slate-50 p-2 text-sm">
                <span className="break-words font-semibold text-slate-700">{row.type}</span>
                <span className="font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded border border-slate-200 bg-white p-4">
          <h3 className="font-bold text-ink">Répartition par classe</h3>
          <div className="mt-3 grid gap-2">
            {stats.byClass.length === 0 && <p className="text-sm text-slate-500">Aucune donnée.</p>}
            {stats.byClass.map((row) => (
              <div key={row.className} className="flex items-center justify-between gap-3 rounded bg-slate-50 p-2 text-sm">
                <span className="break-words font-semibold text-slate-700">{row.className}</span>
                <span className="font-bold text-ink">{row.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
