// Lot 11 : notes de suivi CONFIDENTIELLES du Conseiller d'orientation.
// - Conseiller d'orientation : crée et modifie SES notes.
// - Direction des études (élèves de ses sections) et administrateur : lecture seule.
// Jamais visibles par les enseignants ni par les parents (le serveur refuse).
import { useMemo, useState } from "react";
import { ErrorNotice } from "../../components/ui";
import { localDateKey } from "../studies/prefectDashboard";
import { formatDay } from "./AdvisorContents";
import { filterAdvisorStudents, saveOrientationNote, useAdvisorData, type AdvisorStudent, type OrientationNote, type OrientationNoteInput } from "./advisorService";

type Scope = { uid: string; schoolId: string; schoolYearId: string };
const card = "rounded border border-slate-200 bg-white p-3 shadow-sm";
const fieldClass = "grid min-w-0 gap-1 text-sm font-medium text-slate-700";
export const NOTE_KIND_LABELS: Record<OrientationNoteInput["kind"], string> = { interview: "Entretien", observation: "Observation", orientation: "Orientation", other: "Autre" };

/** Calcul pur : chiffres du Dashboard (élèves suivis, notes du mois en cours). */
export function orientationDashboard(notes: OrientationNote[], today: string) {
  const month = today.slice(0, 7);
  return { followedStudents: new Set(notes.map((note) => note.studentId)).size, notesThisMonth: notes.filter((note) => note.noteDate.startsWith(month)).length, totalNotes: notes.length };
}

export function OrientationNotesContent({ scope, canWrite, readOnlyYear = false }: { scope: Scope; canWrite: boolean; readOnlyYear?: boolean }) {
  const { value, loading, error, retry, reload } = useAdvisorData<{ notes: OrientationNote[] }>("orientation-notes-list", scope);
  const students = useAdvisorData<{ students: AdvisorStudent[] }>("advisor-students", scope, canWrite);
  const [editing, setEditing] = useState<{ id?: string; input: OrientationNoteInput; studentLabel?: string }>();
  const [studentSearch, setStudentSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const matches = useMemo(() => studentSearch.trim() ? filterAdvisorStudents(students.value?.students ?? [], studentSearch).slice(0, 20) : [], [students.value, studentSearch]);
  const set = (patch: Partial<OrientationNoteInput>) => setEditing((current) => current && { ...current, input: { ...current.input, ...patch } });

  async function submit() {
    if (!editing || saving) return;
    setSaving(true); setSaveError(null); setNotice("");
    try {
      await saveOrientationNote({ schoolId: scope.schoolId, schoolYearId: scope.schoolYearId, noteId: editing.id, note: editing.input });
      setEditing(undefined); setStudentSearch("");
      setNotice("Note de suivi enregistrée.");
      reload();
    } catch (reason) { setSaveError(reason); } finally { setSaving(false); }
  }

  if (editing) return <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <button type="button" className="secondary-button w-full justify-center" onClick={() => { setEditing(undefined); setSaveError(null); }}>Retour aux notes</button>
    <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Note confidentielle · visible par vous, la direction des études et l'administrateur ; jamais par les enseignants ni les parents.</p>
    <ErrorNotice error={saveError} />
    {editing.id ? <p className="text-sm"><strong>Élève : </strong>{editing.studentLabel}</p> : <div className="grid gap-2">
      <label className={fieldClass}>Élève<input className="input" placeholder="Rechercher un élève (nom, matricule, classe)" value={studentSearch} onChange={(event) => { setStudentSearch(event.target.value); set({ studentId: "" }); }} /></label>
      <ErrorNotice error={students.error} fallback="Élèves indisponibles." onRetry={students.retry} />
      {editing.input.studentId ? <p className="text-sm text-slate-700">Choisi : <strong>{editing.studentLabel}</strong></p> : matches.map((student) => <button key={student.id} type="button" className="secondary-button justify-start text-left" onClick={() => { set({ studentId: student.id }); setEditing((current) => current && { ...current, studentLabel: `${student.name} · ${student.className}` }); }}>{student.name} · {student.className}</button>)}
    </div>}
    <label className={fieldClass}>Date<input className="input" type="date" required value={editing.input.noteDate} onChange={(event) => set({ noteDate: event.target.value })} /></label>
    <label className={fieldClass}>Type<select className="input" value={editing.input.kind} onChange={(event) => set({ kind: event.target.value as OrientationNoteInput["kind"] })}>{Object.entries(NOTE_KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
    <label className={fieldClass}>Note<textarea className="input min-h-32" required maxLength={4000} value={editing.input.content} onChange={(event) => set({ content: event.target.value })} /></label>
    <button type="submit" className="primary-button justify-center disabled:opacity-50" disabled={saving || !editing.input.studentId || !editing.input.content.trim()}>{saving ? "Enregistrement…" : "Enregistrer la note"}</button>
  </form>;

  return <div className="grid gap-3">
    <p className="text-sm text-slate-600">{canWrite ? "Vos notes de suivi confidentielles. Visibles par vous, la direction des études et l'administrateur ; jamais par les enseignants ni les parents." : "Notes de suivi confidentielles des conseillers d'orientation, en lecture seule."}</p>
    {notice && <p role="status" className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{notice}</p>}
    {canWrite && !readOnlyYear && <button type="button" className="primary-button justify-center" onClick={() => { setNotice(""); setStudentSearch(""); setEditing({ input: { studentId: "", noteDate: localDateKey(), kind: "interview", content: "" } }); }}>Nouvelle note de suivi</button>}
    <ErrorNotice error={error} fallback="Notes de suivi indisponibles." onRetry={retry} />
    {!value && loading && <p className="text-sm text-slate-500">Chargement des notes…</p>}
    {value && value.notes.length === 0 && <p className={card}>Aucune note de suivi.</p>}
    {value?.notes.map((note) => <article key={note.id} className={card}>
      <p className="font-semibold text-ink">{note.studentName} <span className="text-xs font-normal text-slate-500">· {note.className}</span> <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">confidentielle</span></p>
      <p className="text-xs text-slate-500">{NOTE_KIND_LABELS[note.kind] ?? "Note"} du {formatDay(note.noteDate)}{canWrite ? "" : ` · par ${note.authorName}`}</p>
      <p className="mt-1 whitespace-pre-line text-sm">{note.content}</p>
      {canWrite && !readOnlyYear && note.authorId === scope.uid && <button type="button" className="secondary-button mt-2" onClick={() => { setNotice(""); setEditing({ id: note.id, studentLabel: `${note.studentName} · ${note.className}`, input: { studentId: note.studentId, noteDate: note.noteDate, kind: note.kind, content: note.content } }); }}>Modifier</button>}
    </article>)}
  </div>;
}
