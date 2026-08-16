

import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { AdminDrawer, MultiSelectDropdown } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { hasActiveAssignmentDuplicate, teacherWorkload, validateWeeklyPeriods } from "./studyAssignments";
import { createStudySubject, savePedagogicalAssignments, savePrimaryHomeroomAssignments, setPedagogicalAssignmentActive } from "./studyService";
import type { PedagogicalAssignment, StudyTeacher } from "./studyTypes";
import type { useStudyData } from "./useStudyData";
import { TeacherAvailabilityDrawer, TeacherAvailabilitySummary } from "./TeacherAvailabilityDrawer";
import { classesWithEnrolledStudents } from "../../services/schoolSubclasses";
import { primaryTeacherSections, studyClassSection, subjectAppliesToClass } from "./teacherAssignmentScope";
import { schoolSectionLabels } from "../../utils/schoolConfig";
import { sectionsAvailableToUser, userSectionIds } from "../../utils/userSections";
import { replaceStudySubjectFeedbackTimer } from "./studySubjectFeedback";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";

export function StudyTeachersModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const { teachers, subjects, classes, sourceClasses, students, assignments, error: realtimeError } = data;
  const [selectedTeacher, setSelectedTeacher] = useState<StudyTeacher>();
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [availabilityTeacher, setAvailabilityTeacher] = useState<StudyTeacher>();
  const [editingAssignment, setEditingAssignment] = useState<PedagogicalAssignment>();
  const [teacherId, setTeacherId] = useState("");
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [weeklyPeriods, setWeeklyPeriods] = useState("1");
  const [titularClassId, setTitularClassId] = useState("");
  const [active, setActive] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [subjectFeedback, setSubjectFeedback] = useState<{ type: "success" | "error"; message: string }>();
  const subjectFeedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeTeachers = useMemo(() => teachers.filter((teacher) => teacher.status === "active"), [teachers]);
  const availableSections = useMemo(() => sectionsAvailableToUser(user, school), [school, user]);
  const selectedAssignmentTeacher = useMemo(() => activeTeachers.find((teacher) => teacher.id === teacherId), [activeTeachers, teacherId]);
  const teacherSections = useMemo(() => userSectionIds(selectedAssignmentTeacher ?? {}).filter((section) => availableSections.includes(section)), [availableSections, selectedAssignmentTeacher]);
  const assignmentClasses = useMemo(() => classesWithEnrolledStudents(classes, students, school.id, year.id).filter(item => teacherSections.includes(studyClassSection(item))), [classes, school.id, students, teacherSections, year.id]);
  const primaryMode = teacherSections.length === 1 && primaryTeacherSections.includes(teacherSections[0]);
  const applicableSubjects = useMemo(() => subjects.filter(item => item.active && (!classIds[0] || subjectAppliesToClass(item, assignmentClasses.find(current => current.id === classIds[0])!))), [assignmentClasses, classIds, subjects]);

  const teacherRows = useMemo(() => teachers.filter((teacher) => teacher.status === "active").map((teacher) => {
    const activeAssignments = assignments.filter((item) => item.teacherId === teacher.id && item.active);
    return {
      teacher,
      subjects: [...new Set(activeAssignments.map((item) => subjects.find((subject) => subject.id === item.subjectId)?.name).filter(Boolean))].join(", ") || "Aucune",
      classes: [...new Set(activeAssignments.map((item) => classes.find((schoolClass) => schoolClass.id === item.classId)?.name).filter(Boolean))].join(", ") || "Aucune",
      count: activeAssignments.length,
      workload: teacherWorkload(teacher.id, assignments),
    };
  }), [assignments, classes, subjects, teachers]);
  const archivedTeachers = useMemo(() => teachers.filter((teacher) => teacher.status === "inactive"), [teachers]);
  const schoolDays = useMemo(() => resolveAttendanceSchoolDays(data.attendanceSettings), [data.attendanceSettings]);

  function openAssignment(current?: PedagogicalAssignment, preselectedTeacher?: StudyTeacher) {
    setEditingAssignment(current);
    setTeacherId(current?.teacherId ?? preselectedTeacher?.id ?? "");
    setSubjectIds(current?.subjectId ? [current.subjectId] : []);
    setClassIds(current?.classId ? [current.classId] : []);
    setWeeklyPeriods(String(current?.weeklyPeriods ?? 1));
    setTitularClassId(current?.titularClassId ?? "");
    setActive(current?.active ?? true);
    setFeedback("");
    setSubjectFeedback(undefined);
    if (subjectFeedbackTimer.current) clearTimeout(subjectFeedbackTimer.current);
    setAssignmentOpen(true);
  }

  useEffect(() => () => {
    if (subjectFeedbackTimer.current) clearTimeout(subjectFeedbackTimer.current);
  }, []);

  function showSubjectFeedback(type: "success" | "error", message: string) {
    setSubjectFeedback({ type, message });
    subjectFeedbackTimer.current = replaceStudySubjectFeedbackTimer(subjectFeedbackTimer.current, () => {
      setSubjectFeedback(undefined);
      subjectFeedbackTimer.current = undefined;
    });
  }

  useEffect(() => {
    if (!assignmentOpen) return;
    const allowedClassIds = new Set(assignmentClasses.map((item) => item.id));
    setClassIds((current) => current.filter((id) => allowedClassIds.has(id)));
    setTitularClassId((current) => current && allowedClassIds.has(current) ? current : "");
  }, [assignmentClasses, assignmentOpen]);

  async function submitAssignment() {
    const periods = Number(weeklyPeriods);
    const periodError = validateWeeklyPeriods(periods);
    if (periodError) return setFeedback(periodError);
    const savedSubjectIds = primaryMode ? applicableSubjects.map(item => item.id) : subjectIds;
    const savedClassIds = primaryMode ? classIds.slice(0, 1) : classIds;
    if (!teacherId) return setFeedback("L’enseignant est obligatoire.");
    if (teacherSections.length === 0) return setFeedback("Aucune section n’est attribuée à cet enseignant. Configurez d’abord son périmètre.");
    if (savedSubjectIds.length === 0 || savedClassIds.length === 0) return setFeedback("Un cours et une classe sont obligatoires.");
    if (primaryMode && assignments.some(item => item.active && item.teacherId === teacherId && item.classId !== savedClassIds[0])) return setFeedback("En Maternelle/Primaire, un enseignant ne peut gérer qu’une seule classe.");
    const candidates = savedSubjectIds.flatMap((subjectId) => savedClassIds.map((classId) => ({ schoolId: school.id, schoolYearId: year.id, teacherId, subjectId, classId })));
    if (candidates.some((candidate) => hasActiveAssignmentDuplicate(assignments, candidate, editingAssignment?.id))) return setFeedback("Une des affectations actives sélectionnées existe déjà.");
    if (titularClassId && assignments.some((item) => item.id !== editingAssignment?.id && item.active && item.titularClassId === titularClassId)) return setFeedback("Cette classe opérationnelle possède déjà un titulaire actif.");
    setBusy(true); setFeedback("");
    try {
      if (editingAssignment) await savePedagogicalAssignments({ user, schoolId: school.id, schoolYearId: year.id, teacherId, subjectIds: savedSubjectIds, classIds: savedClassIds, legacyClasses: assignmentClasses.filter((item) => savedClassIds.includes(item.id) && !sourceClasses.some((current) => current.id === item.id)), weeklyPeriods: periods, titularClassId: titularClassId || null, active, current: editingAssignment });
      else if (primaryMode) await savePrimaryHomeroomAssignments({ user, schoolId: school.id, schoolYearId: year.id, teacherId, subjectIds: savedSubjectIds, classId: savedClassIds[0], legacyClass: assignmentClasses.find((item) => item.id === savedClassIds[0] && !sourceClasses.some((current) => current.id === item.id)), weeklyPeriods: periods, active });
      else await savePedagogicalAssignments({ user, schoolId: school.id, schoolYearId: year.id, teacherId, subjectIds:savedSubjectIds, classIds:savedClassIds, legacyClasses: assignmentClasses.filter((item) => savedClassIds.includes(item.id) && !sourceClasses.some((current) => current.id === item.id)), weeklyPeriods: periods, titularClassId: titularClassId || null, active });
      setAssignmentOpen(false);
    } catch (cause) { console.error("Enregistrement de l’affectation impossible.", cause); setFeedback("Impossible d’enregistrer cette affectation. Vérifiez les classes sélectionnées."); }
    finally { setBusy(false); }
  }

  async function submitSubject() {
    if (busy || !newSubject.trim()) return;
    setBusy(true); setSubjectFeedback(undefined);
    if (subjectFeedbackTimer.current) clearTimeout(subjectFeedbackTimer.current);
    try {
      await createStudySubject({ user, schoolId: school.id, schoolYearId: year.id, name: newSubject });
      setNewSubject("");
      showSubjectFeedback("success", "Cours ajouté avec succès.");
    }
    catch (cause) {
      console.error("Ajout du cours impossible.", cause);
      showSubjectFeedback("error", "Impossible d’ajouter ce cours.");
    }
    finally { setBusy(false); }
  }

  return <section className="grid gap-4">
    <div><h1 className="text-2xl font-bold text-ink">Enseignants</h1><p className="text-sm text-slate-600">Enseignants créés par l’Administrateur et affectations pédagogiques.</p></div>
    <div className="flex justify-start"><button className="primary-button" type="button" onClick={() => openAssignment()}><Plus className="h-4 w-4" /> Ajouter une affectation</button></div>
    {(realtimeError || feedback) && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{realtimeError || feedback}</p>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm"><table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Nom", "Matières", "Classes", "Affectations", "Charge", "Statut"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{teacherRows.map(({ teacher, subjects: subjectNames, classes: classNames, count, workload }) => <tr key={teacher.id} className="border-t border-slate-100"><td className="px-3 py-3"><button type="button" onClick={() => setSelectedTeacher(teacher)} className="font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-mint">{teacher.fullName}</button></td><td className="px-3 py-3">{subjectNames}</td><td className="px-3 py-3">{classNames}</td><td className="px-3 py-3">{count}</td><td className="px-3 py-3">{workload} périodes</td><td className="px-3 py-3">{teacher.status === "active" ? "Actif" : "Inactif"}</td></tr>)}{teacherRows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Aucun enseignant pour cette année scolaire.</td></tr>}</tbody></table></div>

    {archivedTeachers.length > 0 && <details className="rounded border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer font-semibold text-slate-700">Historique des enseignants archivés ({archivedTeachers.length})</summary><div className="mt-3 grid gap-2">{archivedTeachers.map((teacher) => <button key={teacher.id} type="button" className="rounded border border-slate-200 bg-white p-3 text-left text-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-mint" onClick={() => setSelectedTeacher(teacher)}><span className="font-semibold text-blue-700">{teacher.fullName}</span><span className="block text-slate-500">{assignments.filter((item) => item.teacherId === teacher.id).length} affectation(s) historique(s)</span></button>)}</div></details>}

    {selectedTeacher && <AdminDrawer title={`Fiche pédagogique — ${selectedTeacher.fullName}`} closeLabel="Fermer la fiche pédagogique" onClose={() => setSelectedTeacher(undefined)}><p className="rounded bg-slate-50 p-3 text-sm"><strong>École :</strong> {school.name}<br/><strong>Année scolaire :</strong> {year.name}<br/>{selectedTeacher.email && <><strong>E-mail :</strong> {selectedTeacher.email}<br/></>}{selectedTeacher.phone && <><strong>Téléphone :</strong> {selectedTeacher.phone}<br/></>}<strong>Statut :</strong> {selectedTeacher.status === "active" ? "Actif" : "Inactif"}</p>{selectedTeacher.status === "active" && <button type="button" className="primary-button w-full justify-center" onClick={() => openAssignment(undefined, selectedTeacher)}><Plus className="h-4 w-4" /> Ajouter affectation</button>}{assignments.filter((item) => item.teacherId === selectedTeacher.id).map((item) => <article key={item.id} className="rounded border border-slate-200 p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{subjects.find((subject) => subject.id === item.subjectId)?.name ?? "Matière inconnue"}</p><p className="text-slate-600">{classes.find((schoolClass) => schoolClass.id === item.classId)?.name ?? "Classe inconnue"} · {item.weeklyPeriods} périodes/semaine · {item.active ? "Active" : "Inactive"}</p></div>{selectedTeacher.status === "active" && <button type="button" aria-label="Modifier l’affectation" className="inline-flex h-9 w-9 items-center justify-center rounded bg-slate-100" onClick={() => openAssignment(item)}><Pencil className="h-4 w-4" /></button>}</div>{selectedTeacher.status === "active" && item.active && <button type="button" className="mt-2 text-xs font-semibold text-red-700" onClick={() => void setPedagogicalAssignmentActive(user, item, false)}>Désactiver</button>}</article>)}<div className="grid gap-2">{selectedTeacher.status === "active" && <button type="button" className="primary-button w-full justify-center" onClick={() => setAvailabilityTeacher(selectedTeacher)}>Configurer disponibilité</button>}<TeacherAvailabilitySummary teacherId={selectedTeacher.id} items={data.availabilities} schoolDays={schoolDays} /></div><p className="text-right font-bold">Charge totale : {teacherWorkload(selectedTeacher.id, assignments)} périodes/semaine</p></AdminDrawer>}

    {availabilityTeacher && <TeacherAvailabilityDrawer user={user} teacher={availabilityTeacher} year={year} items={data.availabilities} schoolDays={schoolDays} onClose={()=>setAvailabilityTeacher(undefined)}/>}

    {assignmentOpen && <AdminDrawer title={editingAssignment ? "Modifier l’affectation" : "Ajouter une affectation"} closeLabel="Fermer le formulaire d’affectation" onClose={() => !busy && setAssignmentOpen(false)}>
      <label className="grid gap-1 text-sm font-semibold">Enseignant<select className="input" value={teacherId} onChange={(event) => { setTeacherId(event.target.value); setClassIds([]); setSubjectIds([]); setTitularClassId(""); }}><option value="">Sélectionner</option>{activeTeachers.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm" aria-live="polite"><strong>Section(s) attribuée(s) :</strong> {teacherSections.length ? teacherSections.map((item) => schoolSectionLabels[item]).join(", ") : "Aucune section attribuée"}</div>
      {primaryMode ? <p className="rounded border border-blue-200 bg-blue-50 p-3 text-sm">Le titulaire enseigne automatiquement tous les cours applicables à la classe sélectionnée.</p> : <MultiSelectDropdown label="Cours" options={applicableSubjects.map((item) => ({ value: item.id, label: item.name }))} values={subjectIds} onChange={setSubjectIds} />}
      <div className="grid gap-2 rounded border border-dashed border-slate-300 p-3"><label className="grid gap-1 text-sm font-semibold">Nouveau cours<input className="input" value={newSubject} onChange={(event) => setNewSubject(event.target.value)} /></label><button type="button" className="secondary-button w-full justify-center active:translate-y-px active:scale-[0.99] motion-reduce:transform-none" disabled={busy || !newSubject.trim()} onClick={() => void submitSubject()}>{busy ? "Ajout en cours…" : "Ajouter un cours"}</button>{subjectFeedback && <p role={subjectFeedback.type === "error" ? "alert" : "status"} aria-live="polite" className={`rounded border p-2 text-sm ${subjectFeedback.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>{subjectFeedback.message}</p>}</div>
      <MultiSelectDropdown label="Classes" options={assignmentClasses.map((item) => ({ value: item.id, label: item.name }))} values={classIds} onChange={setClassIds} placeholder="Aucune classe sélectionnée" />
      <label className="grid gap-1 text-sm font-semibold">Nombre de périodes hebdomadaires<input className="input" type="number" min={1} max={60} step={1} value={weeklyPeriods} onChange={(event) => setWeeklyPeriods(event.target.value)} /></label>
      <label className="grid gap-1 text-sm font-semibold">Titulaire de la classe (facultatif)<select className="input" value={titularClassId} onChange={(event) => setTitularClassId(event.target.value)}><option value="">{assignmentClasses.length ? "Choisir classe" : "Aucune classe disponible."}</option>{assignmentClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {editingAssignment && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Affectation active</label>}{feedback && <p role="alert" className="text-sm text-red-700">{feedback}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setAssignmentOpen(false)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy || !teacherId || teacherSections.length === 0} onClick={() => void submitAssignment()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
    </AdminDrawer>}
  </section>;
}
