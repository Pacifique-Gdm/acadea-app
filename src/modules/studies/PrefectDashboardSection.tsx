import { useEffect, useState } from "react";
import { CalendarX2, RefreshCw, TrendingDown, UserCheck, UsersRound } from "lucide-react";
import { DashboardCard, ErrorNotice } from "../../components/ui";
import { cachedPrefectDashboard, loadPrefectDashboard, type PrefectDashboard } from "./prefectDashboard";

// Lot P1 : « Pilotage de mes sections », affiché seulement pour le Préfet d'études.
export function PrefectDashboardSection({ uid, schoolId, schoolYearId }: { uid: string; schoolId: string; schoolYearId: string }) {
  const [dashboard, setDashboard] = useState<PrefectDashboard | undefined>(() => cachedPrefectDashboard(uid, schoolId, schoolYearId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = (force: boolean) => {
    setLoading(true);
    setError(null);
    loadPrefectDashboard(uid, schoolId, schoolYearId, { force })
      .then(setDashboard)
      .catch((reason: unknown) => setError(reason))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!cachedPrefectDashboard(uid, schoolId, schoolYearId)) refresh(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, schoolId, schoolYearId]);

  const presence = dashboard?.presence, difficulty = dashboard?.difficulty, absences = dashboard?.approvedAbsences;
  return <section aria-label="Pilotage de mes sections" className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-base font-bold text-ink">Pilotage de mes sections</h2>
      <button type="button" onClick={() => refresh(true)} disabled={loading} className="inline-flex items-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-600">
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Actualiser
      </button>
    </div>
    <ErrorNotice error={error} fallback="Tableau de pilotage indisponible." onRetry={() => refresh(true)} />
    {!dashboard && loading && <p className="text-sm text-slate-500">Chargement du tableau de pilotage…</p>}
    {dashboard && <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <DashboardCard title="Effectifs" value={dashboard.enrollment.students} icon={UsersRound}>
        <p className="text-xs text-slate-500">élèves · {dashboard.enrollment.classes} classe{dashboard.enrollment.classes > 1 ? "s" : ""}</p>
      </DashboardCard>
      <DashboardCard title="Présence aujourd'hui" value={presence?.rate === null || presence?.rate === undefined ? "—" : `${presence.rate} %`} icon={UserCheck} tone="bg-emerald-50 text-emerald-700">
        <p className="text-xs text-slate-500">{presence && presence.recorded ? `${presence.absent} absent${presence.absent > 1 ? "s" : ""} sur ${presence.recorded} élèves pointés` : "Aucune présence enregistrée aujourd'hui"}</p>
      </DashboardCard>
      <DashboardCard title="Élèves en difficulté" value={difficulty?.slot ? difficulty.count : "—"} icon={TrendingDown} tone="bg-amber-50 text-amber-700">
        <p className="text-xs text-slate-500">{difficulty?.slot ? `moyenne < ${difficulty.threshold} % (${difficulty.slotLabel}) · ${difficulty.evaluated} élèves évalués` : "Aucune période complète pour le moment"}</p>
      </DashboardCard>
      <DashboardCard title="Absences approuvées aujourd'hui" value={absences?.count ?? 0} icon={CalendarX2} tone="bg-red-50 text-red-700">
        {absences && absences.items.length > 0
          ? <ul className="grid gap-1 text-xs text-slate-600">{absences.items.map((item, index) => <li key={`${item.teacherName}-${index}`}>{item.teacherName} · {item.requestType === "TIME_RANGE" ? `${item.startTime} – ${item.endTime}` : "journée entière"}</li>)}</ul>
          : <p className="text-xs text-slate-500">Indisponibilités d'enseignants approuvées pour aujourd'hui</p>}
      </DashboardCard>
    </div>}
  </section>;
}
