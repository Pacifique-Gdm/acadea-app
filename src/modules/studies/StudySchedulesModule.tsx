import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, School, SchoolYear } from "../../types";
import { exportFilteredStudySchedulePdf } from "./studySchedulePdf";
import { getActiveSchedulePersonnel } from "./studyPersonnel";
import { getActiveCoursePeriods } from "./studySchedule";
import { DeterministicTimetableSolver } from "./timetableSolver";
import { publishTimetable, saveGeneratedTimetable, validateSavedTimetable } from "./studyService";
import { validateTimetable } from "./scheduleValidation";
import type { useStudyData } from "./useStudyData";

type View = "class" | "teacher" | "room";
const viewLabels: Record<View, string> = { class: "Par classe", teacher: "Par enseignant", room: "Par salle" };
const solver = new DeterministicTimetableSolver();

export function StudySchedulesModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const [view, setView] = useState<View>("class");
  const [selected, setSelected] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [report, setReport] = useState<ReturnType<typeof validateTimetable>>();
  const ordered = useMemo(() => [...data.timetables].sort((a, b) => b.version - a.version), [data.timetables]);
  const current = ordered.find((item) => item.activeDraft) ?? ordered.find((item) => item.activePublished) ?? ordered[0];
  const entries = useMemo(() => current ? data.timetableEntries.filter((item) => item.scheduleId === current.id) : [], [current, data.timetableEntries]);
  const personnel = getActiveSchedulePersonnel(data.teachers, data.assignments);
  const problem = { schoolId: school.id, schoolYearId: year.id, teachers: personnel.teachers, subjects: data.subjects, classes: data.classes, assignments: personnel.assignments, availabilities: data.availabilities, periods: data.periods, maxSameAssignmentPeriodsPerDay: 2 };
  const filtered = entries.filter((item) => view === "class" ? (!selected || item.classId === selected) : view === "teacher" ? (!selected || item.teacherId === selected) : (!selected || item.roomId === selected));
  const choices = view === "class" ? data.classes : view === "teacher" ? data.teachers : data.rooms.filter((item) => item.active);
  const selectedLabel = selected ? choices.find((item) => item.id === selected) : undefined;

  async function generate() {
    setBusy(true); setFeedback("");
    try {
      if (!personnel.assignments.length || !getActiveCoursePeriods(data.periods).length) throw new Error("Ajoutez au moins une affectation active et une période de cours.");
      const result = solver.solve(problem, { timeoutMs: 750, maxBranches: 100000 });
      if (!result.success) throw new Error(`Impossible de générer l’horaire : ${result.failures.map((item) => item.reason).join(" ")}`);
      const check = validateTimetable(problem, result.entries);
      if (!check.valid) throw new Error(check.errors.map((item) => item.message).join(" "));
      const version = Math.max(0, ...ordered.map((item) => item.version)) + 1;
      await saveGeneratedTimetable({ user, schoolId: school.id, schoolYearId: year.id, version, entries: result.entries, existing: ordered, metadata: { algorithm: "deterministic-backtracking", exploredBranches: result.statistics.exploredBranches, durationMs: result.statistics.durationMs, maxSameAssignmentPeriodsPerDay: 2 } });
      setReport(check); setFeedback(`Brouillon version ${version} généré.`);
    } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Génération impossible."); } finally { setBusy(false); }
  }
  function verify() { if (!current) return setFeedback("Aucun horaire à vérifier."); const next = validateTimetable(problem, entries); setReport(next); setFeedback(next.valid ? "Horaire valide." : `${next.errors.length} erreur(s) détectée(s).`); }
  async function validate() { if (!current) return; const next = validateTimetable(problem, entries); if (!next.valid) return setFeedback("Validation refusée."); setBusy(true); try { await validateSavedTimetable({ user, schedule: current }); setFeedback("Horaire validé."); } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Validation impossible."); } finally { setBusy(false); } }
  async function publish() { if (!current) return; setBusy(true); try { await publishTimetable({ user, schedule: current, existing: ordered }); setFeedback("Horaire publié avec succès."); setConfirmPublish(false); } catch (cause) { setFeedback(cause instanceof Error ? cause.message : "Publication impossible."); } finally { setBusy(false); } }
  async function exportPdf() { await exportFilteredStudySchedulePdf({ school, year, entries: filtered, teachers: data.teachers, classes: data.classes, subjects: data.subjects, rooms: data.rooms, filterLabel: `${viewLabels[view]} : ${selectedLabel ? ("fullName" in selectedLabel ? selectedLabel.fullName : selectedLabel.name) : "Tous"}` }); }

  return <section className="grid min-w-0 gap-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><h1 className="text-2xl font-bold">Horaires</h1><p className="text-sm text-slate-600">{current ? `Version ${current.version} · ${current.status}` : "Aucun horaire"}</p></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap"><button className="primary-button justify-center" disabled={busy} onClick={() => void generate()}>{busy ? "Traitement…" : "Générer automatiquement"}</button><button className="secondary-button justify-center" disabled={!current || busy} onClick={verify}>Vérifier</button><button className="secondary-button justify-center" disabled={!current || current.status !== "DRAFT" || busy} onClick={() => void validate()}>Valider</button><button className="primary-button justify-center" disabled={!current || current.status !== "VALID" || busy} onClick={() => setConfirmPublish(true)}>Publier</button><button className="secondary-button justify-center" disabled={!current} onClick={() => void exportPdf()}><Download className="h-4 w-4" /> Exporter PDF</button></div></div>{feedback && <p role="status" className="rounded border bg-white p-3">{feedback}</p>}{report && <div className={`rounded border p-3 ${report.valid ? "bg-green-50" : "bg-red-50"}`}><b>{report.valid ? "Horaire valide" : "Horaire invalide"}</b></div>}<div className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-2 lg:flex lg:flex-wrap">{(["class", "teacher", "room"] as View[]).map((item) => <button key={item} className={view === item ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => { setView(item); setSelected(""); }}>{viewLabels[item]}</button>)}<select aria-label="Filtrer l’horaire" className="input min-w-0 flex-1" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Tous</option>{choices.map((item) => <option key={item.id} value={item.id}>{"fullName" in item ? item.fullName : item.name}</option>)}</select></div><div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[680px] text-sm"><thead><tr>{["Jour", "Période", "Classe", "Enseignant", "Matière", "Salle"].map((label) => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-t"><td className="p-3">{item.dayOfWeek}</td><td className="p-3">{item.periodId}</td><td className="p-3">{data.classes.find((entry) => entry.id === item.classId)?.name ?? "—"}</td><td className="p-3">{data.teachers.find((entry) => entry.id === item.teacherId)?.fullName ?? "—"}</td><td className="p-3">{data.subjects.find((entry) => entry.id === item.subjectId)?.name ?? "—"}</td><td className="p-3">{data.rooms.find((entry) => entry.id === item.roomId)?.name ?? "—"}</td></tr>)}</tbody></table></div>{confirmPublish && <AdminDrawer title="Publier cet horaire ?" closeLabel="Fermer" onClose={() => !busy && setConfirmPublish(false)}><p>Cette version deviendra l’horaire actif visible par les utilisateurs autorisés.</p><div className="grid grid-cols-2 gap-2"><button className="secondary-button justify-center" disabled={busy} onClick={() => setConfirmPublish(false)}>Annuler</button><button className="primary-button justify-center" disabled={busy} onClick={() => void publish()}>{busy ? "Publication…" : "Publier"}</button></div></AdminDrawer>}</section>;
}
