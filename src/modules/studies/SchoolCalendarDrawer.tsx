import { useEffect, useMemo, useState } from "react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { defaultEventSuspendsCourses, validCalendarDate, validateCalendarEvent, type CalendarEventKind, type SchoolCalendarEvent } from "./schoolCalendar";
import { analyzeCalendarPdf, isImportablePdfCandidate, type PdfAnalysis } from "./calendarPdfImport";
import { downloadCalendarPdf, removeUnreferencedCalendarPdf, uploadCalendarPdf } from "./calendarPdfStorage";
import { saveSchoolCalendar } from "./schoolCalendarService";
import { useSchoolCalendar } from "./useSchoolCalendar";

const kinds: Record<CalendarEventKind, string> = { vacation: "Vacances scolaires", holiday: "Jour férié", pedagogical: "Journée pédagogique", suspension: "Suspension des cours", resumption: "Reprise des cours", meeting: "Réunion", ceremony: "Cérémonie", classCouncil: "Conseil de classe", exam: "Examen", activity: "Autre activité" };
const blank = (): SchoolCalendarEvent => ({ id: crypto.randomUUID(), title: "", kind: "vacation", startsAt: "", endsAt: "", origin: "local", suspendsCourses: true });

export function SchoolCalendarDrawer({ user, school, years, selectedYear, onClose }: { user: AppUser; school: School; years: SchoolYear[]; selectedYear: SchoolYear; onClose: () => void }) {
  const scopedYears = useMemo(() => years.filter((year) => year.schoolId === school.id), [years, school.id]);
  const [yearId, setYearId] = useState(selectedYear.id);
  const year = scopedYears.find((item) => item.id === yearId) ?? selectedYear;
  const { calendar, loading, error: loadError } = useSchoolCalendar(user, school.id, year.id);
  const [events, setEvents] = useState<SchoolCalendarEvent[]>([]);
  const [editing, setEditing] = useState<SchoolCalendarEvent | null>(null);
  const [month, setMonth] = useState((year.startsAt || new Date().toISOString()).slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  useEffect(() => { setEvents(calendar?.events ?? []); setEditing(null); }, [calendar]);
  useEffect(() => { setMonth((year.startsAt || new Date().toISOString()).slice(0, 7)); setPdfFile(null); setAnalysis(null); setProgress(0); }, [year.id, year.startsAt]);

  const days = useMemo(() => {
    const [yyyy, mm] = month.split("-").map(Number);
    if (!yyyy || !mm) return [];
    const count = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
    return Array.from({ length: count }, (_, index) => `${yyyy}-${String(mm).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`);
  }, [month]);
  const offset = days.length ? (new Date(`${days[0]}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;

  function stageEvent() {
    if (!editing) return;
    const candidate = { ...editing, title: editing.title.trim() };
    const issue = validateCalendarEvent(candidate, year, events);
    if (issue) { setError(issue); return; }
    setEvents((current) => [...current.filter((item) => item.id !== candidate.id), candidate].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
    setEditing(null);
    setError("");
  }
  async function persist(status: "draft" | "validated") {
    if (busy || loading || loadError) return;
    if (status === "validated" && !window.confirm("Confirmez-vous avoir vérifié les dates de l'année, les vacances et les journées sans enseignement pour cet établissement ?")) return;
    setBusy(true); setError("");
    try { await saveSchoolCalendar({ user, schoolId: school.id, year, expectedUpdatedAt: calendar?.updatedAt, previousEventIds: calendar?.events.map((event) => event.id) ?? [], events, status, sourcePdf: calendar?.sourcePdf }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  async function analyze() {
    if (!pdfFile || analyzing || busy) return;
    setAnalyzing(true); setProgress(0); setAnalysis(null); setError("");
    try { setAnalysis(await analyzeCalendarPdf(pdfFile, year, setProgress)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Analyse PDF impossible."); }
    finally { setAnalyzing(false); }
  }

  async function addPdfToDraft() {
    if (!pdfFile || !analysis || busy || loading || loadError || calendar?.sourcePdf || school.activeSchoolYearId !== year.id) return;
    if (analysis.documentYear !== year.name.trim()) { setError("L'année scolaire du PDF n'a pas été établie avec certitude ou ne correspond pas à l'année active. Import bloqué."); return; }
    const selected = analysis.candidates.filter((item) => item.selected);
    if (!selected.length || selected.some((item) => !isImportablePdfCandidate(item))) { setError("Vérifiez explicitement le titre, le niveau, les dates et la suspension de chaque événement sélectionné avant l'import."); return; }
    const trialPath = `school-calendars/${school.id}/${year.id}/${crypto.randomUUID()}.pdf`;
    const draftEvents: SchoolCalendarEvent[] = selected.map((item) => ({
      id: item.id, title: item.title.trim(), kind: item.kind, startsAt: item.startsAt, endsAt: item.endsAt,
      origin: "pdf-import", sourcePdfPath: trialPath, sourcePage: item.sourcePage,
      educationLevel: item.educationLevel.trim(), suspendsCourses: item.suspendsCourses,
    }));
    const merged = [...events, ...draftEvents];
    if (merged.length > 100) { setError("Le calendrier ne peut pas dépasser 100 événements."); return; }
    for (const item of draftEvents) {
      const issue = validateCalendarEvent(item, year, merged);
      if (issue) { setError(`${item.title || "Événement"} : ${issue}`); return; }
    }
    if (!window.confirm("Enregistrer le PDF original et les événements vérifiés en brouillon ? Un calendrier validé redeviendra brouillon jusqu'à nouvelle validation.")) return;
    setBusy(true); setError("");
    let uploaded: Awaited<ReturnType<typeof uploadCalendarPdf>> | undefined;
    try {
      uploaded = await uploadCalendarPdf({ user, school, year, file: pdfFile, pageCount: analysis.pageCount });
      const imported = draftEvents.map((item) => ({ ...item, sourcePdfPath: uploaded!.path }));
      await saveSchoolCalendar({ user, schoolId: school.id, year, expectedUpdatedAt: calendar?.updatedAt, previousEventIds: calendar?.events.map((item) => item.id) ?? [], events: [...events, ...imported], status: "draft", sourcePdf: uploaded });
      setEvents([...events, ...imported].sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
      setAnalysis(null); setPdfFile(null); setImportOpen(false);
    } catch (cause) {
      if (uploaded) {
        try { await removeUnreferencedCalendarPdf(uploaded, school.id, year.id); }
        catch { setError("Enregistrement incertain : un PDF peut subsister. Vérifiez le calendrier avant de réessayer."); setBusy(false); return; }
      }
      setError(cause instanceof Error ? cause.message : "Import PDF impossible.");
    } finally { setBusy(false); }
  }

  return <AdminDrawer title="Calendrier scolaire" closeLabel="Fermer le calendrier" onClose={() => !busy && onClose()}>
    <div className="grid gap-4">
      <label className="grid gap-1 text-sm font-semibold">Année scolaire<select className="input" value={year.id} onChange={(event) => { setYearId(event.target.value); setError(""); }}>{scopedYears.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <p className="rounded bg-slate-50 p-3 text-sm">Dates de l’année scolaire : {year.startsAt?.slice(0, 10) || "non définie"} — {year.endsAt?.slice(0, 10) || "non définie"}. Ces bornes proviennent de l’année scolaire existante et ne sont pas modifiées ici.</p>
      {loading && <p>Chargement du calendrier…</p>}
      {loadError && <p role="alert" className="text-red-700">{loadError}</p>}
      {!loading && !loadError && <>
        <p className="text-sm font-semibold">{calendar ? calendar.status === "validated" ? "Calendrier validé" : "Calendrier en brouillon" : "Calendrier scolaire non configuré"}</p>
        <div className="flex items-center justify-between gap-2"><button type="button" className="secondary-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 1); return date.toISOString().slice(0, 7); })}>Mois précédent</button><strong>{month}</strong><button type="button" className="secondary-button" onClick={() => setMonth((value) => { const date = new Date(`${value}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString().slice(0, 7); })}>Mois suivant</button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs sm:text-sm">{["L", "M", "M", "J", "V", "S", "D"].map((label, index) => <strong key={index}>{label}</strong>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{days.map((day) => { const scheduled = events.filter((event) => event.startsAt <= day && day <= event.endsAt); return <button key={day} type="button" className={`rounded border p-1 ${scheduled.length ? "border-amber-400 bg-amber-50" : "border-slate-200"}`} title={scheduled.map((item) => item.title).join(", ") || day} onClick={() => setEditing({ ...blank(), startsAt: day, endsAt: day })}>{Number(day.slice(-2))}</button>; })}</div>
        <section className="grid gap-2"><h3 className="font-bold">Événements</h3>{events.length === 0 && <p className="text-sm text-slate-600">Aucun événement enregistré. N’en déduisez pas que les vacances ou congés n’existent pas.</p>}{events.map((event) => <div key={event.id} className="rounded border p-3 text-sm"><strong>{event.title}</strong><p>{kinds[event.kind]} · {event.startsAt} — {event.endsAt}</p><p>{event.suspendsCourses === true ? `Cours suspendus${event.startTime && event.endTime ? ` de ${event.startTime} à ${event.endTime}` : ""}` : "Événement informatif — cours maintenus"}</p><p>{event.origin === "official-proposal" ? `Proposition sourcée (${event.educationLevel ?? "niveau non indiqué"})` : event.origin === "pdf-import" ? `Import PDF · page ${event.sourcePage} · ${event.educationLevel}` : "Adaptation locale"}</p>{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Consulter la source déclarée</a>}{(event.origin === "local" || event.origin === "pdf-import") && <div className="mt-2 flex gap-2"><button type="button" className="secondary-button" onClick={() => setEditing({ ...event })}>Modifier</button><button type="button" className="secondary-button" onClick={() => { if (window.confirm(`Supprimer « ${event.title} » du calendrier ?`)) setEvents((current) => current.filter((item) => item.id !== event.id)); }}>Supprimer</button></div>}</div>)}</section>
        <section className="grid gap-2 rounded border p-3"><h3 className="font-bold">Importer un calendrier scolaire</h3><p className="text-sm">L'analyse du texte et l'OCR des pages numérisées se font dans ce navigateur, sans service externe. Vérifiez chaque ligne : le PDF n'est jamais appliqué automatiquement.</p>{calendar?.sourcePdf && <div className="text-sm"><p>Document conservé : {calendar.sourcePdf.name} ({Math.round(calendar.sourcePdf.size / 1024)} Ko, {calendar.sourcePdf.pageCount} page(s)).</p><button type="button" className="secondary-button" onClick={() => void downloadCalendarPdf(calendar.sourcePdf!, school.id, year.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Lecture PDF impossible."))}>Consulter le PDF original</button></div>}{school.activeSchoolYearId !== year.id ? <p className="text-sm">L'import PDF est réservé à l'année scolaire active de l'établissement.</p> : calendar?.sourcePdf ? <p className="text-sm">Un PDF est déjà associé à ce calendrier ; un second import n'est pas disponible dans cette version expérimentale.</p> : <><button type="button" className="secondary-button" onClick={() => setImportOpen((value) => !value)}>Choisir un fichier PDF</button>{importOpen && <><input type="file" accept="application/pdf,.pdf" aria-label="Choisir un fichier PDF" onChange={(event) => { setPdfFile(event.target.files?.[0] ?? null); setAnalysis(null); setProgress(0); setError(""); }} />{pdfFile && <p className="text-sm">{pdfFile.name} — {Math.round(pdfFile.size / 1024)} Ko</p>}<button type="button" className="primary-button" disabled={!pdfFile || analyzing || busy} onClick={() => void analyze()}>{analyzing ? "Analyse en cours…" : "Analyser le document"}</button>{analyzing && <progress className="w-full" value={progress} max={1} aria-label="Progression de l'analyse PDF" />}{analysis && <><p className="text-sm font-semibold">{analysis.candidates.length} événement(s) détecté(s) sur {analysis.pageCount} page(s). Chaque événement doit être comparé au PDF original. Les propositions rejetées ne sont pas enregistrées ; seules celles explicitement vérifiées peuvent être ajoutées.</p>{!analysis.documentYear && <p role="alert" className="text-sm text-red-700">Année scolaire du PDF non détectée : ajout au brouillon bloqué.</p>}{analysis.warnings.map((warning, index) => <p key={index} className="text-sm text-amber-800">{warning}</p>)}<div className="max-w-full overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr><th>Importer</th><th>Événement et niveau</th><th>Dates</th><th>Type et cours</th><th>Source</th><th>Vérifié</th></tr></thead><tbody>{analysis.candidates.map((item) => <tr key={item.id} className="border-t align-top"><td><input type="checkbox" aria-label={`Importer ${item.title}`} checked={item.selected} disabled={item.status === "rejected"} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked, reviewed: false, status: "to-review" } : candidate) }))} /></td><td><input className="input" aria-label={`Titre page ${item.sourcePage}`} value={item.title} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, title: event.target.value, reviewed: false, status: "to-review" } : candidate) }))} /><input className="input" aria-label={`Niveau page ${item.sourcePage}`} value={item.educationLevel} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, educationLevel: event.target.value, reviewed: false, status: "to-review" } : candidate) }))} /></td><td><input className="input" type="date" aria-label={`Début page ${item.sourcePage}`} value={item.startsAt} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, startsAt: event.target.value, reviewed: false, status: "to-review" } : candidate) }))} /><input className="input" type="date" aria-label={`Fin page ${item.sourcePage}`} value={item.endsAt} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, endsAt: event.target.value, reviewed: false, status: "to-review" } : candidate) }))} /></td><td><select className="input" aria-label={`Type page ${item.sourcePage}`} value={item.kind} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, kind: event.target.value as CalendarEventKind, suspendsCourses: false, reviewed: false, status: "to-review" } : candidate) }))}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className="flex gap-1"><input type="checkbox" checked={item.suspendsCourses} disabled={item.kind === "resumption"} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, suspendsCourses: event.target.checked, reviewed: false, status: "to-review" } : candidate) }))} />Suspendre les cours</label></td><td>Page {item.sourcePage}<span className="block text-amber-800">{item.status === "verified" ? "Vérifiée par l’utilisateur" : item.status === "rejected" ? "Rejetée" : "À vérifier"}</span><span className="block max-w-64 whitespace-normal break-words text-xs">Extrait : {item.sourceExcerpt}</span><button type="button" className="secondary-button mt-1" onClick={() => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, status: candidate.status === "rejected" ? "to-review" : "rejected", selected: false, reviewed: false } : candidate) }))}>{item.status === "rejected" ? "Réexaminer" : "Rejeter"}</button></td><td><input type="checkbox" aria-label={`Vérifié page ${item.sourcePage} ${item.title}`} checked={item.reviewed} disabled={!item.selected || item.status === "rejected"} onChange={(event) => setAnalysis((current) => current && ({ ...current, candidates: current.candidates.map((candidate) => candidate.id === item.id ? { ...candidate, reviewed: event.target.checked, status: event.target.checked ? "verified" : "to-review" } : candidate) }))} /></td></tr>)}</tbody></table></div><button type="button" className="secondary-button" onClick={() => setEditing(blank())}>Ajouter un événement manuellement</button><button type="button" className="primary-button" disabled={busy || analysis.documentYear !== year.name.trim() || !analysis.candidates.some((item) => item.selected) || analysis.candidates.some((item) => item.selected && !isImportablePdfCandidate(item))} onClick={() => void addPdfToDraft()}>Ajouter au brouillon</button></>}</>}</>}</section>
        <section className="grid gap-2 rounded border p-3">
        <button type="button" className="secondary-button justify-self-start" onClick={() => setEditing(blank())}>Ajouter un événement</button>
        {editing && <div className="grid gap-2">
          <h3 className="font-bold">{events.some((event) => event.id === editing.id) ? "Modifier" : "Ajouter"} un événement</h3>
          <input className="input" aria-label="Titre de l’événement" placeholder="Titre" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })}/>
          <select className="input" aria-label="Type d’événement" value={editing.kind} onChange={(event) => { const kind = event.target.value as CalendarEventKind; setEditing({ ...editing, kind, suspendsCourses: defaultEventSuspendsCourses(kind), startTime: undefined, endTime: undefined }); }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="grid gap-2 sm:grid-cols-2"><label>Début<input className="input" type="date" value={editing.startsAt} onChange={(event) => setEditing({ ...editing, startsAt: event.target.value })}/></label><label>Fin<input className="input" type="date" value={editing.endsAt} onChange={(event) => setEditing({ ...editing, endsAt: event.target.value })}/></label></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.suspendsCourses === true} disabled={editing.kind === "resumption"} onChange={(event) => setEditing({ ...editing, suspendsCourses: event.target.checked, startTime: undefined, endTime: undefined })}/>Suspendre les cours pendant cet événement</label>
          {editing.suspendsCourses && <div className="grid gap-2 sm:grid-cols-2"><label>Heure de début (facultative)<input className="input" type="time" value={editing.startTime ?? ""} onChange={(event) => setEditing({ ...editing, startTime: event.target.value || undefined })}/></label><label>Heure de fin (facultative)<input className="input" type="time" value={editing.endTime ?? ""} onChange={(event) => setEditing({ ...editing, endTime: event.target.value || undefined })}/></label></div>}
          <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button w-full min-w-0" onClick={() => setEditing(null)}>Annuler</button><button type="button" className="primary-button w-full min-w-0" onClick={stageEvent}>Ajouter à la liste</button></div>
        </div>}
        </section>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <p className="text-xs text-slate-600">Toute modification est enregistrée d’abord en brouillon. Seuls les événements validés avec « Suspendre les cours » affectent le Dashboard Enseignant.</p>
        <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button w-full min-w-0" disabled={busy || Boolean(editing)} onClick={() => void persist("draft")}>Enregistrer le brouillon</button><button type="button" className="primary-button w-full min-w-0" disabled={busy || Boolean(editing) || !validCalendarDate(year.startsAt.slice(0, 10)) || !validCalendarDate(year.endsAt.slice(0, 10))} onClick={() => void persist("validated")}>Valider pour l’établissement</button></div>
      </>}
    </div>
  </AdminDrawer>;
}
