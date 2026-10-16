import { useEffect, useRef, useState } from "react";
import { CalendarDays, Download } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { subscribeToActivePublishedTimetable } from "./publishedTimetableService";
import type { PublishedTimetableSnapshot } from "./publishedTimetableService";
import { studyDayLabel } from "./studySchedule";
import { emptyPublishedTimetableFilters, exportPublishedTimetablePdf, filterPublishedTimetable, type PublishedTimetableFilters } from "./publishedTimetableView";


export function PublishedTimetableReadOnly({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const storageKey = `published-timetable-filters:${school.id}:${year.id}`;
  const [filters, setFilters] = useState<PublishedTimetableFilters>(() => {
    try { return { ...emptyPublishedTimetableFilters, ...JSON.parse(sessionStorage.getItem(storageKey) ?? "{}") }; }
    catch { return emptyPublishedTimetableFilters; }
  });
  const [value, setValue] = useState<PublishedTimetableSnapshot>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const [scrollRange, setScrollRange] = useState({ left: 0, max: 0 });
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const userRef = useRef(user);
  userRef.current = user;
  const view = value ? filterPublishedTimetable(value.rows, filters) : null;
  const updateFilters = (next: PublishedTimetableFilters) => {
    setFilters(next);
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Session storage is optional. */ }
  };

  useEffect(() => {
    setLoading(true);
    setError("");
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = subscribeToActivePublishedTimetable({
        user: userRef.current,
        schoolId: school.id,
        schoolYearId: year.id,
        onData: (next) => { setValue(next); setError(""); setLoading(false); },
        onError: (cause) => { setError(`Impossible d’actualiser l’horaire publié : ${cause.message}`); setLoading(false); },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consultation impossible.");
      setLoading(false);
    }
    return unsubscribe;
  }, [school.id, user.id, user.role, user.schoolId, year.id]);

  useEffect(() => {
    const container = tableScrollRef.current;
    if (!container || !value) return;
    const measure = () => {
      const max = Math.max(0, container.scrollWidth - container.clientWidth);
      setHasHorizontalOverflow(max > 1);
      setScrollRange({ left: container.scrollLeft, max });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [value, view?.rows.length]);

  return <section className="grid gap-4" aria-label="Horaire publié">
    <div><h2 className="text-xl font-bold text-ink">Horaire publié</h2><p className="text-sm text-slate-600">Consultation en lecture seule pour l’année scolaire {year.name}.</p></div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Chargement de l’horaire publié…</p> : !value ? <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Aucun horaire publié pour cette année scolaire.</p> : <div className="min-w-0 rounded border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm"><strong>Version {value.version}</strong> · publiée</div>
      <div className="grid gap-2 border-b border-slate-200 p-3 sm:grid-cols-2 xl:grid-cols-4">
        <select className="input min-w-0" aria-label="Filtrer par jour" value={view?.filters.day ?? ""} onChange={(event) => updateFilters({ ...filters, day: event.target.value })}><option value="">Tous les jours</option>{view?.choices.days.map((day) => <option key={day} value={day}>{studyDayLabel(day as Exclude<typeof day, "unknown">)}</option>)}</select>
        <select className="input min-w-0" aria-label="Filtrer par enseignant" value={view?.filters.teacher ?? ""} onChange={(event) => updateFilters({ ...filters, teacher: event.target.value })}><option value="">Tous les enseignants</option>{view?.choices.teachers.map((teacher) => <option key={teacher} value={teacher}>{teacher}</option>)}</select>
        <select className="input min-w-0" aria-label="Filtrer par cours" value={view?.filters.subject ?? ""} onChange={(event) => updateFilters({ ...filters, subject: event.target.value })}><option value="">Tous les cours</option>{view?.choices.subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select>
        <div className="flex gap-2"><button type="button" className="secondary-button flex-1 justify-center" onClick={() => updateFilters(emptyPublishedTimetableFilters)}>Réinitialiser</button><button type="button" className="pdf-export-button flex-1 justify-center" onClick={() => view && void exportPublishedTimetablePdf({ school, year, rows: view.rows, filters: view.filters })}><Download className="h-4 w-4" /> PDF</button></div>
      </div>
      <div ref={tableScrollRef} onScroll={(event) => setScrollRange((current) => ({ ...current, left: event.currentTarget.scrollLeft }))} className="w-full max-w-full overflow-x-auto overscroll-x-contain" role="region" aria-label="Tableau de l’horaire publié" tabIndex={0}>
        <table className="w-full min-w-[1024px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Jour", "Période", "Classe", "Matière", "Enseignant"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{view?.rows.map((row, index) => <tr key={index} className="border-t border-slate-100"><td className="px-3 py-3">{row.dayOfWeek === "unknown" ? "Jour indisponible" : studyDayLabel(row.dayOfWeek)}</td><td className="px-3 py-3">{row.periodLabel}</td><td className="px-3 py-3">{row.classLabel}</td><td className="px-3 py-3">{row.subjectLabel}</td><td className="px-3 py-3">{row.teacherDisplayName}</td></tr>)}{view?.rows.length === 0 && <tr><td colSpan={5} className="px-3 py-5 text-center text-slate-500">Aucun cours pour ces filtres.</td></tr>}</tbody></table>
      </div>
      {hasHorizontalOverflow && <div className="grid gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600"><input type="range" className="w-full cursor-ew-resize accent-blue-700" aria-label="Faire défiler le tableau horizontalement" min={0} max={scrollRange.max} value={Math.min(scrollRange.left, scrollRange.max)} onChange={(event) => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = Number(event.target.value); }} /><div className="flex items-center justify-between gap-2"><button type="button" className="secondary-button" onClick={() => tableScrollRef.current?.scrollBy({ left: -240, behavior: "smooth" })}>← Colonnes précédentes</button><span className="hidden text-center sm:block">Défilement horizontal</span><button type="button" className="secondary-button" onClick={() => tableScrollRef.current?.scrollBy({ left: 240, behavior: "smooth" })}>Colonnes suivantes →</button></div></div>}
    </div>}
  </section>;
}

export function PublishedTimetableDrawerEntry({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [open, setOpen] = useState(false);

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex min-w-0 items-center gap-3 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-blue-50 text-blue-700"><CalendarDays className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block break-words font-bold text-ink">Horaire publié</span>
        <span className="mt-1 block break-words text-sm text-slate-500">Consulter l’horaire actif en lecture seule.</span>
      </span>
    </button>
    {open && <AdminDrawer title="Horaire publié" onClose={() => setOpen(false)} closeLabel="Fermer l’horaire publié">
      <PublishedTimetableReadOnly key={`${school.id}:${year.id}`} user={user} school={school} year={year} />
    </AdminDrawer>}
  </>;
}
