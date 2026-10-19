import { useEffect, useState } from "react";
import { AdminDrawer } from "../ui/AdminDrawer";
import { listArchivedYears, readArchivedYear, type ArchivedYear, type ArchiveSummary } from "../../services/schoolYearArchive";
import { userFacingError } from "../../utils/userFacingError";

export function SchoolYearArchiveDrawer({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [years, setYears] = useState<ArchivedYear[]>([]);
  const [summary, setSummary] = useState<ArchiveSummary>();
  const [selectedYearId, setSelectedYearId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    listArchivedYears(schoolId).then(({ years: result }) => { if (active) setYears(result); })
      .catch((cause) => { if (active) setError(userFacingError(cause, "Archives indisponibles.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [schoolId, retry]);
  async function openYear(yearId: string) {
    if (!years.some((year) => year.id === yearId)) return;
    setSelectedYearId(yearId);
    setSummary(undefined); setLoading(true); setError("");
    try { setSummary(await readArchivedYear(schoolId, yearId)); }
    catch (cause) { setError(userFacingError(cause, "Archives indisponibles.")); }
    finally { setLoading(false); }
  }
  return <AdminDrawer title="Année Scolaire" closeLabel="Fermer les années scolaires" onClose={onClose}>
    <p className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Années archivées — consultation en lecture seule. Aucune action métier n'est disponible ici.</p>
    {selectedYearId && <button type="button" className="secondary-button mb-3 w-full justify-center" onClick={() => { setSelectedYearId(""); setSummary(undefined); setError(""); }}>Retour aux années</button>}
    {error && <div role="alert" className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error}</p><button type="button" className="secondary-button mt-2 w-full justify-center" onClick={() => { if (selectedYearId) void openYear(selectedYearId); else setRetry((value) => value + 1); }}>Réessayer</button></div>}
    {loading && <p role="status">Chargement des archives…</p>}
    {!loading && !selectedYearId && !error && (years.length ? <div className="grid gap-2">{years.map((year) => <button key={year.id} type="button" className="secondary-button w-full justify-between text-left" onClick={() => void openYear(year.id)}><span>{year.name}</span><span className="text-xs">Consulter</span></button>)}</div> : <p className="rounded bg-slate-50 p-4 text-sm text-slate-600">Aucune année archivée accessible.</p>)}
    {!loading && summary && <section className="grid gap-3"><h3 className="font-bold">{summary.title} · {summary.year.name}</h3>{summary.truncated && <p className="text-sm text-amber-800">Les 100 premières opérations de chaque catégorie sont affichées.</p>}{summary.items.length ? summary.items.map((item, index) => <article key={`${item.label}-${index}`} className="rounded border bg-white p-3"><p className="font-semibold">{item.label}</p><p className="text-sm text-slate-600">{item.detail}</p></article>) : <p className="rounded bg-slate-50 p-4 text-sm text-slate-600">Aucune donnée historique autorisée pour cette année.</p>}</section>}
  </AdminDrawer>;
}
