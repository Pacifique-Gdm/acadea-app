import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { AppUser, School, SchoolYear } from "../../types";
import {
  GRADING_SLOTS,
  activeStudentsForClass,
  editableGradingSlots,
  gradingProgress,
  gradingSlotLabels,
  scopeTeacherGradingData,
  validateMaxScore,
  validateScore,
  type EditableGradingSlot,
  type GradeEntry,
} from "./teacherGrading";
import {
  loadTeacherGrading,
  saveTeacherGradeEntries,
  saveTeacherGradingConfig,
  type TeacherGradingData,
} from "./teacherGradingService";

type Draft = { score: string; status: GradeEntry["status"] };

const entryValue = (entry: GradeEntry | undefined) => {
  if (!entry || entry.status === "not_graded") return "Non coté";
  if (entry.status === "absent") return "Absent";
  return String(entry.score ?? "Non coté");
};

export function TeacherGradingDrawer({ user, school, year, onClose }: { user: AppUser; school: School; year: SchoolYear; onClose: () => void }) {
  const [rawData, setRawData] = useState<TeacherGradingData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [slot, setSlot] = useState<EditableGradingSlot>("period_1");
  const [maxScore, setMaxScore] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const [titularView, setTitularView] = useState(false);
  const [titularClassId, setTitularClassId] = useState("");
  const [titularStudentId, setTitularStudentId] = useState("");
  const [showConsolidated, setShowConsolidated] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRawData(await loadTeacherGrading(school.id, year.id));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [school.id, year.id]);

  useEffect(() => { void reload(); }, [reload]);

  const data = useMemo(() => rawData ? scopeTeacherGradingData(user, rawData) : undefined, [rawData, user]);

  const assignments = data?.assignments ?? [];
  const assignment = assignments.find((item) => item.id === assignmentId) ?? assignments[0];
  const schoolClass = data?.classes.find((item) => item.id === assignment?.classId);
  const subject = data?.subjects.find((item) => item.id === assignment?.subjectId);
  const config = data?.configs.find((item) => item.classId === assignment?.classId && item.subjectId === assignment?.subjectId);
  const students = useMemo(
    () => assignment && data ? activeStudentsForClass(data.students, school.id, year.id, assignment.classId) : [],
    [assignment, data, school.id, year.id],
  );
  const entries = useMemo(
    () => (data?.entries ?? []).filter((item) => item.classId === assignment?.classId && item.subjectId === assignment?.subjectId && item.gradingSlot === slot),
    [assignment?.classId, assignment?.subjectId, data?.entries, slot],
  );
  const progress = gradingProgress(entries, students.map((item) => item.id));

  useEffect(() => {
    if (assignment && assignment.id !== assignmentId) setAssignmentId(assignment.id);
  }, [assignment, assignmentId]);

  useEffect(() => {
    setMaxScore(config ? String(config.maxScore) : "");
    setDrafts(Object.fromEntries(students.map((student) => {
      const entry = entries.find((item) => item.studentId === student.id);
      return [student.id, { score: entry?.score == null ? "" : String(entry.score), status: entry?.status ?? "not_graded" }];
    })));
  }, [config, entries, students]);

  const titular = data?.titulars.find((item) => item.classId === titularClassId) ?? data?.titulars[0];
  const titularStudents = useMemo(
    () => titular && data ? activeStudentsForClass(data.students, school.id, year.id, titular.classId) : [],
    [data, school.id, titular, year.id],
  );
  const selectedTitularStudent = titularStudents.find((item) => item.id === titularStudentId) ?? titularStudents[0];
  const titularConfigs = (data?.configs ?? []).filter((item) => item.classId === titular?.classId);
  const titularSubjectIds = [...new Set(titularConfigs.map((item) => item.subjectId))];
  const quotedSubjectIds = new Set((data?.entries ?? []).filter((item) => item.classId === titular?.classId && item.status !== "not_graded").map((item) => item.subjectId));

  async function saveMax() {
    if (!assignment || !data) return;
    const value = Number(maxScore);
    const message = validateMaxScore(value, data.entries.filter((item) => item.classId === assignment.classId && item.subjectId === assignment.subjectId));
    if (message) return setError(message);
    setSaving(true); setError(""); setSuccess("");
    try {
      await saveTeacherGradingConfig({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, maxScore: value });
      setSuccess("Cote maximale enregistrée.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally { setSaving(false); }
  }

  async function saveEntries() {
    if (!assignment || !config) return setError("Définissez la cote maximale de ce cours avant de commencer la cotation.");
    const payload = students.map((student) => {
      const value = drafts[student.id] ?? { score: "", status: "not_graded" as const };
      return { studentId: student.id, gradingSlot: slot, score: value.score === "" ? null : Number(value.score), status: value.status };
    });
    const invalid = payload.map((item) => validateScore(item.score, item.status, config.maxScore)).find(Boolean);
    if (invalid) return setError(invalid);
    setSaving(true); setError(""); setSuccess("");
    try {
      await saveTeacherGradeEntries({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, entries: payload });
      setSuccess("Cotations enregistrées.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally { setSaving(false); }
  }

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
    {success && <p role="status" className="rounded bg-green-50 p-3 text-green-800">{success}</p>}
    {!loading && data && <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2"><button type="button" className={!titularView ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setTitularView(false)}>Mes cotations</button><button type="button" className={titularView ? "primary-button justify-center" : "secondary-button justify-center"} disabled={!data.titulars.length} onClick={() => setTitularView(true)}>Ma classe titulaire</button></div>
      {titularView ? renderTitularView() : assignments.length === 0 ? <p className="rounded bg-slate-50 p-4">Aucun cours ne vous a encore été affecté par la Direction des études.</p> : <>
        <label className="grid gap-1 text-sm font-semibold">Cours<select className="input" value={assignment?.id} onChange={(event) => setAssignmentId(event.target.value)}>{assignments.map((item) => <option key={item.id} value={item.id}>{data.subjects.find((candidate) => candidate.id === item.subjectId)?.name} — {data.classes.find((candidate) => candidate.id === item.classId)?.name}</option>)}</select></label>
        <div className="rounded border bg-white p-3"><p className="font-bold">{subject?.name} — {schoolClass?.name}</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"><input className="input" type="number" min="0.01" step="0.01" aria-label="Cote maximale" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} /><button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => void saveMax()}>Enregistrer maximum</button></div></div>
        <label className="grid gap-1 text-sm font-semibold">Période<select className="input" value={slot} onChange={(event) => setSlot(event.target.value as EditableGradingSlot)}>{editableGradingSlots.map((value) => <option key={value} value={value}>{gradingSlotLabels[value]}</option>)}</select></label>
        <p className="text-sm font-semibold">{progress.graded} / {progress.total} élèves cotés · {progress.status}</p>
        {!config ? <p className="rounded bg-amber-50 p-3 text-sm">Définissez la cote maximale de ce cours avant de commencer la cotation.</p> : students.length === 0 ? <p className="rounded bg-slate-50 p-3">Aucun élève actif n’est inscrit dans cette classe.</p> : <div className="grid gap-2">{students.map((student) => {
          const value = drafts[student.id] ?? { score: "", status: "not_graded" as const };
          return <article key={student.id} className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px_130px] sm:items-center"><span className="font-semibold">{student.nom} {student.postnom} {student.prenom}</span><input aria-label={`Cote de ${student.nom}`} className="input" type="number" min="0" max={config.maxScore} step="0.01" value={value.score} disabled={value.status !== "graded"} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...value, score: event.target.value, status: "graded" } }))} /><select aria-label={`Statut de ${student.nom}`} className="input" value={value.status} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { score: event.target.value === "graded" ? value.score : "", status: event.target.value as GradeEntry["status"] } }))}><option value="not_graded">Non coté</option><option value="graded">Coté</option><option value="absent">Absent</option></select></article>;
        })}<button type="button" className="primary-button justify-center" disabled={saving} onClick={() => void saveEntries()}>{saving ? "Enregistrement…" : "Enregistrer"}</button></div>}
      </>}
    </div>}
  </AdminDrawer>;
}
