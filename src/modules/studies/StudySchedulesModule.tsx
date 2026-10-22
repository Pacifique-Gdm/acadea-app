import { useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { exportFilteredStudySchedulePdf } from "./studySchedulePdf";
import { getActiveSchedulePersonnel } from "./studyPersonnel";
import { currentStudyTimetable, getActiveCoursePeriods, schedulePeriodLabel, sortTimetableEntriesForDisplay, studyDayLabel } from "./studySchedule";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import { DeterministicTimetableSolver } from "./timetableSolver";
import { publishTimetable, saveGeneratedTimetable, validateSavedTimetable } from "./studyService";
import { scheduleEntryDescription, validateTimetable } from "./scheduleValidation";
import type { useStudyData } from "./useStudyData";
import { assignmentAppliesToClass, logicalStudyClasses } from "./studyCourseScope";
import { scheduleClassPresentation } from "./scheduleClassPresentation";
import { prepareIncrementalFixedEntries } from "./incrementalSchedule";
import { scheduleIsStale, timetableSourceFingerprint } from "./scheduleSource";
import type { StudyDay } from "./studyTypes";
import { TimetableWorkflowError } from "./timetableWorkflowClient";

type View = "class" | "teacher" | "day";
type GenerationMode = "incremental" | "full";
const viewLabels: Record<View, string> = { class: "Par classe", teacher: "Par enseignant", day: "Par jour" };
const solver = new DeterministicTimetableSolver();

export function StudySchedulesModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const [view, setView] = useState<View>("class");
  const [selected, setSelected] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmValidate, setConfirmValidate] = useState(false);
  const operationPending = useRef(false);
  const selectionKey = `acadea:schedule:${user.id}:${school.id}:${year.id}`;
  const [selection, setSelection] = useState(() => ({ key: selectionKey, id: typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(selectionKey) ?? "" }));
  function selectVersion(id: string) { if (typeof sessionStorage !== "undefined") sessionStorage.setItem(selectionKey, id); setSelection({ key: selectionKey, id }); }
  const [updateChoiceOpen, setUpdateChoiceOpen] = useState(false);
  const [lastGeneratedFingerprint, setLastGeneratedFingerprint] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [report, setReport] = useState<ReturnType<typeof validateTimetable>>();
  const [reportStamp, setReportStamp] = useState("");
  const ordered = useMemo(() => [...data.timetables].sort((a, b) => b.version - a.version), [data.timetables]);
  const selectedId = selection.key === selectionKey ? selection.id : typeof sessionStorage === "undefined" ? "" : sessionStorage.getItem(selectionKey);
  const current = ordered.find((item) => item.id === selectedId) ?? currentStudyTimetable(ordered);
  const entries = useMemo(() => current ? data.timetableEntries.filter((item) => item.scheduleId === current.id) : [], [current, data.timetableEntries]);
  const personnel = getActiveSchedulePersonnel(data.teachers, data.assignments);
  const logicalClasses = logicalStudyClasses(data.classes, data.sourceClasses);
  const scheduleClasses = [...new Map([...data.sourceClasses, ...data.classes, ...logicalClasses].map((item) => [item.id, item])).values()];
  const problem = { schoolId: school.id, schoolYearId: year.id, teachers: personnel.teachers, subjects: data.subjects, classes: scheduleClasses, assignments: personnel.assignments, availabilities: data.availabilities, periods: data.periods, rooms: data.rooms, days: resolveAttendanceSchoolDays(data.attendanceSettings), maxSameAssignmentPeriodsPerDay: 2 };
  const sourceFingerprint = timetableSourceFingerprint(problem);
  const ready = data.generationReady && data.schedulesReady && data.workflowReady && !data.error;
  const currentStamp = JSON.stringify([current?.id, current?.updatedAt, problem, entries]);
  const reportFresh = Boolean(report && reportStamp === currentStamp && ready);
  const statuses = { DRAFT: "Brouillon", VALID: "Validé", PUBLISHED: "Publié" };
  const scheduleIsFresh = Boolean(current && (!scheduleIsStale(current, problem) || lastGeneratedFingerprint === sourceFingerprint));
  const filtered = sortTimetableEntriesForDisplay(entries.filter((item) => view === "day" ? (!selected || item.dayOfWeek === selected) : view === "class" ? (!selected || (() => { const assignment = personnel.assignments.find((candidate) => candidate.id === item.assignmentId); const schoolClass = data.classes.find((candidate) => candidate.id === selected); const source = item.courseScope ? item : assignment; return Boolean(source && schoolClass && assignmentAppliesToClass(source, schoolClass, scheduleClasses)); })()) : (!selected || item.teacherId === selected)), data.periods);
  const choices = view === "class" ? data.classes : data.teachers;
  const selectedLabel = view === "day" ? (selected ? studyDayLabel(selected) : undefined) : selected ? choices.find((item) => item.id === selected) : undefined;
  const selectedLabelText = typeof selectedLabel === "string" ? selectedLabel : selectedLabel ? ("fullName" in selectedLabel ? selectedLabel.fullName : selectedLabel.name) : "Tous";

  async function generate(mode: GenerationMode) {
    if (operationPending.current) return;
    operationPending.current = true; setBusy(true); setFeedback("");
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
      const created = await saveGeneratedTimetable({ user, schoolId: school.id, schoolYearId: year.id, version, entries: result.entries, existing: ordered, metadata: { algorithm: "deterministic-backtracking", exploredBranches: result.statistics.exploredBranches, durationMs: result.statistics.durationMs, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint } });
      selectVersion(created.id); setLastGeneratedFingerprint(sourceFingerprint); setUpdateChoiceOpen(false); setReport(undefined); setFeedback(`Brouillon version ${version} généré.`);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Génération impossible."); } finally { operationPending.current = false; setBusy(false); }
  }
  function chooseGeneration(mode: GenerationMode) { setUpdateChoiceOpen(false); void generate(mode); }
  function requestGeneration() { if (current) setUpdateChoiceOpen(true); else void generate("full"); }
  function verify() {
    if (!current || !ready || operationPending.current) return;
    const nextReport = validateTimetable(problem, entries);
    setReport(nextReport); setReportStamp(currentStamp);
    setFeedback(nextReport.valid ? "Vérification réussie pour cette version et ces sources." : `${nextReport.errors.length} erreur(s) détectée(s).`);
  }
  async function transition(publishing: boolean) {
    if (!current || !ready || operationPending.current || !reportFresh || !report?.valid) return;
    operationPending.current = true; setBusy(true); selectVersion(current.id);
    try {
      if (publishing) await publishTimetable({ user, schedule: current, existing: ordered });
      else await validateSavedTimetable({ user, schedule: current });
      setFeedback(publishing ? "Horaire publié avec succès." : "Horaire validé. Cette version reste sélectionnée.");
      setConfirmPublish(false); setConfirmValidate(false); setReport(undefined);
    } catch (cause) {
      if (cause instanceof TimetableWorkflowError && cause.report) { setReport(cause.report); setReportStamp(""); }
      setFeedback(cause instanceof Error ? cause.message : "Opération impossible. Réessayez.");
    } finally { operationPending.current = false; setBusy(false); }
  }
  async function exportPdf() { await exportFilteredStudySchedulePdf({ school, year, entries: filtered, teachers: data.teachers, classes: scheduleClasses, assignments: personnel.assignments, subjects: data.subjects, periods: data.periods, rooms: data.rooms, filterLabel: `${viewLabels[view]} : ${selectedLabelText}` }); }

  return <section className="grid min-w-0 gap-4"><div><h1 className="text-2xl font-bold">Horaires</h1><p className="text-sm text-slate-600">{!data.schedulesReady ? "Chargement des horaires…" : current ? `Version ${current.version} · ${statuses[current.status]}` : "Aucun horaire"}</p></div><label className="grid gap-1 text-sm">Version de l’horaire<select aria-label="Version de l’horaire" className="input" disabled={!ready || busy} value={current?.id ?? ""} onChange={(event) => selectVersion(event.target.value)}>{ordered.map((item) => <option key={item.id} value={item.id}>Version {item.version} · {statuses[item.status]}{item.activePublished ? " · Publication active" : ""}</option>)}</select><span>Sans sélection conservée : dernier brouillon, puis version validée, puis publication active.</span></label>{selectedId && !ordered.some((item) => item.id === selectedId) && data.schedulesReady && <p role="status">La version sélectionnée n’est plus disponible. La version de secours est affichée.</p>}{data.error && <p role="alert">Les données pédagogiques sont indisponibles. Aucune validation ni publication n’est possible.</p>}<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center"><button className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50 lg:shrink-0" disabled={busy || !data.generationReady || scheduleIsFresh} onClick={requestGeneration}>{busy ? "Traitement…" : !data.generationReady ? "Chargement…" : "Générer automatiquement"}</button><button className="secondary-button justify-center lg:shrink-0" disabled={!current || busy || !ready} onClick={verify}>Vérifier</button><button className="secondary-button justify-center lg:shrink-0" disabled={!current || current.status !== "DRAFT" || busy || !reportFresh || !report?.valid} onClick={() => setConfirmValidate(true)}>Valider</button><button className="primary-button justify-center lg:shrink-0" disabled={!current || current.status !== "VALID" || busy || !reportFresh || !report?.valid} onClick={() => setConfirmPublish(true)}>Publier</button><div className="grid min-w-0 grid-cols-2 gap-2 lg:flex lg:flex-1"><select aria-label="Mode d’affichage" className="input min-w-0" value={view} onChange={(event) => { setView(event.target.value as View); setSelected(""); }}><option value="class">Par classe</option><option value="teacher">Par enseignant</option><option value="day">Par jour</option></select><select aria-label="Filtrer l’horaire" className="input min-w-0 lg:max-w-44" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Tous</option>{view === "day" ? problem.days.map((day: StudyDay) => <option key={day} value={day}>{studyDayLabel(day)}</option>) : choices.map((item) => <option key={item.id} value={item.id}>{"fullName" in item ? item.fullName : item.name}</option>)}</select></div><button className="pdf-export-button justify-center lg:ml-auto lg:shrink-0" disabled={!current} onClick={() => void exportPdf()}><Download className="h-4 w-4" /> Exporter PDF</button></div>{feedback && <p role="status" className="rounded border bg-white p-3">{feedback}</p>}{report && <div className={`rounded border p-3 ${reportFresh && report.valid ? "bg-green-50" : "bg-amber-50"}`}><b>{!reportFresh ? "Rapport périmé — relancez Vérifier" : report.valid ? "Horaire vérifié sans conflit" : "Horaire invalide"}</b><p>{report.metrics.entries} créneaux · {report.metrics.assignments} affectations · Version {current?.version}</p><ul className="grid gap-3">{report.errors.map((issue, index) => { const entry = entries.find((item) => item.id === issue.entityId); const conflicts = issue.metadata?.entries; return <li key={index}><strong>{issue.message}</strong>{Array.isArray(conflicts) ? conflicts.map((text, i) => <p key={i}>{String(text)}</p>) : entry ? <p>{scheduleEntryDescription(problem, entry)}</p> : null}</li>; })}</ul></div>}<div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[680px] text-sm"><thead><tr>{["Jour", "Période", "Classe", "Enseignant", "Matière"].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{filtered.map((item) => { const assignment = personnel.assignments.find((candidate) => candidate.id === item.assignmentId); const { name: className, scope } = scheduleClassPresentation(item, assignment, scheduleClasses, school.schoolOptions); return <tr key={item.id} className="border-t"><td className="p-3">{studyDayLabel(item.dayOfWeek)}</td><td className="p-3">{schedulePeriodLabel(item.periodId, data.periods)}</td><td className="p-3">{className}{scope ? <span className="block text-xs text-slate-500">{scope}</span> : null}</td><td className="p-3">{data.teachers.find((entry) => entry.id === item.teacherId)?.fullName ?? "—"}</td><td className="p-3">{data.subjects.find((entry) => entry.id === item.subjectId)?.name ?? "—"}</td></tr>;})}{data.schedulesReady && filtered.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">Aucune entrée d’horaire pour cette sélection.</td></tr>}</tbody></table></div>{updateChoiceOpen && <AdminDrawer title="Mettre à jour l’horaire" closeLabel="Fermer" onClose={() => !busy && setUpdateChoiceOpen(false)}><p>Des modifications pédagogiques ont été détectées depuis la dernière génération. Comment souhaitez-vous mettre à jour l’horaire ?</p><button type="button" className="secondary-button grid w-full justify-start text-left" disabled={busy} onClick={() => chooseGeneration("incremental")}><strong>Conserver l’horaire existant et intégrer uniquement les changements</strong><span className="text-xs font-normal">Les séances existantes encore valides resteront à leur place.</span></button><button type="button" className="secondary-button grid w-full justify-start text-left" disabled={busy} onClick={() => chooseGeneration("full")}><strong>Régénérer entièrement l’horaire</strong><span className="text-xs font-normal">Les anciennes séances pourront être déplacées pour recalculer l’ensemble de l’horaire.</span></button><button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => setUpdateChoiceOpen(false)}>Annuler</button></AdminDrawer>}{confirmValidate && <AdminDrawer title="Valider cet horaire ?" closeLabel="Fermer" onClose={() => !busy && setConfirmValidate(false)}><p>Le serveur vérifiera à nouveau toutes les sources. La version {current?.version} sera validée, sans être publiée.</p><button className="secondary-button" disabled={busy} onClick={() => setConfirmValidate(false)}>Annuler</button><button className="primary-button" disabled={busy || !ready || !reportFresh} onClick={() => void transition(false)}>Confirmer la validation</button></AdminDrawer>}{confirmPublish && <AdminDrawer title="Publier cet horaire ?" closeLabel="Fermer" onClose={() => !busy && setConfirmPublish(false)}><p>Cette version deviendra l’horaire actif visible par les utilisateurs autorisés.</p><div className="grid grid-cols-2 gap-2"><button className="secondary-button justify-center" disabled={busy} onClick={() => setConfirmPublish(false)}>Annuler</button><button className="primary-button justify-center" disabled={busy} onClick={() => void transition(true)}>{busy ? "Publication…" : "Publier"}</button></div></AdminDrawer>}</section>;
}
