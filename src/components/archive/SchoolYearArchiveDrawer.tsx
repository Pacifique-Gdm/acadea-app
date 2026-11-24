import { useEffect, useState } from "react";
import { AdminDrawer } from "../ui/AdminDrawer";
import { listArchivedYears, readArchivedYear, type ArchivedYear, type ArchiveSummary } from "../../services/schoolYearArchive";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../ui/ErrorNotice";
import { createLoadCache } from "../../utils/loadCache";
import { auth } from "../../firebase";

/** Archives gardées pendant la session : rouvrir le tiroir les affiche tout de suite. La liste
 * est relue seulement si l'année active de l'école change (une année vient d'être archivée).
 * Le résumé d'une année archivée (lecture seule) est gardé par école et par année. */
const archivedYearsCache = createLoadCache<ArchivedYear[]>();
const archiveSummaryCache = createLoadCache<ArchiveSummary>(30);
// La personne connectée fait partie de la clé : le contenu dépend de son rôle.
const viewerId = () => auth?.currentUser?.uid ?? "";
const archivedYearsKey = (schoolId: string, activeSchoolYearId?: string, viewer = viewerId()) => `${viewer}:${schoolId}:${activeSchoolYearId ?? ""}`;

export function SchoolYearArchiveDrawer({ schoolId, activeSchoolYearId, onClose }: { schoolId: string; activeSchoolYearId?: string; onClose: () => void }) {
  const yearsKey = archivedYearsKey(schoolId, activeSchoolYearId);
  const cachedYears = archivedYearsCache.peek(yearsKey);
  const [years, setYears] = useState<ArchivedYear[]>(() => cachedYears ?? []);
  const [summary, setSummary] = useState<ArchiveSummary>();
  const [selectedYearId, setSelectedYearId] = useState("");
  const [loading, setLoading] = useState(() => !cachedYears);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const cached = archivedYearsCache.peek(yearsKey);
    if (cached) { setYears(cached); setLoading(false); return undefined; }
    let active = true;
    setLoading(true); setError("");
    archivedYearsCache.load(yearsKey, () => listArchivedYears(schoolId).then(({ years: result }) => result)).then((result) => { if (active) setYears(result); })
      .catch((cause) => { if (active) setError(userFacingError(cause, "Archives indisponibles.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [schoolId, yearsKey, retry]);
  async function openYear(yearId: string) {
    if (!years.some((year) => year.id === yearId)) return;
    setSelectedYearId(yearId);
    const cached = archiveSummaryCache.peek(`${viewerId()}:${schoolId}:${yearId}`);
    if (cached) { setSummary(cached); setError(""); return; }
    setSummary(undefined); setLoading(true); setError("");
    try { setSummary(await archiveSummaryCache.load(`${viewerId()}:${schoolId}:${yearId}`, () => readArchivedYear(schoolId, yearId))); }
    catch (cause) { setError(userFacingError(cause, "Archives indisponibles.")); }
    finally { setLoading(false); }
  }
  return <AdminDrawer title="Année Scolaire" closeLabel="Fermer les années scolaires" onClose={onClose}>
    <p className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Années archivées — consultation en lecture seule. Aucune action métier n'est disponible ici.</p>
    {selectedYearId && <button type="button" className="secondary-button mb-3 w-full justify-center" onClick={() => { setSelectedYearId(""); setSummary(undefined); setError(""); }}>Retour aux années</button>}
    <ErrorNotice className="mb-3" error={error} onRetry={() => { if (selectedYearId) void openYear(selectedYearId); else setRetry((value) => value + 1); }} />
    {loading && <p role="status">Chargement des archives…</p>}
    {!loading && !selectedYearId && !error && (years.length ? <div className="grid gap-2">{years.map((year) => <button key={year.id} type="button" className="secondary-button w-full justify-between text-left" onClick={() => void openYear(year.id)}><span>{year.name}</span><span className="text-xs">Consulter</span></button>)}</div> : <p className="rounded bg-slate-50 p-4 text-sm text-slate-600">Aucune année archivée accessible.</p>)}
    {!loading && summary && <section className="grid gap-3"><h3 className="font-bold">{summary.title} · {summary.year.name}</h3>{summary.truncated && <p className="text-sm text-amber-800">Les 100 premières opérations de chaque catégorie sont affichées.</p>}{summary.items.length ? summary.items.map((item, index) => <article key={`${item.label}-${index}`} className="rounded border bg-white p-3"><p className="font-semibold">{item.label}</p><p className="text-sm text-slate-600">{item.detail}</p></article>) : <p className="rounded bg-slate-50 p-4 text-sm text-slate-600">Aucune donnée historique autorisée pour cette année.</p>}</section>}
  </AdminDrawer>;
}
