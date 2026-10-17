import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { AppUser, School, SchoolYear } from "../../types";
import {
  GRADING_SLOTS,
  activeStudentsForAssignment,
  activeStudentsForClass,
  changedGradeEntries,
  editableGradingSlots,
  gradingProgress,
  gradingSlotLabels,
  maxScoreActionLabel,
  maxScoreConfirmation,
  reconcileGradeDrafts,
  scopeTeacherGradingData,
  validateMaxScore,
  validateScore,
  type EditableGradingSlot,
  type GradeEntry,
} from "./teacherGrading";
import {
  loadTeacherGrading,
  loadTeacherGradingRoster,
  saveTeacherGradeEntries,
  saveTeacherGradingConfig,
  type TeacherGradingData,
} from "./teacherGradingService";
import { useTeacherGradingRoster } from "./useTeacherGradingRoster";
import type { TeacherPortalData } from "./teacherPortalData";
import { exportTeacherGradesPdf } from "./teacherGradingPdf";

type Draft = { score: string; status: GradeEntry["status"] };

const entryValue = (entry: GradeEntry | undefined) => {
  if (!entry || entry.status === "not_graded") return "Non coté";
  if (entry.status === "absent") return "Absent";
  return String(entry.score ?? "Non coté");
};

export function TeacherGradingDrawer({ user, school, year, portalData, onClose }: { user: AppUser; school: School; year: SchoolYear; portalData: TeacherPortalData; onClose: () => void }) {
  const initialData = useMemo<TeacherGradingData | undefined>(() => portalData.teacher ? ({
    teacher: portalData.teacher,
    assignments: portalData.assignments,
    titulars: [],
    subjects: portalData.subjects,
    classes: portalData.classes,
    students: [],
    configs: [],
    entries: [],
  }) : undefined, [portalData.assignments, portalData.classes, portalData.subjects, portalData.teacher]);
  const [rawData, setRawData] = useState<TeacherGradingData | undefined>(initialData);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [slot, setSlot] = useState<EditableGradingSlot>("period_1");
  const [maxScore, setMaxScore] = useState("");
  const [editingMaxScore, setEditingMaxScore] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportingPdfRef = useRef(false);
  const [confirmation, setConfirmation] = useState<"maximum" | "grade" | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [titularView, setTitularView] = useState(false);
  const [titularClassId, setTitularClassId] = useState("");
  const [titularStudentId, setTitularStudentId] = useState("");
  const [showConsolidated, setShowConsolidated] = useState(false);
  const draftContext = useRef<{ assignmentId: string; slot: EditableGradingSlot; entries: GradeEntry[] } | undefined>(undefined);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadTeacherGrading(school.id, year.id);
      setRawData({
        ...loaded,
        subjects: loaded.subjects.length ? loaded.subjects : portalData.subjects,
        classes: loaded.classes.length ? loaded.classes : portalData.classes,
      });
      setLoadFailed(false);
      setError("");
    } catch (cause) {
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [portalData.classes, portalData.subjects, school.id, year.id]);

  useEffect(() => { void reload(); }, [reload]);

  const data = useMemo(() => rawData ? scopeTeacherGradingData(user, rawData) : undefined, [rawData, user]);

  const assignments = data?.assignments ?? [];
  const assignment = assignments.find((item) => item.id === assignmentId) ?? assignments[0];
  const schoolClass = data?.classes.find((item) => item.id === assignment?.classId);
  const subject = data?.subjects.find((item) => item.id === assignment?.subjectId);
  const config = data?.configs.find((item) => item.classId === assignment?.classId && item.subjectId === assignment?.subjectId);
  const { roster, error: rosterError } = useTeacherGradingRoster(assignment, school.id, year.id);
  const students = useMemo(
    () => assignment && data ? activeStudentsForAssignment(roster?.assignmentId === assignment.id ? roster.students : data.students, school.id, year.id, assignment, data.classes) : [],
    [assignment, data, roster, school.id, year.id],
  );
  const entries = useMemo(
    () => (data?.entries ?? []).filter((item) => item.classId === assignment?.classId && item.subjectId === assignment?.subjectId && item.gradingSlot === slot),
    [assignment?.classId, assignment?.subjectId, data?.entries, slot],
  );
  const progress = gradingProgress(entries, students.map((item) => item.id));

  useEffect(() => {
    if (assignment && assignment.id !== assignmentId) setAssignmentId(assignment.id);
  }, [assignment, assignmentId]);

  useEffect(() => { setMaxScore(config ? String(config.maxScore) : ""); }, [config]);
  useEffect(() => { setEditingMaxScore(false); }, [assignment?.id, config]);
  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => setSuccess(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [success]);

  useEffect(() => { setConfirmation(null); setConfirmationText(""); }, [assignment?.id, slot]);

  useEffect(() => {
    const reset = draftContext.current?.assignmentId !== assignment?.id || draftContext.current?.slot !== slot || draftContext.current?.entries !== entries;
    draftContext.current = { assignmentId: assignment?.id ?? "", slot, entries };
    setDrafts((previous) => reconcileGradeDrafts(students, entries, previous, reset));
  }, [assignment?.id, entries, slot, students]);

  const hasTitular = !loading && !loadFailed && Boolean(data?.titulars.length);
  const titular = data?.titulars.find((item) => item.classId === titularClassId) ?? data?.titulars[0];
  const titularStudents = useMemo(
    () => titular && data ? activeStudentsForClass(data.students, school.id, year.id, titular.classId, data.classes) : [],
    [data, school.id, titular, year.id],
  );
  const selectedTitularStudent = titularStudents.find((item) => item.id === titularStudentId) ?? titularStudents[0];
  const titularConfigs = (data?.configs ?? []).filter((item) => item.classId === titular?.classId);
  const titularSubjectIds = [...new Set(titularConfigs.map((item) => item.subjectId))];
  const quotedSubjectIds = new Set((data?.entries ?? []).filter((item) => item.classId === titular?.classId && item.status !== "not_graded").map((item) => item.subjectId));

  async function saveMax() {
    if (!assignment || !data || savingRef.current || loading || confirmation !== "maximum" || confirmationText !== maxScoreConfirmation(Boolean(config))) return;
    const value = Number(maxScore);
    const message = validateMaxScore(value, data.entries.filter((item) => item.classId === assignment.classId && item.subjectId === assignment.subjectId));
    if (message) return setError(message);
    savingRef.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      await saveTeacherGradingConfig({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, maxScore: value, confirmation: confirmationText });
      setSuccess("Cote maximale enregistrée.");
      setConfirmation(null); setConfirmationText("");
      setEditingMaxScore(false);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function saveEntries(confirmed = false) {
    if (!assignment || !config) return setError("Définissez la cote maximale de ce cours avant de commencer la cotation.");
    if (savingRef.current) return;
    if (loading || students.some((student) => !drafts[student.id])) return setError("Chargement des cotations en cours. Réessayez dans un instant.");
    const { changes: payload, modifiesPersisted } = changedGradeEntries(students, entries, drafts, slot);
    if (!payload.length) return setSuccess("Aucune modification à enregistrer.");
    const invalid = payload.map((item) => validateScore(item.score, item.status, config.maxScore)).find(Boolean);
    if (invalid) return setError(invalid);
    if (modifiesPersisted && (!confirmed || confirmation !== "grade" || confirmationText !== "MODIFIER LA CÔTE")) {
      setConfirmation("grade"); setConfirmationText(""); return;
    }
    savingRef.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      await saveTeacherGradeEntries({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, entries: payload });
      setSuccess("Cotations enregistrées.");
      setConfirmation(null); setConfirmationText("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function exportPdf() {
    if (!assignment || savingRef.current || exportingPdfRef.current) return;
    exportingPdfRef.current = true;
    setExportingPdf(true);
    setError("");
    try {
      const latest = scopeTeacherGradingData(user, await loadTeacherGrading(school.id, year.id));
      if (latest.teacher.userId !== user.id) throw new Error("Le profil pédagogique ne correspond pas au compte Enseignant connecté.");
      if (!latest.assignments.some((item) => item.id === assignment.id && item.classId === assignment.classId && item.subjectId === assignment.subjectId)) throw new Error("Cours hors du périmètre pédagogique.");
      const latestRoster = await loadTeacherGradingRoster({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId });
      await exportTeacherGradesPdf({ school, year, teacher: latest.teacher, teacherName: user.name, assignment, schoolClass: latest.classes.find((item) => item.id === assignment.classId), subject: latest.subjects.find((item) => item.id === assignment.subjectId), students: activeStudentsForAssignment(latestRoster.students, school.id, year.id, assignment, latest.classes), entries: latest.entries.filter((item) => item.classId === assignment.classId && item.subjectId === assignment.subjectId), config: latest.configs.find((item) => item.classId === assignment.classId && item.subjectId === assignment.subjectId) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Export PDF impossible."); }
    finally { exportingPdfRef.current = false; setExportingPdf(false); }
  }

  const confirmationPanel = (kind: "maximum" | "grade") => confirmation === kind && <section className="mt-2 grid gap-3 rounded border border-amber-300 bg-amber-50 p-3" aria-label="Confirmation de cotation">
    <h3 className="font-bold">{kind === "maximum" ? "Confirmer la cote maximale" : "Confirmer la modification des cotes"}</h3>
    <p className="text-sm">Saisissez exactement <strong>{kind === "maximum" ? maxScoreConfirmation(Boolean(config)) : "MODIFIER LA CÔTE"}</strong> pour confirmer.</p>
    <input className="input" aria-label="Phrase de confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" autoFocus />
    <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => { setConfirmation(null); setConfirmationText(""); if (kind === "maximum") { setEditingMaxScore(false); setMaxScore(config ? String(config.maxScore) : ""); } }}>Annuler</button><button type="button" className="primary-button justify-center" disabled={saving || confirmationText !== (kind === "maximum" ? maxScoreConfirmation(Boolean(config)) : "MODIFIER LA CÔTE")} onClick={() => void (kind === "maximum" ? saveMax() : saveEntries(true))}>Confirmer</button></div>
  </section>;

  const renderTitularView = () => {
    if (!data?.titulars.length) return <p className="rounded bg-slate-50 p-4">Aucune classe titulaire ne vous est attribuée.</p>;
    const className = data.classes.find((item) => item.id === titular?.classId)?.name ?? titular?.classId;
    return <section className="grid gap-3">
      <p className="rounded bg-blue-50 p-3 text-sm">Fiche consolidée automatique en lecture seule. Les cotations restent modifiables uniquement par leur enseignant propriétaire.</p>
      {data.titulars.length > 1 && <label className="grid gap-1 text-sm font-semibold">Classe titulaire<select className="input" value={titular?.classId} onChange={(event) => { setTitularClassId(event.target.value); setTitularStudentId(""); setShowConsolidated(false); }}>{data.titulars.map((item) => <option key={item.id} value={item.classId}>{data.classes.find((candidate) => candidate.id === item.classId)?.name ?? item.classId}</option>)}</select></label>}
      <article className="rounded border bg-white p-3">
        <b>{className}</b>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <span>{titularStudents.length} élève(s)</span><span>{titularSubjectIds.length} matière(s)</span>
          <span>{quotedSubjectIds.size} cotée(s)</span><span>{Math.max(0, titularSubjectIds.length - quotedSubjectIds.size)} en attente</span>
        </div>
      </article>
      <button type="button" className="secondary-button justify-center" onClick={() => setShowConsolidated((current) => !current)}>Voir la fiche consolidée</button>
      {showConsolidated && (!titularConfigs.length ? <p className="rounded bg-slate-50 p-3">Aucune cote n’a encore été saisie pour cette classe.</p> : <>
        <label className="grid gap-1 text-sm font-semibold">Vue par élève<select className="input" value={selectedTitularStudent?.id ?? ""} onChange={(event) => setTitularStudentId(event.target.value)}>{titularStudents.map((student) => <option key={student.id} value={student.id}>{student.nom} {student.postnom} {student.prenom}</option>)}</select></label>
        {!selectedTitularStudent ? <p className="rounded bg-slate-50 p-3">Aucun élève actif n’est inscrit dans cette classe.</p> : <div className="grid gap-3">
          {titularConfigs.map((item) => <article key={item.id} className="rounded border bg-white p-3">
            <div className="flex flex-wrap justify-between gap-2"><b>{data.subjects.find((candidate) => candidate.id === item.subjectId)?.name ?? item.subjectId}</b><span className="text-sm">Maximum : {item.maxScore}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {GRADING_SLOTS.map((gradingSlot) => {
                const readOnlyTotal = !editableGradingSlots.includes(gradingSlot as EditableGradingSlot);
                const entry = data.entries.find((candidate) => candidate.classId === item.classId && candidate.subjectId === item.subjectId && candidate.studentId === selectedTitularStudent.id && candidate.gradingSlot === gradingSlot);
                return <div key={gradingSlot} className="rounded bg-slate-50 p-2 text-xs"><b className="block">{gradingSlotLabels[gradingSlot]}</b><span>{readOnlyTotal ? "Non configuré" : entryValue(entry)}</span></div>;
              })}
            </div>
          </article>)}
        </div>}
      </>)}
    </section>;
  };

  return <AdminDrawer title="Fiche de cotation" closeLabel="Fermer la fiche de cotation" onClose={onClose}>
    {loading && <p role="status" className="rounded bg-slate-50 p-4">Chargement…</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {rosterError && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{rosterError}</p>}
    {success && <p role="status" className="rounded bg-green-50 p-3 text-green-800">{success}</p>}
    {data && !data.assignments.length && !data.titulars.length && !loading && !loadFailed ? <p className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Aucune affectation n’est disponible pour cet enseignant pour l’année scolaire active.</p> : data && !loadFailed && <div className="grid gap-4">
      <div className={hasTitular ? "grid grid-cols-2 gap-2" : "grid grid-cols-1"}><button type="button" className={!titularView || !hasTitular ? "primary-button w-full justify-center" : "secondary-button w-full justify-center"} onClick={() => setTitularView(false)}>Mes cotations</button>{hasTitular && <button type="button" className={titularView ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setTitularView(true)}>Ma classe titulaire</button>}</div>
      {titularView && hasTitular ? renderTitularView() : assignments.length === 0 ? <p className="rounded bg-slate-50 p-4">Aucun cours ne vous a encore été affecté par la Direction des études.</p> : <>
        <label className="grid gap-1 text-sm font-semibold">Cours<select className="input" value={assignment?.id} onChange={(event) => setAssignmentId(event.target.value)}>{assignments.map((item) => <option key={item.id} value={item.id}>{data.subjects.find((candidate) => candidate.id === item.subjectId)?.name} — {data.classes.find((candidate) => candidate.id === item.classId)?.name}</option>)}</select></label>
        <div className="rounded border bg-white p-3"><p className="font-bold">{subject?.name} — {schoolClass?.name}</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"><input className="input" type="number" min="0.01" step="0.01" aria-label="Cote maximale" value={maxScore} readOnly={Boolean(config) && !editingMaxScore} onChange={(event) => setMaxScore(event.target.value)} /><button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => { setEditingMaxScore(true); setConfirmation("maximum"); setConfirmationText(""); setSuccess(""); }}>{maxScoreActionLabel(Boolean(config))}</button></div>{confirmationPanel("maximum")}</div>
        <label className="grid gap-1 text-sm font-semibold">Période<select className="input" value={slot} onChange={(event) => setSlot(event.target.value as EditableGradingSlot)}>{editableGradingSlots.map((value) => <option key={value} value={value}>{gradingSlotLabels[value]}</option>)}</select></label>
        <p className="text-sm font-semibold">{progress.graded} / {progress.total} élèves cotés · {progress.status}</p>
        {!config ? <p className="rounded bg-amber-50 p-3 text-sm">Définissez la cote maximale de ce cours avant de commencer la cotation.</p> : students.length === 0 ? <p className="rounded bg-slate-50 p-3">Aucun élève actif n’est inscrit dans cette classe.</p> : <div className="grid gap-2">{students.map((student) => {
          const value = drafts[student.id] ?? { score: "", status: "not_graded" as const };
          return <article key={student.id} className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px_130px] sm:items-center"><span className="font-semibold">{student.nom} {student.postnom} {student.prenom}</span><input aria-label={`Cote de ${student.nom}`} className="input" type="number" min="0" max={config.maxScore} step="0.01" value={value.score} disabled={value.status === "absent"} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...value, score: event.target.value, status: event.target.value === "" ? "not_graded" : "graded" } }))} /><select aria-label={`Statut de ${student.nom}`} className="input" value={value.status} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { score: event.target.value === "graded" ? value.score : "", status: event.target.value === "graded" && value.score === "" ? "not_graded" : event.target.value as GradeEntry["status"] } }))}>{value.status === "absent" && <option value="absent" disabled>Absent (historique)</option>}<option value="not_graded">Non coté</option><option value="graded" disabled={value.score === ""}>Coté</option></select></article>;
        })}<div><div className="grid grid-cols-2 gap-2"><button type="button" className="primary-button justify-center" disabled={saving} onClick={() => void saveEntries()}>{saving ? "Enregistrement…" : "Enregistrer"}</button><button type="button" className="pdf-export-button justify-center" disabled={saving || exportingPdf} aria-busy={exportingPdf} onClick={() => void exportPdf()}>{exportingPdf ? "Chargement…" : "Exporter PDF"}</button></div>{confirmationPanel("grade")}</div></div>}
      </>}
    </div>}
  </AdminDrawer>;
}
