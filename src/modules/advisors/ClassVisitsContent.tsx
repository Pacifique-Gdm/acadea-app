// Lot 10 : fiches de visite de classe.
// - Conseiller pédagogique : crée et modifie SES fiches.
// - Direction des études (fiches de ses sections) et administrateur : lecture seule.
import { useState } from "react";
import { ErrorNotice } from "../../components/ui";
import { localDateKey } from "../studies/prefectDashboard";
import { formatDay } from "./AdvisorContents";
import { emptyVisitInput, saveClassVisit, useAdvisorData, type AdvisorOverview, type ClassVisit, type ClassVisitInput } from "./advisorService";

type Scope = { uid: string; schoolId: string; schoolYearId: string };
const card = "rounded border border-slate-200 bg-white p-3 shadow-sm";
const fieldClass = "grid min-w-0 gap-1 text-sm font-medium text-slate-700";

/** Calcul pur : les cours proposés dans le formulaire pour une classe (et un enseignant, s'il est choisi). */
export function visitCourseChoices(overview: AdvisorOverview | undefined, classId: string, teacherId: string) {
  const rows = (overview?.teachers ?? []).flatMap((teacher) => teacher.courses.map((course) => ({ ...course, teacherId: teacher.id, teacherName: teacher.teacherName })))
    .filter((course) => course.classId === classId && (!teacherId || course.teacherId === teacherId));
  return {
    teachers: [...new Map(rows.map((row) => [row.teacherId, { id: row.teacherId, name: row.teacherName }])).values()],
    subjects: [...new Map(rows.map((row) => [row.subjectId, { id: row.subjectId, name: row.subjectName }])).values()],
  };
}

export function ClassVisitsContent({ scope, overview, canWrite, readOnlyYear = false }: { scope: Scope; overview?: AdvisorOverview; canWrite: boolean; readOnlyYear?: boolean }) {
  const { value, loading, error, retry, reload } = useAdvisorData<{ visits: ClassVisit[] }>("class-visits-list", scope);
  const [editing, setEditing] = useState<{ id?: string; input: ClassVisitInput }>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const choices = visitCourseChoices(overview, editing?.input.classId ?? "", editing?.input.teacherId ?? "");
  const set = (patch: Partial<ClassVisitInput>) => setEditing((current) => current && { ...current, input: { ...current.input, ...patch } });

  async function submit() {
    if (!editing || saving) return;
    setSaving(true); setSaveError(null); setNotice("");
    try {
      await saveClassVisit({ schoolId: scope.schoolId, schoolYearId: scope.schoolYearId, visitId: editing.id, visit: editing.input });
      setEditing(undefined);
      setNotice("Fiche de visite enregistrée.");
      reload();
    } catch (reason) { setSaveError(reason); } finally { setSaving(false); }
  }

  if (editing) return <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <button type="button" className="secondary-button w-full justify-center" onClick={() => { setEditing(undefined); setSaveError(null); }}>Retour aux fiches</button>
    <ErrorNotice error={saveError} />
    <label className={fieldClass}>Classe<select className="input" required value={editing.input.classId} onChange={(event) => set({ classId: event.target.value, teacherId: "", subjectId: "" })}><option value="">Choisir une classe</option>{(overview?.classes ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className={fieldClass}>Enseignant<select className="input" value={editing.input.teacherId} onChange={(event) => set({ teacherId: event.target.value, subjectId: "" })}><option value="">Non précisé</option>{choices.teachers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className={fieldClass}>Cours<select className="input" value={editing.input.subjectId} onChange={(event) => set({ subjectId: event.target.value })}><option value="">Non précisé</option>{choices.subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label className={fieldClass}>Date de la visite<input className="input" type="date" required value={editing.input.visitDate} onChange={(event) => set({ visitDate: event.target.value })} /></label>
    <label className={fieldClass}>Points forts<textarea className="input min-h-20" maxLength={2000} value={editing.input.strengths} onChange={(event) => set({ strengths: event.target.value })} /></label>
    <label className={fieldClass}>À améliorer<textarea className="input min-h-20" maxLength={2000} value={editing.input.improvements} onChange={(event) => set({ improvements: event.target.value })} /></label>
    <label className={fieldClass}>Conseils<textarea className="input min-h-20" maxLength={2000} value={editing.input.advice} onChange={(event) => set({ advice: event.target.value })} /></label>
    <label className={fieldClass}>Date de la prochaine visite<input className="input" type="date" value={editing.input.nextVisitDate} onChange={(event) => set({ nextVisitDate: event.target.value })} /></label>
    <button type="submit" className="primary-button justify-center disabled:opacity-50" disabled={saving || !editing.input.classId}>{saving ? "Enregistrement…" : "Enregistrer la fiche"}</button>
  </form>;

  return <div className="grid gap-3">
    <p className="text-sm text-slate-600">{canWrite ? "Vos fiches de visite. Elles sont visibles par la direction des études et l'administrateur." : "Fiches de visite des conseillers pédagogiques, en lecture seule."}</p>
    {notice && <p role="status" className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{notice}</p>}
    {canWrite && !readOnlyYear && <button type="button" className="primary-button justify-center" onClick={() => { setNotice(""); setEditing({ input: emptyVisitInput(localDateKey()) }); }}>Nouvelle fiche de visite</button>}
    <ErrorNotice error={error} fallback="Fiches de visite indisponibles." onRetry={retry} />
    {!value && loading && <p className="text-sm text-slate-500">Chargement des fiches…</p>}
    {value && value.visits.length === 0 && <p className={card}>Aucune fiche de visite.</p>}
    {value?.visits.map((visit) => <article key={visit.id} className={card}>
      <p className="font-semibold text-ink">{visit.className}{visit.subjectName ? ` · ${visit.subjectName}` : ""}{visit.teacherName ? ` · ${visit.teacherName}` : ""}</p>
      <p className="text-xs text-slate-500">Visite du {formatDay(visit.visitDate)}{canWrite ? "" : ` · par ${visit.authorName}`}{visit.nextVisitDate ? ` · prochaine visite le ${formatDay(visit.nextVisitDate)}` : ""}</p>
      {visit.strengths && <p className="mt-1 text-sm"><strong>Points forts : </strong>{visit.strengths}</p>}
      {visit.improvements && <p className="text-sm"><strong>À améliorer : </strong>{visit.improvements}</p>}
      {visit.advice && <p className="text-sm"><strong>Conseils : </strong>{visit.advice}</p>}
      {canWrite && !readOnlyYear && visit.authorId === scope.uid && <button type="button" className="secondary-button mt-2" onClick={() => { setNotice(""); setEditing({ id: visit.id, input: { classId: visit.classId, teacherId: visit.teacherId, subjectId: visit.subjectId, visitDate: visit.visitDate, strengths: visit.strengths, improvements: visit.improvements, advice: visit.advice, nextVisitDate: visit.nextVisitDate } }); }}>Modifier</button>}
    </article>)}
  </div>;
}
