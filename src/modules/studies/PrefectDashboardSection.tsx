import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarX2, ClipboardList, NotebookPen, TrendingDown, UserCheck, UsersRound } from "lucide-react";
import { DashboardCard, ErrorNotice } from "../../components/ui";
import { readStaffChildrenRefresh, subscribeStaffChildrenRefresh } from "../../services/staffChildren";
import { DashboardCardButton } from "../advisors/DashboardCardButton";
import { useAdvisorData, type ClassVisit, type OrientationNote } from "../advisors/advisorService";
import { cachedPrefectDashboard, loadPrefectDashboard, prefectDashboardNeedsLoad, type PrefectDashboard } from "./prefectDashboard";

// Lot P1 : « Pilotage de mes sections », affiché seulement pour le Préfet d'études.
// Pas de bouton « Actualiser » : la flèche ronde de l'en-tête recharge (même signal que « Enfants »).
// Lot H : 2 cartes de plus (fiches de visite et notes de suivi de ses sections, mêmes lectures que les rubriques du Menu),
// pour 6 cartes en 2 lignes de 3 sur ordinateur ; 2 par ligne sur téléphone comme avant.
export function PrefectDashboardSection({ uid, schoolId, schoolYearId, onOpenClassVisits, onOpenOrientationNotes }: { uid: string; schoolId: string; schoolYearId: string; onOpenClassVisits: () => void; onOpenOrientationNotes: () => void }) {
  const headerRefresh = useSyncExternalStore(subscribeStaffChildrenRefresh, readStaffChildrenRefresh);
  const [dashboard, setDashboard] = useState<PrefectDashboard | undefined>(() => cachedPrefectDashboard(uid, schoolId, schoolYearId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);
  const scope = { uid, schoolId, schoolYearId };
  const visits = useAdvisorData<{ visits: ClassVisit[] }>("class-visits-list", scope);
  const notes = useAdvisorData<{ notes: OrientationNote[] }>("orientation-notes-list", scope);

  useEffect(() => {
    const cached = cachedPrefectDashboard(uid, schoolId, schoolYearId);
    if (cached && !prefectDashboardNeedsLoad(uid, schoolId, schoolYearId, headerRefresh)) { setDashboard(cached); return undefined; }
    let active = true;
    setLoading(true);
    setError(null);
    loadPrefectDashboard(uid, schoolId, schoolYearId, { force: true, headerRefresh })
      .then((value) => { if (active) setDashboard(value); })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, schoolId, schoolYearId, headerRefresh, retry]);

  const presence = dashboard?.presence, difficulty = dashboard?.difficulty, absences = dashboard?.approvedAbsences;
  return <section aria-label="Pilotage de mes sections" className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="text-base font-bold text-ink">Pilotage de mes sections</h2>
    <ErrorNotice error={error} fallback="Tableau de pilotage indisponible." onRetry={() => setRetry((value) => value + 1)} />
    {!dashboard && loading && <p className="text-sm text-slate-500">Chargement du tableau de pilotage…</p>}
    {dashboard && <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
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
      <DashboardCardButton title="Fiches de visite" value={visits.value?.visits.length ?? "—"} icon={ClipboardList} tone="bg-teal-50 text-teal-700" onClick={onOpenClassVisits}>
        <p className="text-xs text-slate-500">{visits.error ? "Indisponible pour le moment" : "des conseillers pédagogiques · cette année"}</p>
      </DashboardCardButton>
      <DashboardCardButton title="Notes de suivi (orientation)" value={notes.value?.notes.length ?? "—"} icon={NotebookPen} tone="bg-fuchsia-50 text-fuchsia-700" onClick={onOpenOrientationNotes}>
        <p className="text-xs text-slate-500">{notes.error ? "Indisponible pour le moment" : "des conseillers d'orientation · cette année"}</p>
      </DashboardCardButton>
    </div>}
  </section>;
}
