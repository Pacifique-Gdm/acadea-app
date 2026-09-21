import { useEffect, useMemo, useRef, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import type { AppUser, School, SchoolYear, Student } from "../../types";
import { gradingSlotLabels } from "./teacherGrading";
import { loadTeacherGrading, saveTeacherObservation, type TeacherGradingData } from "./teacherGradingService";
import { gradesForStudent, studentsForAssignment, teacherAssignmentViews } from "./teacherLearning";
import type { TeacherPortalData } from "./teacherPortalData";
import { useTeacherGradingRoster } from "./useTeacherGradingRoster";
import { useTeacherLearning } from "./useTeacherLearning";

const studentName = (student: Student) => [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ");

export function TeacherStudentsDrawer({ user, school, year, data, onClose }: { user: AppUser; school: School; year: SchoolYear; data: TeacherPortalData; onClose: () => void }) {
  const learning = useTeacherLearning(user, school.id, year.id, data.teacher?.id);
  const [grading, setGrading] = useState<TeacherGradingData>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [selectedAssignment, setSelectedAssignment] = useState(data.assignments[0]?.id ?? "");
  const [selectedStudent, setSelectedStudent] = useState<Student>();
  const [observation, setObservation] = useState("");
  const [busy, setBusy] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  useEffect(() => { void loadTeacherGrading(school.id, year.id).then(setGrading).catch((cause) => setError(cause instanceof Error ? cause.message : "Chargement impossible.")); }, [school.id, year.id]);
  const views = useMemo(() => teacherAssignmentViews(data.assignments, data.subjects, data.classes), [data.assignments, data.subjects, data.classes]);
  const current = data.assignments.find((item) => item.id === selectedAssignment) ?? data.assignments[0];
  const { roster, error: rosterError } = useTeacherGradingRoster(current, school.id, year.id);
  const rosterStudents = roster?.assignmentId === current?.id ? roster.students : grading?.students ?? [];
  const students = current ? studentsForAssignment(rosterStudents, current, grading?.classes ?? data.classes) : [];
  const grades = current && selectedStudent && grading ? gradesForStudent(grading.entries, current, selectedStudent.id) : [];
  const observations = learning.observations.filter((item) => item.assignmentId === current?.id && item.studentId === selectedStudent?.id);

  useEffect(() => {
    if (!selectedStudent) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (detailRef.current && !detailRef.current.contains(event.target as Node)) setSelectedStudent(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedStudent(undefined); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [selectedStudent]);

  async function submit() {
    if (!current || !selectedStudent || !data.teacher || !observation.trim() || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await saveTeacherObservation({ schoolId: school.id, schoolYearId: year.id, assignmentId: current.id, classId: current.classId, subjectId: current.subjectId, studentId: selectedStudent.id, observation: observation.trim() });
      setObservation("");
      setSuccess(result.notificationWarning || "Observation enregistrée.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return <AdminDrawer title="Mes élèves" closeLabel="Fermer" onClose={() => !busy && onClose()}>
    <p className="text-sm text-slate-600">Suivi de mes classes</p>
    {(error || rosterError) && <p role="alert" className="text-sm text-red-700">{error || rosterError}</p>}
    {success && <p role="status" className="rounded bg-green-50 p-3 text-sm font-semibold text-green-800">{success}</p>}
    {!views.length ? <p className="rounded bg-slate-50 p-4">Aucun élève n’est disponible pour cette affectation.</p> : <>
      <select className="input" value={current?.id ?? ""} onChange={(event) => { setSelectedAssignment(event.target.value); setSelectedStudent(undefined); }}>{views.map((item) => <option key={item.assignment.id} value={item.assignment.id}>{item.subject?.name ?? "Matière"} — {item.schoolClass?.name ?? "Classe"}</option>)}</select>
      <p className="text-sm font-semibold">{students.length} élève(s)</p>
      <div className="grid gap-2">{students.map((student) => <div key={student.id} className="grid gap-2"><button type="button" aria-expanded={selectedStudent?.id === student.id} className="flex items-center gap-3 rounded border border-slate-200 p-3 text-left hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600" onClick={() => setSelectedStudent((currentStudent) => currentStudent?.id === student.id ? undefined : student)}>{student.photoUrl ? <img src={student.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 font-semibold">{student.prenom?.[0] ?? student.nom[0]}</span>}<span><strong>{studentName(student)}</strong><span className="block text-xs text-slate-500">{student.matricule}</span></span></button>{selectedStudent?.id === student.id && current && <section ref={detailRef} role="dialog" aria-label={`Suivi de ${studentName(student)}`} className="grid max-w-full gap-3 rounded border border-slate-300 bg-white p-4 shadow-sm"><h3 className="font-bold">{studentName(student)}</h3><p className="text-sm">{student.className} · {views.find((item) => item.assignment.id === current.id)?.subject?.name}</p><div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{grades.map((item) => <div key={item.id} className="rounded bg-slate-50 p-2 text-sm"><strong>{gradingSlotLabels[item.gradingSlot]}</strong><span className="block">{item.status === "absent" ? "Absent" : item.score ?? "Non coté"}</span></div>)}{!grades.length && <p className="text-sm text-slate-500 sm:col-span-2">Aucun résultat disponible dans cette matière.</p>}</div>{observations.map((item) => <p key={item.id} className="rounded bg-blue-50 p-3 text-sm">{item.observation}</p>)}<textarea className="input min-h-20 max-w-full" placeholder="Observation pédagogique" value={observation} onChange={(event) => setObservation(event.target.value)} /><button type="button" className="primary-button justify-center" disabled={busy || !observation.trim()} onClick={() => void submit()}>{busy ? "Enregistrement…" : "Enregistrer l’observation"}</button></section>}</div>)}</div>
    </>}
  </AdminDrawer>;
}
