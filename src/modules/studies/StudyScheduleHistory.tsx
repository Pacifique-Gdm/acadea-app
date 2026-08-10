import type { Timetable } from "./studyTypes";

export function StudyScheduleHistory({ items }: { items: Timetable[] }) {
  const ordered = [...items].sort((a, b) => b.version - a.version);
  return <div className="grid gap-3">{ordered.map((item) => <article key={item.id} className="grid gap-2 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm"><p><span className="font-semibold">Version</span><span className="block">{item.version}</span></p><p><span className="font-semibold">Date</span><span className="block break-words">{item.createdAt}</span></p><p><span className="font-semibold">Auteur</span><span className="block break-all">{item.createdBy}</span></p><p><span className="font-semibold">Statut</span><span className="block">{item.status}{item.activePublished ? " · Active" : ""}</span></p><p><span className="font-semibold">Validation / publication</span><span className="block break-words">{item.validatedAt || item.publishedAt || "—"}</span></p></article>)}{ordered.length === 0 && <p className="text-sm text-slate-500">Aucune version disponible.</p>}</div>;
}
