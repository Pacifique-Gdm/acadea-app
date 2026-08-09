import { useEffect, useMemo, useState } from "react";
import type { AppUser, School, SchoolYear } from "../../types";
import { subscribeToActivePublishedTimetable } from "./publishedTimetableService";
import type { PublishedTimetableSnapshot } from "./publishedTimetableService";

const dayLabels: Record<string, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi" };

export function PublishedTimetableReadOnly({ user, school, year }: { user: AppUser; school: School; year: SchoolYear }) {
  const [value, setValue] = useState<PublishedTimetableSnapshot>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = subscribeToActivePublishedTimetable({
        user,
        schoolId: school.id,
        schoolYearId: year.id,
        onData: (next) => { setValue(next); setLoading(false); },
        onError: () => { setError("Impossible d’actualiser l’horaire publié."); setLoading(false); },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Consultation impossible.");
      setLoading(false);
    }
    return unsubscribe;
  }, [school.id, user, year.id]);

  const entries = useMemo(() => [...(value?.entries ?? [])].sort((a, b) => `${a.dayOfWeek}-${a.periodId}-${a.classId}`.localeCompare(`${b.dayOfWeek}-${b.periodId}-${b.classId}`)), [value]);

  return <section className="grid gap-4" aria-label="Horaire publié">
    <div><h2 className="text-xl font-bold text-ink">Horaire publié</h2><p className="text-sm text-slate-600">Consultation en lecture seule pour l’année scolaire {year.name}.</p></div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Chargement de l’horaire publié…</p> : !value ? <p className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">Aucun horaire publié pour cette année scolaire.</p> : <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm"><strong>Version {value.timetable.version}</strong> · publiée</div>
      <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Jour", "Période", "Classe", "Matière", "Enseignant", "Salle"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{entries.map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="px-3 py-3">{dayLabels[entry.dayOfWeek] ?? entry.dayOfWeek}</td><td className="px-3 py-3">{entry.periodId}</td><td className="px-3 py-3">{entry.classId}</td><td className="px-3 py-3">{entry.subjectId}</td><td className="px-3 py-3">{entry.teacherId}</td><td className="px-3 py-3">{entry.roomId ?? "—"}</td></tr>)}</tbody></table>
    </div>}
  </section>;
}
