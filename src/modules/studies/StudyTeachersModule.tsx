

import { useMemo, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { hasActiveAssignmentDuplicate, teacherWorkload, validateWeeklyPeriods } from "./studyAssignments";
import { createStudySubject, savePedagogicalAssignment, setPedagogicalAssignmentActive } from "./studyService";
import type { PedagogicalAssignment, StudyTeacher } from "./studyTypes";
import type { useStudyData } from "./useStudyData";
import { TeacherAvailabilityDrawer, TeacherAvailabilitySummary } from "./TeacherAvailabilityDrawer";

export function StudyTeachersModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const { teachers, subjects, classes, assignments, error: realtimeError } = data;
  const [selectedTeacher, setSelectedTeacher] = useState<StudyTeacher>();
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [availabilityTeacher, setAvailabilityTeacher] = useState<StudyTeacher>();
  const [editingAssignment, setEditingAssignment] = useState<PedagogicalAssignment>();
  const [teacherId, setTeacherId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [classId, setClassId] = useState("");
  const [weeklyPeriods, setWeeklyPeriods] = useState("1");
  const [titularClassId, setTitularClassId] = useState("");
  const [active, setActive] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSubject, setNewSubject] = useState("");

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

  function openAssignment(current?: PedagogicalAssignment, preselectedTeacher?: StudyTeacher) {
    setEditingAssignment(current);
    setTeacherId(current?.teacherId ?? preselectedTeacher?.id ?? "");
    setSubjectId(current?.subjectId ?? "");
    setClassId(current?.classId ?? "");
    setWeeklyPeriods(String(current?.weeklyPeriods ?? 1));
    setTitularClassId(current?.titularClassId ?? "");
    setActive(current?.active ?? true);
    setFeedback("");
    setAssignmentOpen(true);
  }

  async function submitAssignment() {
    const periods = Number(weeklyPeriods);
    const periodError = validateWeeklyPeriods(periods);
    if (periodError) return setFeedback(periodError);
    const candidate = { schoolId: school.id, schoolYearId: year.id, teacherId, subjectId, classId };
    if (hasActiveAssignmentDuplicate(assignments, candidate, editingAssignment?.id)) return setFeedback("Cette affectation active existe déjà.");
    if (titularClassId && assignments.some((item) => item.id !== editingAssignment?.id && item.active && item.titularClassId === titularClassId)) return setFeedback("Cette classe opérationnelle possède déjà un titulaire actif.");
    setBusy(true); setFeedback("");
    try {
      await savePedagogicalAssignment({ user, ...candidate, weeklyPeriods: periods, titularClassId: titularClassId || null, active, current: editingAssignment });
      setAssignmentOpen(false);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  async function submitSubject() {
    setBusy(true); setFeedback("");
    try { await createStudySubject({ user, schoolId: school.id, schoolYearId: year.id, name: newSubject }); setNewSubject(""); }
    catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Création impossible."); }
    finally { setBusy(false); }
  }

  return <section className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-ink">Enseignants</h1><p className="text-sm text-slate-600">Enseignants créés par l’Administrateur et affectations pédagogiques.</p></div><button className="primary-button" type="button" onClick={() => openAssignment()}><Plus className="h-4 w-4" /> Ajouter une affectation</button></div>
    {(realtimeError || feedback) && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{realtimeError || feedback}</p>}
    <div className="overflow-x-auto rounded border border-slate-200 bg-white shadow-sm"><table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Nom", "Matières", "Classes", "Affectations", "Charge", "Statut", "Action"].map((label) => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody>{teacherRows.map(({ teacher, subjects: subjectNames, classes: classNames, count, workload }) => <tr key={teacher.id} className="border-t border-slate-100"><td className="px-3 py-3"><button type="button" onClick={() => setSelectedTeacher(teacher)} className="font-semibold text-blue-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-mint">{teacher.fullName}</button></td><td className="px-3 py-3">{subjectNames}</td><td className="px-3 py-3">{classNames}</td><td className="px-3 py-3">{count}</td><td className="px-3 py-3">{workload} périodes</td><td className="px-3 py-3">{teacher.status === "active" ? "Actif" : "Inactif"}</td><td className="px-3 py-3"><button type="button" className="secondary-button px-3 py-2" onClick={() => openAssignment(undefined, teacher)}><Plus className="h-4 w-4" /> Affecter</button></td></tr>)}{teacherRows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">Aucun enseignant pour cette année scolaire.</td></tr>}</tbody></table></div>

    {archivedTeachers.length > 0 && <details className="rounded border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer font-semibold text-slate-700">Historique des enseignants archivés ({archivedTeachers.length})</summary><div className="mt-3 grid gap-2">{archivedTeachers.map((teacher) => <button key={teacher.id} type="button" className="rounded border border-slate-200 bg-white p-3 text-left text-sm hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-mint" onClick={() => setSelectedTeacher(teacher)}><span className="font-semibold text-blue-700">{teacher.fullName}</span><span className="block text-slate-500">{assignments.filter((item) => item.teacherId === teacher.id).length} affectation(s) historique(s)</span></button>)}</div></details>}

    {selectedTeacher && <AdminDrawer title={`Fiche pédagogique — ${selectedTeacher.fullName}`} closeLabel="Fermer la fiche pédagogique" onClose={() => setSelectedTeacher(undefined)}><p className="rounded bg-slate-50 p-3 text-sm"><strong>École :</strong> {school.name}<br/><strong>Année scolaire :</strong> {year.name}<br/>{selectedTeacher.email && <><strong>E-mail :</strong> {selectedTeacher.email}<br/></>}{selectedTeacher.phone && <><strong>Téléphone :</strong> {selectedTeacher.phone}<br/></>}<strong>Statut :</strong> {selectedTeacher.status === "active" ? "Actif" : "Inactif"}</p><div className="flex justify-between gap-2"><h3 className="font-bold text-ink">Affectations</h3>{selectedTeacher.status === "active" && <button type="button" className="primary-button" onClick={() => openAssignment(undefined, selectedTeacher)}><Plus className="h-4 w-4" /> Ajouter</button>}</div>{assignments.filter((item) => item.teacherId === selectedTeacher.id).map((item) => <article key={item.id} className="rounded border border-slate-200 p-3 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{subjects.find((subject) => subject.id === item.subjectId)?.name ?? "Matière inconnue"}</p><p className="text-slate-600">{classes.find((schoolClass) => schoolClass.id === item.classId)?.name ?? "Classe inconnue"} · {item.weeklyPeriods} périodes/semaine · {item.active ? "Active" : "Inactive"}</p></div>{selectedTeacher.status === "active" && <button type="button" aria-label="Modifier l’affectation" className="inline-flex h-9 w-9 items-center justify-center rounded bg-slate-100" onClick={() => openAssignment(item)}><Pencil className="h-4 w-4" /></button>}</div>{selectedTeacher.status === "active" && item.active && <button type="button" className="mt-2 text-xs font-semibold text-red-700" onClick={() => void setPedagogicalAssignmentActive(user, item, false)}>Désactiver</button>}</article>)}<div className="grid gap-2"><div className="flex items-center justify-between gap-2"><h3 className="font-bold text-ink">Disponibilités</h3>{selectedTeacher.status === "active" && <button type="button" className="primary-button" onClick={() => setAvailabilityTeacher(selectedTeacher)}>Configurer</button>}</div><TeacherAvailabilitySummary teacherId={selectedTeacher.id} items={data.availabilities} /></div><p className="text-right font-bold">Charge totale : {teacherWorkload(selectedTeacher.id, assignments)} périodes/semaine</p></AdminDrawer>}

    {availabilityTeacher && <TeacherAvailabilityDrawer user={user} teacher={availabilityTeacher} year={year} items={data.availabilities} onClose={()=>setAvailabilityTeacher(undefined)}/>}

    {assignmentOpen && <AdminDrawer title={editingAssignment ? "Modifier l’affectation" : "Ajouter une affectation"} closeLabel="Fermer le formulaire d’affectation" onClose={() => !busy && setAssignmentOpen(false)}><label className="grid gap-1 text-sm font-semibold">Enseignant<select className="input" value={teacherId} onChange={(event) => setTeacherId(event.target.value)}><option value="">Sélectionner</option>{teachers.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Matière<select className="input" value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">Sélectionner</option>{subjects.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="rounded border border-dashed border-slate-300 p-3"><label className="grid gap-1 text-sm font-semibold">Nouvelle matière<input className="input" value={newSubject} onChange={(event) => setNewSubject(event.target.value)} /></label><button type="button" className="secondary-button mt-2" disabled={busy || !newSubject.trim()} onClick={() => void submitSubject()}>Ajouter la matière</button></div><label className="grid gap-1 text-sm font-semibold">Classe<select className="input" value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Sélectionner</option>{classes.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="grid gap-1 text-sm font-semibold">Nombre de périodes hebdomadaires<input className="input" type="number" min={1} max={60} step={1} value={weeklyPeriods} onChange={(event) => setWeeklyPeriods(event.target.value)} /></label><label className="grid gap-1 text-sm font-semibold">Titulaire de la classe (facultatif)<select className="input" value={titularClassId} onChange={(event) => setTitularClassId(event.target.value)}><option value="">Choisir classe</option>{classes.filter((item) => item.active !== false && (item.parentClassId || !classes.some((candidate) => candidate.parentClassId === item.id && candidate.active !== false))).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{editingAssignment && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Affectation active</label>}{feedback && <p role="alert" className="text-sm text-red-700">{feedback}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setAssignmentOpen(false)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void submitAssignment()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div></AdminDrawer>}
  </section>;
}
