import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorNotice } from "../../components/ui";
import { readStaffChildrenRefresh, subscribeStaffChildrenRefresh } from "../../services/staffChildren";
import { cachedPrefectDiscipline, loadPrefectDiscipline, prefectDisciplineNeedsLoad, type PrefectSanction } from "./prefectDiscipline";

const formatDate = (value: string) => /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;

// Lot P2 : contenu du drawer « Discipline » du Préfet d'études. Lecture seule : aucun bouton de modification.
export function PrefectDisciplineContent({ uid, schoolId, schoolYearId }: { uid: string; schoolId: string; schoolYearId: string }) {
  const headerRefresh = useSyncExternalStore(subscribeStaffChildrenRefresh, readStaffChildrenRefresh);
  const [sanctions, setSanctions] = useState<PrefectSanction[] | undefined>(() => cachedPrefectDiscipline(uid, schoolId, schoolYearId));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const cached = cachedPrefectDiscipline(uid, schoolId, schoolYearId);
    if (cached && !prefectDisciplineNeedsLoad(uid, schoolId, schoolYearId, headerRefresh)) { setSanctions(cached); return undefined; }
    let active = true;
    setLoading(true);
    setError(null);
    loadPrefectDiscipline(uid, schoolId, schoolYearId, { headerRefresh })
      .then((value) => { if (active) setSanctions(value); })
      .catch((reason: unknown) => { if (active) setError(reason); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [uid, schoolId, schoolYearId, headerRefresh, retry]);

  return <div className="grid gap-3">
    <p className="text-sm text-slate-500">Lecture seule · mes sections · saisi par le Directeur de discipline</p>
    <ErrorNotice error={error} fallback="Discipline indisponible." onRetry={() => setRetry((value) => value + 1)} />
    {!sanctions && loading && <p className="text-sm text-slate-500">Chargement de la discipline…</p>}
    {sanctions && sanctions.length === 0 && <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Aucune sanction enregistrée pour vos sections.</p>}
    {sanctions && sanctions.length > 0 && <ul className="grid gap-2">{sanctions.map((sanction) => <li key={sanction.id} className="grid gap-1 rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-ink">{sanction.studentName}</strong>
        <span className="text-slate-500">· {sanction.className}</span>
        <span className={`rounded px-2 py-0.5 text-xs font-bold ${sanction.status === "completed" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{sanction.status === "completed" ? "Clôturé" : "En cours"}</span>
      </div>
      <p className="text-slate-700">{sanction.sanctionType}{sanction.duration ? ` · ${sanction.duration} jour${sanction.duration > 1 ? "s" : ""}` : ""}{sanction.recurrenceNumber > 1 ? ` · récidive n° ${sanction.recurrenceNumber}` : ""}</p>
      <p className="text-xs text-slate-500">{formatDate(sanction.startDate)} · {sanction.reason}</p>
    </li>)}</ul>}
  </div>;
}
