import { useEffect, useMemo, useState } from "react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { defaultEventSuspendsCourses, parseOfficialCalendarProposal, validCalendarDate, validateCalendarEvent, type CalendarEventKind, type SchoolCalendarEvent } from "./schoolCalendar";
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
  const [proposalJson, setProposalJson] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [proposal, setProposal] = useState<SchoolCalendarEvent[]>([]);
  useEffect(() => { setEvents(calendar?.events ?? []); setEditing(null); }, [calendar]);
  useEffect(() => { setMonth((year.startsAt || new Date().toISOString()).slice(0, 7)); setProposal([]); }, [year.id, year.startsAt]);

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
    try { await saveSchoolCalendar({ user, schoolId: school.id, year, expectedUpdatedAt: calendar?.updatedAt, previousEventIds: calendar?.events.map((event) => event.id) ?? [], events, status }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
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
        <section className="grid gap-2"><h3 className="font-bold">Événements</h3>{events.length === 0 && <p className="text-sm text-slate-600">Aucun événement enregistré. N’en déduisez pas que les vacances ou congés n’existent pas.</p>}{events.map((event) => <div key={event.id} className="rounded border p-3 text-sm"><strong>{event.title}</strong><p>{kinds[event.kind]} · {event.startsAt} — {event.endsAt}</p><p>{event.suspendsCourses === true ? `Cours suspendus${event.startTime && event.endTime ? ` de ${event.startTime} à ${event.endTime}` : ""}` : "Événement informatif — cours maintenus"}</p><p>{event.origin === "official-proposal" ? `Proposition sourcée (${event.educationLevel ?? "niveau non indiqué"})` : "Adaptation locale"}</p>{event.sourceUrl && <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Consulter la source déclarée</a>}{event.origin === "local" && <div className="mt-2 flex gap-2"><button type="button" className="secondary-button" onClick={() => setEditing({ ...event })}>Modifier</button><button type="button" className="secondary-button" onClick={() => { if (window.confirm(`Supprimer « ${event.title} » du calendrier ?`)) setEvents((current) => current.filter((item) => item.id !== event.id)); }}>Supprimer</button></div>}</div>)}</section>
        <p className="rounded bg-blue-50 p-3 text-sm">Aucun calendrier officiel RDC n’est préchargé. <a href="https://edu-nc.gouv.cd/calendrier-scolaire" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Consulter la page officielle du ministère pour 2026–2027</a>. Avant d’importer une proposition, vérifiez vous-même les dates dans le document, son année et son niveau. Le lien prouve la provenance déclarée, pas l’exactitude des dates saisies.</p>
        <button type="button" className="secondary-button" onClick={() => setImportOpen((value) => !value)}>Préparer une proposition depuis une source officielle</button>
        {importOpen && <section className="grid gap-2 rounded border p-3"><p className="text-sm">Collez un tableau JSON d’événements avec title, kind, startsAt et endsAt. Aucun événement n’est appliqué automatiquement.</p><input className="input" type="url" aria-label="URL de la source officielle" placeholder="URL HTTPS du document source" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); setProposal([]); }}/><label>Date de publication (si disponible)<input className="input" type="date" value={publishedAt} onChange={(event) => { setPublishedAt(event.target.value); setProposal([]); }}/></label><input className="input" aria-label="Niveau d’enseignement officiel" placeholder="Niveau concerné" value={educationLevel} onChange={(event) => { setEducationLevel(event.target.value); setProposal([]); }}/><textarea className="input min-h-24" aria-label="Événements proposés en JSON" value={proposalJson} onChange={(event) => { setProposalJson(event.target.value); setProposal([]); }}/><button type="button" className="secondary-button" onClick={() => { try { setProposal(parseOfficialCalendarProposal(proposalJson, { url: sourceUrl, publishedAt, educationLevel }, year, events)); setError(""); } catch (cause) { setProposal([]); setError(cause instanceof Error ? cause.message : "Proposition invalide."); } }}>Prévisualiser la proposition</button>{proposal.length > 0 && <><p className="text-sm font-semibold">{proposal.length} événement(s) proposé(s) pour {year.name} — source déclarée : {proposal[0].sourceUrl}</p><ul className="text-sm">{proposal.map((item) => <li key={item.id}>{item.title} · {item.startsAt} — {item.endsAt}</li>)}</ul><button type="button" className="primary-button" onClick={() => { if (!window.confirm("Ajouter ces événements proposés au brouillon de cet établissement ?")) return; setEvents((current) => [...current, ...proposal].sort((a, b) => a.startsAt.localeCompare(b.startsAt))); setProposal([]); setImportOpen(false); }}>Ajouter la proposition au brouillon</button></>}</section>}
        <button type="button" className="secondary-button" onClick={() => setEditing(blank())}>Ajouter un événement</button>
        {editing && <section className="grid gap-2 rounded border p-3">
          <h3 className="font-bold">{events.some((event) => event.id === editing.id) ? "Modifier" : "Ajouter"} un événement</h3>
          <input className="input" aria-label="Titre de l’événement" placeholder="Titre" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })}/>
          <select className="input" aria-label="Type d’événement" value={editing.kind} onChange={(event) => { const kind = event.target.value as CalendarEventKind; setEditing({ ...editing, kind, suspendsCourses: defaultEventSuspendsCourses(kind), startTime: undefined, endTime: undefined }); }}>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="grid gap-2 sm:grid-cols-2"><label>Début<input className="input" type="date" value={editing.startsAt} onChange={(event) => setEditing({ ...editing, startsAt: event.target.value })}/></label><label>Fin<input className="input" type="date" value={editing.endsAt} onChange={(event) => setEditing({ ...editing, endsAt: event.target.value })}/></label></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.suspendsCourses === true} disabled={editing.kind === "resumption"} onChange={(event) => setEditing({ ...editing, suspendsCourses: event.target.checked, startTime: undefined, endTime: undefined })}/>Suspendre les cours pendant cet événement</label>
          {editing.suspendsCourses && <div className="grid gap-2 sm:grid-cols-2"><label>Heure de début (facultative)<input className="input" type="time" value={editing.startTime ?? ""} onChange={(event) => setEditing({ ...editing, startTime: event.target.value || undefined })}/></label><label>Heure de fin (facultative)<input className="input" type="time" value={editing.endTime ?? ""} onChange={(event) => setEditing({ ...editing, endTime: event.target.value || undefined })}/></label></div>}
          <div className="grid grid-cols-2 gap-2"><button type="button" className="primary-button w-full min-w-0" onClick={stageEvent}>Ajouter à la liste</button><button type="button" className="secondary-button w-full min-w-0" onClick={() => setEditing(null)}>Annuler</button></div>
        </section>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        <p className="text-xs text-slate-600">Toute modification est enregistrée d’abord en brouillon. Seuls les événements validés avec « Suspendre les cours » affectent le Dashboard Enseignant.</p>
        <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button w-full min-w-0" disabled={busy || Boolean(editing)} onClick={() => void persist("draft")}>Enregistrer le brouillon</button><button type="button" className="primary-button w-full min-w-0" disabled={busy || Boolean(editing) || !validCalendarDate(year.startsAt.slice(0, 10)) || !validCalendarDate(year.endsAt.slice(0, 10))} onClick={() => void persist("validated")}>Valider pour l’établissement</button></div>
      </>}
    </div>
  </AdminDrawer>;
}
