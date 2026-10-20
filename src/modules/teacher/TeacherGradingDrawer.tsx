import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminDrawer } from "../../components/ui/AdminDrawer";
import { userFacingError } from "../../utils/userFacingError";
import type { AppUser, School, SchoolYear } from "../../types";
import {
  applicableGradingConfig,
  activeStudentsForAssignment,
  changedGradeEntries,
  editableGradingSlots,
  gradingProgress,
  gradingSlotLabels,
  hasUnsavedGradeDrafts,
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
  loadTeacherConsolidatedGrades,
  loadTeacherGradingRoster,
  saveTeacherGradeEntries,
  saveTeacherGradingConfig,
  type TeacherGradingData,
  type ConsolidatedGradingData,
} from "./teacherGradingService";
import { buildConsolidatedClassReport } from "./consolidatedGrades";
import { ConsolidatedGradesView } from "./ConsolidatedGradesView";
import { useTeacherGradingRoster } from "./useTeacherGradingRoster";
import type { TeacherPortalData } from "./teacherPortalData";
import { exportTeacherGradesPdf } from "./teacherGradingPdf";

type Draft = { score: string; status: GradeEntry["status"] };
type PendingTransition = { type: "close" | "assignment" | "slot" | "titular"; value?: string };

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
  const [pendingTransition, setPendingTransition] = useState<PendingTransition | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const exportingPdfRef = useRef(false);
  const [confirmation, setConfirmation] = useState<"maximum" | "grade" | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [titularView, setTitularView] = useState(false);
  const [titularClassId, setTitularClassId] = useState("");
  const [showConsolidated, setShowConsolidated] = useState(false);
  const [consolidatedData, setConsolidatedData] = useState<ConsolidatedGradingData>();
  const [consolidatedLoading, setConsolidatedLoading] = useState(false);
  const [consolidatedError, setConsolidatedError] = useState("");
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
      setError(userFacingError(cause, "Chargement impossible."));
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
  const config = applicableGradingConfig(data?.configs ?? [], assignment?.classId ?? "", assignment?.subjectId ?? "", slot, school.id, year.id);
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
  const hasUnsavedChanges = hasUnsavedGradeDrafts(students, entries, drafts);

  function applyTransition(transition: PendingTransition) {
    setConfirmation(null); setConfirmationText(""); setError("");
    if (transition.type === "close") onClose();
    else if (transition.type === "assignment") setAssignmentId(transition.value ?? "");
    else if (transition.type === "slot") setSlot(transition.value as EditableGradingSlot);
    else setTitularView(transition.value === "true");
  }

  function requestTransition(transition: PendingTransition) {
    if (savingRef.current) return;
    if (hasUnsavedChanges) setPendingTransition(transition);
    else applyTransition(transition);
  }

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedChanges]);

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
    const prior = draftContext.current;
    draftContext.current = { assignmentId: assignment?.id ?? "", slot, entries };
    setDrafts((previous) => reconcileGradeDrafts(students, entries, previous,
      !prior || prior.assignmentId !== assignment?.id || prior.slot !== slot || (prior.entries !== entries && !hasUnsavedGradeDrafts(students, prior.entries, previous))));
  }, [assignment?.id, entries, slot, students]);

  const titular = data?.titulars.find((item) => item.classId === titularClassId) ?? data?.titulars[0];
  useEffect(() => {
    if (!showConsolidated || !titular?.classId) return;
    let cancelled = false;
    setConsolidatedData(undefined);
    setConsolidatedLoading(true);
    setConsolidatedError("");
    loadTeacherConsolidatedGrades(school.id, year.id, titular.classId).then((loaded) => {
      if (!cancelled) setConsolidatedData(loaded);
    }).catch((cause: unknown) => {
      if (!cancelled) setConsolidatedError(cause instanceof Error ? cause.message : "Fiche consolidée indisponible.");
    }).finally(() => { if (!cancelled) setConsolidatedLoading(false); });
    return () => { cancelled = true; };
  }, [showConsolidated, titular?.classId, school.id, year.id]);
  const consolidatedReport = useMemo(() => consolidatedData ? buildConsolidatedClassReport({
    schoolId: school.id, schoolYearId: year.id, classId: consolidatedData.classId,
    students: consolidatedData.students, classes: consolidatedData.classes, subjects: consolidatedData.subjects,
    assignments: consolidatedData.assignments, configs: consolidatedData.configs, entries: consolidatedData.entries,
  }) : undefined, [consolidatedData, school.id, year.id]);

  async function saveMax() {
    if (!assignment || !data || savingRef.current || loading || confirmation !== "maximum" || confirmationText !== maxScoreConfirmation(Boolean(config))) return;
    const value = Number(maxScore);
    const message = validateMaxScore(value, data.entries.filter((item) => item.classId === assignment.classId && item.subjectId === assignment.subjectId && item.gradingSlot === slot));
    if (message) return setError(message);
    savingRef.current = true; setSaving(true); setError(""); setSuccess("");
    try {
      await saveTeacherGradingConfig({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, gradingSlot: slot, maxScore: value, confirmation: confirmationText });
      setSuccess("Cote maximale enregistrée.");
      setConfirmation(null); setConfirmationText("");
      setEditingMaxScore(false);
      await reload();
    } catch (cause) {
      setError(userFacingError(cause, "Enregistrement impossible."));
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
      await saveTeacherGradeEntries({ schoolId: school.id, schoolYearId: year.id, assignmentId: assignment.id, classId: assignment.classId, subjectId: assignment.subjectId, gradingSlot: slot, entries: payload });
      onClose();
    } catch (cause) {
      setError(userFacingError(cause, "Enregistrement impossible."));
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
    } catch (cause) { setError(userFacingError(cause, "Export PDF impossible.")); }
    finally { exportingPdfRef.current = false; setExportingPdf(false); }
  }

  const confirmationPanel = (kind: "maximum" | "grade") => confirmation === kind && <section className="mt-2 grid gap-3 rounded border border-amber-300 bg-amber-50 p-3" aria-label="Confirmation de cotation">
    <h3 className="font-bold">{kind === "maximum" ? "Confirmer la cote maximale" : "Confirmer la modification des cotes"}</h3>
    <p className="text-sm">Saisissez exactement <strong>{kind === "maximum" ? maxScoreConfirmation(Boolean(config)) : "MODIFIER LA CÔTE"}</strong> pour confirmer.</p>
    <input className="input" aria-label="Phrase de confirmation" value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} autoComplete="off" autoFocus />
    <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => { setConfirmation(null); setConfirmationText(""); if (kind === "maximum") { setEditingMaxScore(false); setMaxScore(config ? String(config.maxScore) : ""); } }}>Annuler</button><button type="button" className="primary-button justify-center" disabled={saving || confirmationText !== (kind === "maximum" ? maxScoreConfirmation(Boolean(config)) : "MODIFIER LA CÔTE")} onClick={() => void (kind === "maximum" ? saveMax() : saveEntries(true))}>Confirmer</button></div>
  </section>;

  const renderTitularView = () => {
    if (!data?.titulars.length) return <section className="rounded bg-slate-50 p-4"><h3 className="font-bold">Aucune classe titulaire</h3><p className="mt-2">Vous n'êtes actuellement titulaire d'aucune classe pour l'année scolaire en cours.</p><p className="mt-2">Pour toute information concernant l'attribution d'une classe titulaire, veuillez contacter l'administration de votre établissement.</p></section>;
    const className = data.classes.find((item) => item.id === titular?.classId)?.name ?? titular?.classId;
    return <section className="grid gap-3">
      <p className="rounded bg-blue-50 p-3 text-sm">Fiche consolidée automatique en lecture seule. Les cotations restent modifiables uniquement par leur enseignant propriétaire.</p>
      {data.titulars.length > 1 && <label className="grid gap-1 text-sm font-semibold">Classe titulaire<select className="input" value={titular?.classId} onChange={(event) => { setTitularClassId(event.target.value); setShowConsolidated(false); }}>{data.titulars.map((item) => <option key={item.id} value={item.classId}>{data.classes.find((candidate) => candidate.id === item.classId)?.name ?? item.classId}</option>)}</select></label>}
      <article className="rounded border bg-white p-3">
        <b>{className}</b>
        {consolidatedReport && <p className="mt-2 text-sm">{consolidatedReport.students.length} élève(s) · {consolidatedReport.courses.length} cours</p>}
        <button type="button" className="secondary-button mt-3 w-full justify-center" onClick={() => setShowConsolidated(true)}>Voir la fiche consolidée</button>
      </article>
    </section>;
  };

  return <>{!showConsolidated && <AdminDrawer title="Fiche de cotation" closeLabel="Fermer la fiche de cotation" onClose={() => requestTransition({ type: "close" })}>
    {pendingTransition && <section className="grid gap-3 rounded border border-amber-300 bg-amber-50 p-3" role="alertdialog" aria-label="Modifications non enregistrées">
      <p>Des cotes modifiées ne sont pas enregistrées. Voulez-vous abandonner ces modifications ?</p>
      <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" onClick={() => setPendingTransition(null)}>Revenir au formulaire</button><button type="button" className="primary-button justify-center" onClick={() => { const next = pendingTransition; setPendingTransition(null); applyTransition(next); }}>Abandonner les modifications</button></div>
    </section>}
    {loading && <p role="status" className="rounded bg-slate-50 p-4">Chargement…</p>}
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{error}</p>}
    {rosterError && <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{rosterError}</p>}
    {success && <p role="status" className="rounded bg-green-50 p-3 text-green-800">{success}</p>}
    {data && !loadFailed && <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2"><button type="button" className={titularView ? "secondary-button w-full justify-center" : "primary-button w-full justify-center"} onClick={() => requestTransition({ type: "titular", value: "false" })}>Mes cotations</button><button type="button" className={titularView ? "primary-button w-full justify-center" : "secondary-button w-full justify-center"} onClick={() => requestTransition({ type: "titular", value: "true" })}>Ma classe titulaire</button></div>
      {titularView ? renderTitularView() : assignments.length === 0 ? <p className="rounded bg-slate-50 p-4">Aucun cours ne vous a encore été affecté par la Direction des études.</p> : <>
        <label className="grid gap-1 text-sm font-semibold">Cours<select className="input" value={assignment?.id} disabled={saving} onChange={(event) => requestTransition({ type: "assignment", value: event.target.value })}>{assignments.map((item) => <option key={item.id} value={item.id}>{data.subjects.find((candidate) => candidate.id === item.subjectId)?.name} — {data.classes.find((candidate) => candidate.id === item.classId)?.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-semibold">Période<select className="input" value={slot} disabled={saving} onChange={(event) => requestTransition({ type: "slot", value: event.target.value })}>{editableGradingSlots.map((value) => <option key={value} value={value}>{gradingSlotLabels[value]}</option>)}</select></label>
        <div className="rounded border bg-white p-3"><p className="font-bold">{subject?.name} — {schoolClass?.name} · {gradingSlotLabels[slot]}</p><div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]"><input className="input" type="number" min="0.01" step="0.01" aria-label="Cote maximale" value={maxScore} readOnly={Boolean(config) && !editingMaxScore} onChange={(event) => setMaxScore(event.target.value)} /><button type="button" className="secondary-button justify-center" disabled={saving} onClick={() => { setEditingMaxScore(true); setConfirmation("maximum"); setConfirmationText(""); setSuccess(""); }}>{maxScoreActionLabel(Boolean(config))}</button></div>{confirmationPanel("maximum")}</div>
        <p className="text-sm font-semibold">{progress.graded} / {progress.total} élèves cotés · {progress.status}</p>
        {!config ? <p className="rounded bg-amber-50 p-3 text-sm">Définissez la cote maximale de ce cours avant de commencer la cotation.</p> : students.length === 0 ? <p className="rounded bg-slate-50 p-3">Aucun élève actif n’est inscrit dans cette classe.</p> : <div className="grid gap-2">{students.map((student) => {
          const value = drafts[student.id] ?? { score: "", status: "not_graded" as const };
          return <article key={student.id} className="grid gap-2 rounded border bg-white p-3 sm:grid-cols-[minmax(0,1fr)_120px_130px] sm:items-center"><span className="font-semibold">{student.nom} {student.postnom} {student.prenom}</span><input aria-label={`Cote de ${student.nom}`} className="input" type="number" min="0" max={config.maxScore} step="0.01" value={value.score} disabled={saving || confirmation === "grade" || value.status === "absent"} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { ...value, score: event.target.value, status: event.target.value === "" ? "not_graded" : "graded" } }))} /><select aria-label={`Statut de ${student.nom}`} className="input" value={value.status} disabled={saving || confirmation === "grade"} onChange={(event) => setDrafts((current) => ({ ...current, [student.id]: { score: event.target.value === "graded" ? value.score : "", status: event.target.value === "graded" && value.score === "" ? "not_graded" : event.target.value as GradeEntry["status"] } }))}>{value.status === "absent" && <option value="absent" disabled>Absent (historique)</option>}<option value="not_graded">Non coté</option><option value="graded" disabled={value.score === ""}>Coté</option></select></article>;
        })}<div><div className="grid grid-cols-2 gap-2"><button type="button" className="primary-button justify-center" disabled={saving} onClick={() => void saveEntries()}>{saving ? "Enregistrement…" : "Enregistrer"}</button><button type="button" className="pdf-export-button justify-center" disabled={saving || exportingPdf} aria-busy={exportingPdf} onClick={() => void exportPdf()}>{exportingPdf ? "Chargement…" : "Exporter PDF"}</button></div>{confirmationPanel("grade")}</div></div>}
      </>}
    </div>}
  </AdminDrawer>}
    {showConsolidated && <AdminDrawer width="wide" title="Fiche consolidée" closeLabel="Revenir à Ma classe titulaire" onClose={() => setShowConsolidated(false)}>
      {consolidatedLoading ? <p role="status">Chargement de la fiche consolidée…</p>
        : consolidatedError ? <p role="alert" className="rounded bg-red-50 p-3 text-red-700">{consolidatedError}</p>
          : consolidatedReport ? <ConsolidatedGradesView report={consolidatedReport} school={school} year={year} className={data?.classes.find((item) => item.id === titular?.classId)?.name ?? "Classe titulaire"} /> : <p>Aucune fiche disponible.</p>}
    </AdminDrawer>}
  </>;
}
