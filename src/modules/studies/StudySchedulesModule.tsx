import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { exportFilteredStudySchedulePdf } from "./studySchedulePdf";
import { getActiveSchedulePersonnel } from "./studyPersonnel";
import { currentStudyTimetable, getActiveCoursePeriods, schedulePeriodLabel, sortTimetableEntriesForDisplay, studyDayLabel } from "./studySchedule";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import { DeterministicTimetableSolver } from "./timetableSolver";
import { publishTimetable, saveGeneratedTimetable, validateSavedTimetable } from "./studyService";
import { validateTimetable } from "./scheduleValidation";
import type { useStudyData } from "./useStudyData";
import { assignmentAppliesToClass, assignmentScopeLabel, logicalStudyClasses } from "./studyCourseScope";
import { prepareIncrementalFixedEntries } from "./incrementalSchedule";
import { scheduleIsStale, timetableSourceFingerprint } from "./scheduleSource";
import type { StudyDay } from "./studyTypes";

type View = "class" | "teacher" | "day";
type GenerationMode = "incremental" | "full";
const viewLabels: Record<View, string> = { class: "Par classe", teacher: "Par enseignant", day: "Par jour" };
const solver = new DeterministicTimetableSolver();

export function StudySchedulesModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const [view, setView] = useState<View>("class");
  const [selected, setSelected] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [updateChoiceOpen, setUpdateChoiceOpen] = useState(false);
  const [lastGeneratedFingerprint, setLastGeneratedFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [report, setReport] = useState<ReturnType<typeof validateTimetable>>();
  const ordered = useMemo(() => [...data.timetables].sort((a, b) => b.version - a.version), [data.timetables]);
  const current = currentStudyTimetable(ordered);
  const entries = useMemo(() => current ? data.timetableEntries.filter((item) => item.scheduleId === current.id) : [], [current, data.timetableEntries]);
  const personnel = getActiveSchedulePersonnel(data.teachers, data.assignments);
  const logicalClasses = logicalStudyClasses(data.classes, data.sourceClasses);
  const scheduleClasses = [...new Map([...data.sourceClasses, ...data.classes, ...logicalClasses].map((item) => [item.id, item])).values()];
  const problem = { schoolId: school.id, schoolYearId: year.id, teachers: personnel.teachers, subjects: data.subjects, classes: scheduleClasses, assignments: personnel.assignments, availabilities: data.availabilities, periods: data.periods, days: resolveAttendanceSchoolDays(data.attendanceSettings), maxSameAssignmentPeriodsPerDay: 2 };
  const sourceFingerprint = timetableSourceFingerprint(problem);
  const scheduleIsFresh = Boolean(current && (!scheduleIsStale(current, problem) || lastGeneratedFingerprint === sourceFingerprint));
  const filtered = sortTimetableEntriesForDisplay(entries.filter((item) => view === "day" ? (!selected || item.dayOfWeek === selected) : view === "class" ? (!selected || (() => { const assignment = personnel.assignments.find((candidate) => candidate.id === item.assignmentId); const schoolClass = data.classes.find((candidate) => candidate.id === selected); return Boolean(assignment && schoolClass && assignmentAppliesToClass(assignment, schoolClass, scheduleClasses)); })()) : (!selected || item.teacherId === selected)), data.periods);
  const choices = view === "class" ? data.classes : data.teachers;
  const selectedLabel = view === "day" ? (selected ? studyDayLabel(selected) : undefined) : selected ? choices.find((item) => item.id === selected) : undefined;
  const selectedLabelText = typeof selectedLabel === "string" ? selectedLabel : selectedLabel ? ("fullName" in selectedLabel ? selectedLabel.fullName : selectedLabel.name) : "Tous";

  async function generate(mode: GenerationMode) {
    setBusy(true); setFeedback("");
    try {
      if (!data.generationReady) throw new Error("Les données pédagogiques sont encore en cours de chargement.");
      if (!personnel.assignments.length) throw new Error("Aucune affectation active.");
      if (!getActiveCoursePeriods(data.periods).length) throw new Error("Aucun créneau horaire configuré.");
      const fixedEntries = mode === "incremental" ? prepareIncrementalFixedEntries(problem, entries) : undefined;
      const result = solver.solve(problem, { timeoutMs: 5000, maxBranches: 100000, baselineEntries: mode === "incremental" ? entries : undefined, fixedEntries });
      if (!result.success) throw new Error(mode === "incremental" ? "Les nouveaux changements ne peuvent pas être intégrés sans déplacer certaines séances existantes. Vous pouvez régénérer entièrement l’horaire." : `Impossible de générer l’horaire : ${result.failures.map((item) => item.reason).join(" ")}`);
      const check = validateTimetable(problem, result.entries);
      if (!check.valid) throw new Error(check.errors.map((item) => item.message).join(" "));
      const version = Math.max(0, ...ordered.map((item) => item.version)) + 1;
      await saveGeneratedTimetable({ user, schoolId: school.id, schoolYearId: year.id, version, entries: result.entries, existing: ordered, metadata: { algorithm: "deterministic-backtracking", exploredBranches: result.statistics.exploredBranches, durationMs: result.statistics.durationMs, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint } });
      setLastGeneratedFingerprint(sourceFingerprint); setUpdateChoiceOpen(false); setReport(check); setFeedback(`Brouillon version ${version} généré.`);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Génération impossible."); } finally { setBusy(false); }
  }
  function chooseGeneration(mode: GenerationMode) { setUpdateChoiceOpen(false); void generate(mode); }
  function requestGeneration() { if (current) setUpdateChoiceOpen(true); else void generate("full"); }
  function verify() { if (!current) return setFeedback("Aucun horaire à vérifier."); const next = validateTimetable(problem, entries); setReport(next); setFeedback(next.valid ? "Horaire valide." : `${next.errors.length} erreur(s) détectée(s).`); }
  async function validate() { if (!current) return; const next = validateTimetable(problem, entries); if (!next.valid) return setFeedback("Validation refusée."); setBusy(true); try { await validateSavedTimetable({ user, schedule: current }); setFeedback("Horaire validé."); } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Validation impossible."); } finally { setBusy(false); } }
  async function publish() { if (!current) return; setBusy(true); try { await publishTimetable({ user, schedule: current, existing: ordered }); setFeedback("Horaire publié avec succès."); setConfirmPublish(false); } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Publication impossible."); } finally { setBusy(false); } }
  async function exportPdf() { await exportFilteredStudySchedulePdf({ school, year, entries: filtered, teachers: data.teachers, classes: scheduleClasses, subjects: data.subjects, periods: data.periods, rooms: data.rooms, filterLabel: `${viewLabels[view]} : ${selectedLabelText}` }); }

  return <section className="grid min-w-0 gap-4"><div><h1 className="text-2xl font-bold">Horaires</h1><p className="text-sm text-slate-600">{!data.schedulesReady ? "Chargement des horaires…" : current ? `Version ${current.version} · ${current.status}` : "Aucun horaire"}</p></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center"><button className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50 lg:shrink-0" disabled={busy || !data.generationReady || scheduleIsFresh} onClick={requestGeneration}>{busy ? "Traitement…" : !data.generationReady ? "Chargement…" : "Générer automatiquement"}</button><button className="secondary-button justify-center lg:shrink-0" disabled={!current || busy} onClick={verify}>Vérifier</button><button className="secondary-button justify-center lg:shrink-0" disabled={!current || current.status !== "DRAFT" || busy} onClick={() => void validate()}>Valider</button><button className="primary-button justify-center lg:shrink-0" disabled={!current || current.status !== "VALID" || busy} onClick={() => setConfirmPublish(true)}>Publier</button><div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-1"><select aria-label="Mode d’affichage" className="input min-w-0" value={view} onChange={(event) => { setView(event.target.value as View); setSelected(""); }}><option value="class">Par classe</option><option value="teacher">Par enseignant</option><option value="day">Par jour</option></select><select aria-label="Filtrer l’horaire" className="input min-w-0 lg:max-w-44" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Tous</option>{view === "day" ? problem.days.map((day: StudyDay) => <option key={day} value={day}>{studyDayLabel(day)}</option>) : choices.map((item) => <option key={item.id} value={item.id}>{"fullName" in item ? item.fullName : item.name}</option>)}</select></div><button className="pdf-export-button justify-center lg:ml-auto lg:shrink-0" disabled={!current} onClick={() => void exportPdf()}><Download className="h-4 w-4" /> Exporter PDF</button></div>{feedback && <p role="status" className="rounded border bg-white p-3">{feedback}</p>}{report && <div className={`rounded border p-3 ${report.valid ? "bg-green-50" : "bg-red-50"}`}><b>{report.valid ? "Horaire valide" : "Horaire invalide"}</b></div>}<div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[680px] text-sm"><thead><tr>{["Jour", "Période", "Classe", "Enseignant", "Matière"].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{filtered.map((item) => { const assignment = personnel.assignments.find((candidate) => candidate.id === item.assignmentId); const scope = assignment ? assignmentScopeLabel(assignment, scheduleClasses) : ""; return <tr key={item.id} className="border-t"><td className="p-3">{studyDayLabel(item.dayOfWeek)}</td><td className="p-3">{schedulePeriodLabel(item.periodId, data.periods)}</td><td className="p-3">{scheduleClasses.find((entry) => entry.id === item.classId)?.name ?? "—"}{scope ? <span className="block text-xs text-slate-500">{scope}</span> : null}</td><td className="p-3">{data.teachers.find((entry) => entry.id === item.teacherId)?.fullName ?? "—"}</td><td className="p-3">{data.subjects.find((entry) => entry.id === item.subjectId)?.name ?? "—"}</td></tr>;})}{data.schedulesReady && filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucune entrée d’horaire pour cette sélection.</td></tr>}</tbody></table></div>{updateChoiceOpen && <AdminDrawer title="Mettre à jour l’horaire" closeLabel="Fermer" onClose={() => !busy && setUpdateChoiceOpen(false)}><p>Des modifications pédagogiques ont été détectées depuis la dernière génération. Comment souhaitez-vous mettre à jour l’horaire ?</p><button type="button" className="secondary-button grid w-full justify-start text-left" disabled={busy} onClick={() => chooseGeneration("incremental")}><strong>Conserver l’horaire existant et intégrer uniquement les changements</strong><span className="text-xs font-normal">Les séances existantes encore valides resteront à leur place.</span></button><button type="button" className="secondary-button grid w-full justify-start text-left" disabled={busy} onClick={() => chooseGeneration("full")}><strong>Régénérer entièrement l’horaire</strong><span className="text-xs font-normal">Les anciennes séances pourront être déplacées pour recalculer l’ensemble de l’horaire.</span></button><button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => setUpdateChoiceOpen(false)}>Annuler</button></AdminDrawer>}{confirmPublish && <AdminDrawer title="Publier cet horaire ?" closeLabel="Fermer" onClose={() => !busy && setConfirmPublish(false)}><p>Cette version deviendra l’horaire actif visible par les utilisateurs autorisés.</p><div className="grid grid-cols-2 gap-2"><button className="secondary-button justify-center" disabled={busy} onClick={() => setConfirmPublish(false)}>Annuler</button><button className="primary-button justify-center" disabled={busy} onClick={() => void publish()}>{busy ? "Publication…" : "Publier"}</button></div></AdminDrawer>}</section>;
}
