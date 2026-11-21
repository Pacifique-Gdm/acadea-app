import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit3, Eye, GraduationCap, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { StudentRecordDrawer, type StudentRecordTarget } from "../../components/students/StudentRecordDrawer";
import { AdminDrawer, IconButton, SectionTitle } from "../../components/ui";
import { requestTerminalStudentCompletion, requestTerminalStudentReenrollment } from "../../services/provisioning";
import { createAuditLog } from "../../utils/audit";
import { getSchoolClassChoices, getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { schoolOptionDisplayName } from "../../utils/schoolOptions";
import { getClassSection } from "../../utils/studentClasses";
import { isArchivedStudent, studentForPersistence } from "../../utils/studentUtils";
import { exportStudentsPdf } from "../../utils/studentPdf";
import { displayStudentBirthDate } from "../../utils/studentBirthDate";
import type { AppData, AppUser, School, SchoolSection, SchoolYear, Student } from "../../types";
import type { SchoolClassRecord } from "../../types";
import { formatOperationalStudentClassName, subscribeToSchoolClasses } from "../../services/schoolSubclasses";
import { canonicalAnnualClassName, isEligibleForAnnualTransition, isImmediatelyPreviousArchivedYear, studentImportKey } from "../../utils/studentYearTransition.js";
import { useStudentPage } from "../../hooks/useStudentPage";
import { countStudentStatusesWithFallback, loadAllStudentResults, STUDENT_SOURCE_PAGE_SIZE, studentQueryKey, type StudentArchiveFilter, type StudentQueryFilters } from "../../services/studentPagination";
import { missingSexNotice, studentStatusChoices, studentStatusLabel, useStudentStatusCounts } from "../../hooks/useStudentStatusCounts";
import { studentOptionFilterChoices } from "./studentOptionFilterChoices";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";

export interface StudentModuleCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReactivate: boolean;
  canCreateParent: boolean;
  canManageOptions: boolean;
}

const STUDENTS_PAGE_SIZE = STUDENT_SOURCE_PAGE_SIZE;

export function StudentsModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onOpenStudent,
  uid,
  formatArchiveDate,
  capabilities,
  allowedSections,
}: {
  user: AppUser;
  data: AppData;
  yearData: Pick<AppData, "students" | "parents">;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onOpenStudent: (studentId: string) => void;
  uid: (prefix: string) => string;
  formatArchiveDate: (value?: string) => string;
  capabilities?: Partial<StudentModuleCapabilities>;
  allowedSections?: SchoolSection[];
}) {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
  const [classFilter, setClassFilter] = useState("");
  const [optionFilter, setOptionFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<StudentArchiveFilter>("all");
  const [recordTarget, setRecordTarget] = useState<StudentRecordTarget | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [structuredClasses, setStructuredClasses] = useState<SchoolClassRecord[]>([]);
  const [structuredClassesLoaded, setStructuredClassesLoaded] = useState(false);
  const [archiveStudentId, setArchiveStudentId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOtherReason, setArchiveOtherReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [reactivationStudentId, setReactivationStudentId] = useState<string | null>(null);
  const [reactivationReason, setReactivationReason] = useState("");
  const [reactivationOtherReason, setReactivationOtherReason] = useState("");
  const [reactivationError, setReactivationError] = useState("");
  const [terminalStudent, setTerminalStudent] = useState<Student>();
  const [terminalAction, setTerminalAction] = useState<"complete" | "reenroll">("reenroll");
  const [terminalConfirmation, setTerminalConfirmation] = useState("");
  const [terminalExamConfirmed, setTerminalExamConfirmed] = useState(false);
  const [terminalError, setTerminalError] = useState("");
  const [terminalFeedback, setTerminalFeedback] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const pdfExportLock = useRef(false);
  const [terminalDecisions, setTerminalDecisions] = useState<Record<string, "completed" | "reenrolled">>({});
  const defaultCanManage = user.role === "school_admin" && year.status !== "archived";
  const studentCapabilities: StudentModuleCapabilities = {
    canCreate: year.status === "active" && (capabilities?.canCreate ?? defaultCanManage),
    canEdit: year.status === "active" && (capabilities?.canEdit ?? defaultCanManage),
    canArchive: year.status === "active" && (capabilities?.canArchive ?? defaultCanManage),
    canReactivate: year.status === "active" && (capabilities?.canReactivate ?? defaultCanManage),
    canCreateParent: year.status === "active" && (capabilities?.canCreateParent ?? defaultCanManage),
    canManageOptions: year.status === "active" && (capabilities?.canManageOptions ?? defaultCanManage),
  };
  const activeTargetYear = data.schoolYears.find((item) => item.id === school.activeSchoolYearId && item.schoolId === school.id && item.status === "active");
  const canDecideTerminal = ["school_admin", "secretary"].includes(user.role) && user.status === "active" && user.active !== false && !user.archivedAt && user.schoolId === school.id && isImmediatelyPreviousArchivedYear(year, activeTargetYear);
  const showActionsColumn = studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate || canDecideTerminal;
  const studentSectionChoices = getSchoolSections(school).filter((section) => !allowedSections?.length || allowedSections.includes(section));
  const studentClassChoices = getSchoolClassChoices(school).filter((className) => studentSectionChoices.includes(getClassSection(className)));
  const availableClasses = studentClassChoices.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);
  const filterOptionChoices = useMemo(() => studentOptionFilterChoices({ school, schoolYearId: year.id, records: structuredClasses, students: yearData.students, section: sectionFilter, className: classFilter }), [school, year.id, structuredClasses, yearData.students, sectionFilter, classFilter]);
  const effectiveOptionFilter = structuredClassesLoaded && !filterOptionChoices.includes(optionFilter) ? "" : optionFilter;

  useEffect(() => {
    setStructuredClassesLoaded(false);
    return subscribeToSchoolClasses(school.id, year.id, (items) => { setStructuredClasses(items); setStructuredClassesLoaded(true); }, (cause) => { setStructuredClassesLoaded(false); setSaveError(userFacingError(cause, "Chargement impossible. Veuillez réessayer.")); });
  }, [school.id, year.id]);
  useEffect(() => {
    if (sectionFilter !== "all" && !studentSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [studentSectionChoices, sectionFilter]);
  useEffect(() => { setClassFilter(""); setOptionFilter(""); }, [school.id, year.id]);
  useEffect(() => {
    if (structuredClassesLoaded && optionFilter && !filterOptionChoices.includes(optionFilter)) setOptionFilter("");
  }, [filterOptionChoices, optionFilter, structuredClassesLoaded]);
  useEffect(() => {
    if (!saveError && !saveMessage) return;
    const timer = window.setTimeout(() => {
      setSaveError("");
      setSaveMessage("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [saveError, saveMessage]);

  const deferredQuery = useDeferredValue(query);
  const allowedSectionsKey = (allowedSections ?? []).join("|");
  const studentFilters = useMemo<StudentQueryFilters>(() => ({
    schoolId: school.id,
    schoolYearId: year.id,
    search: deferredQuery,
    archive: archiveFilter,
    section: sectionFilter,
    className: classFilter,
    option: effectiveOptionFilter,
    allowedSections: allowedSectionsKey ? allowedSectionsKey.split("|") as SchoolSection[] : undefined,
  }), [allowedSectionsKey, archiveFilter, classFilter, deferredQuery, effectiveOptionFilter, school.id, sectionFilter, year.id]);
  const studentPage = useStudentPage(studentFilters, yearData.students);
  // Nombre d'élèves pour chaque choix (Tous, Actifs, Archivés, Filles, Garçons), avec les autres filtres.
  const statusCounts = useStudentStatusCounts(studentQueryKey({ ...studentFilters, archive: "all" }), () => countStudentStatusesWithFallback(studentFilters, yearData.students));
  const students = studentPage.students;
  const visibleStudents = students;
  const page = studentPage.page;
  const pageCount = studentPage.pageCount;
  const studentRecords = useMemo(() => {
    const records = new Map(data.students.map((student) => [student.id, student]));
    students.forEach((student) => records.set(student.id, student));
    return [...records.values()];
  }, [data.students, students]);
  const archiveStudent = archiveStudentId ? studentRecords.find((student) => student.id === archiveStudentId) : undefined;
  const reactivationStudent = reactivationStudentId ? studentRecords.find((student) => student.id === reactivationStudentId) : undefined;
  const archiveReasonChoices = ["Abandon", "Mutation", "Exclusion", "Décès", "Fin de scolarité", "Erreur administrative", "Autre"] as const;
  const reactivationReasonChoices = ["Retour à l'école", "Erreur d'archivage", "Réinscription", "Mutation annulée", "Suspension levée", "Décision administrative", "Autre"] as const;
  const finalArchiveReason = archiveReason === "Autre" ? archiveOtherReason.trim() : archiveReason;
  const finalReactivationReason = reactivationReason === "Autre" ? reactivationOtherReason.trim() : reactivationReason;

  function canDecide(student: Student) {
    if (!canDecideTerminal || !activeTargetYear || student.schoolYearId !== year.id || canonicalAnnualClassName(student.className) !== "4ème Humanité" || !isEligibleForAnnualTransition(student) || student.terminalDecision || terminalDecisions[student.id]) return false;
    return !data.students.some((item) => item.schoolId === school.id && item.schoolYearId === activeTargetYear.id
      && (item.importedFromStudentId === student.id || studentImportKey(item) === studentImportKey(student)));
  }

  async function decideTerminal() {
    const expected = terminalAction === "complete" ? "CONFIRMER LA FIN DE SCOLARITE" : "REINSCRIRE CET ELEVE";
    if (!terminalStudent || !canDecide(terminalStudent) || terminalConfirmation !== expected || !terminalExamConfirmed || terminalBusy) return;
    setTerminalBusy(true); setTerminalError(""); setTerminalFeedback("");
    try {
      const result = terminalAction === "complete"
        ? await requestTerminalStudentCompletion({ schoolId: school.id, sourceStudentId: terminalStudent.id, confirmation: terminalConfirmation, examResultConfirmed: true })
        : await requestTerminalStudentReenrollment({ schoolId: school.id, sourceStudentId: terminalStudent.id, mode: "reenroll", confirmation: terminalConfirmation, examResultConfirmed: true });
      if (result.status === "completed" || result.status === "already-completed" || result.status === "reenrolled") {
        setTerminalDecisions((current) => ({ ...current, [terminalStudent.id]: terminalAction === "complete" ? "completed" : "reenrolled" }));
      }
      setTerminalFeedback(terminalAction === "complete" ? "Fin de scolarité confirmée." : result.status === "already-reenrolled"
        ? "Cet élève est déjà inscrit pour l’année scolaire active."
        : `Élève réinscrit en 4ème Humanité pour l’année scolaire ${activeTargetYear?.name ?? "active"}.`);
      setTerminalStudent(undefined); setTerminalConfirmation(""); setTerminalExamConfirmed(false);
    } catch (cause) {
      setTerminalError(userFacingError(cause, "Réinscription impossible."));
    } finally { setTerminalBusy(false); }
  }

  function openAddStudentForm() {
    if (!studentCapabilities.canCreate) return;
    setSaveError("");
    setSaveMessage("");
    setRecordTarget({ mode: "create" });
  }

  function openEditStudentForm(student: Student) {
    if (!studentCapabilities.canEdit || isArchivedStudent(student)) return;
    setSaveError("");
    setSaveMessage("");
    setRecordTarget({ mode: "edit", student });
  }

  function removeStudent(id: string) {
    if (!studentCapabilities.canArchive) return;
    setArchiveStudentId(id);
    setArchiveReason("");
    setArchiveOtherReason("");
    setArchiveError("");
  }

  function closeArchiveStudentDialog() {
    setArchiveStudentId(null);
    setArchiveReason("");
    setArchiveOtherReason("");
    setArchiveError("");
  }

  function confirmArchiveStudent() {
    const id = archiveStudentId;
    if (!id) return;
    const student = studentRecords.find((item) => item.id === id);
    if (!student) return;
    const reason = finalArchiveReason;
    if (!archiveReason || !reason) {
      setArchiveError(archiveReason === "Autre" ? "Veuillez préciser le motif d'archivage." : "Le motif d'archivage est obligatoire.");
      return;
    }
    const normalized = reason.toLowerCase();
    const status = normalized.includes("décès") || normalized.includes("deces") ? "DECEASED" : normalized.includes("abandon") ? "DROPPED" : "TRANSFERRED";
    updateData({
      students: studentRecords.map((item) =>
        item.id === id
          ? studentForPersistence({
              ...item,
              status,
              exitReason: archiveReason as Student["exitReason"],
              exitReasonDetails: reason,
              deletedAt: new Date().toISOString(),
            })
          : item,
      ),
      auditLogs: [createAuditLog(user, school.id, year.id, "Archivage élève", `${student.matricule} - ${reason}`, uid), ...data.auditLogs],
    });
    closeArchiveStudentDialog();
  }

  function openReactivateStudentDialog(id: string) {
    if (!studentCapabilities.canReactivate) return;
    setReactivationStudentId(id);
    setReactivationReason("");
    setReactivationOtherReason("");
    setReactivationError("");
  }

  function closeReactivateStudentDialog() {
    setReactivationStudentId(null);
    setReactivationReason("");
    setReactivationOtherReason("");
    setReactivationError("");
  }

  function reactivateStudent() {
    const id = reactivationStudentId;
    const reason = finalReactivationReason;
    if (!id) return;
    if (!reactivationReason || !reason) {
      setReactivationError(reactivationReason === "Autre" ? "Veuillez préciser la raison de réactivation." : "Le motif de réactivation est obligatoire.");
      return;
    }
    const student = studentRecords.find((item) => item.id === id);
    if (!student) return;
    updateData({
      students: studentRecords.map((item) =>
        item.id === id
          ? (() => {
              const activeStudent = { ...item, status: "ACTIVE" as const };
              delete activeStudent.exitReason;
              delete activeStudent.exitReasonDetails;
              delete activeStudent.deletedAt;
              return studentForPersistence(activeStudent);
            })()
          : item,
      ),
      auditLogs: [createAuditLog(user, school.id, year.id, "Réactivation élève", `${student.matricule} - ${student.nom} ${student.prenom} - ${reason}`, uid), ...data.auditLogs],
    });
    closeReactivateStudentDialog();
  }

  async function printStudentsPdf() {
    if (pdfExportLock.current) return;
    pdfExportLock.current = true;
    const filters = [
      `Recherche: ${query || "Toutes"}`,
      `Statut: ${archiveFilter === "active" ? "Actifs" : archiveFilter === "archived" ? "Archivés" : archiveFilter === "girls" ? "Filles (actives)" : archiveFilter === "boys" ? "Garçons (actifs)" : "Tous"}`,
      `Section: ${sectionFilter === "all" ? "Toutes les sections" : schoolSectionLabels[sectionFilter]}`,
      `Classe: ${classFilter || "Toutes les classes"}`,
      `Option: ${effectiveOptionFilter || "Toutes les options"}`,
    ];
    setIsExporting(true);
    setPdfError("");
    try {
      const exportStudents = await loadAllStudentResults(studentFilters, yearData.students);
      await exportStudentsPdf(school, year, exportStudents, filters, structuredClasses);
    } catch (cause) {
      setPdfError(userFacingError(cause, "Impossible de charger les élèves à exporter."));
    } finally {
      pdfExportLock.current = false;
      setIsExporting(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0">
        <SectionTitle title="Élèves" subtitle="Ajouter, modifier, rechercher et filtrer par direction puis classe." />
        {saveMessage && <p className="mb-3 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{saveMessage}</p>}
        <div className="mb-3 w-full min-w-0 max-w-full">
          <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 box-border sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center">
          {studentCapabilities.canCreate && (
            <button onClick={openAddStudentForm} type="button" className="primary-button min-w-0 justify-center whitespace-normal sm:whitespace-nowrap lg:flex-1 lg:basis-0">
              <Plus className="h-4 w-4" /> Ajouter un élève
            </button>
          )}
          <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" className="min-w-0 flex-1 outline-none" />
          </label>
          <select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            {/* Ordre voulu partout : Tous, Actifs, Archivés, Filles, Garçons. */}
            {studentStatusChoices.map((choice) => <option key={choice} value={choice}>{studentStatusLabel(choice, statusCounts)}</option>)}
          </select>
          <select
            value={sectionFilter}
            onChange={(event) => {
              setSectionFilter(event.target.value as typeof sectionFilter);
              setClassFilter("");
              setOptionFilter("");
            }}
            className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0"
          >
            <option value="all">Toutes les sections</option>
            {studentSectionChoices.map((section) => (
              <option key={section} value={section}>{schoolSectionLabels[section]}</option>
            ))}
          </select>
          <select value={classFilter} onChange={(event) => { setClassFilter(event.target.value); setOptionFilter(""); }} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            <option value="">Toutes les classes</option>
            {availableClasses.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          <select value={effectiveOptionFilter} onChange={(event) => setOptionFilter(event.target.value)} disabled={!structuredClassesLoaded || filterOptionChoices.length === 0} aria-label="Option" className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            <option value="">{filterOptionChoices.length ? "Toutes les options" : "Aucune option disponible"}</option>
            {filterOptionChoices.map((option) => (
              <option key={option} value={option}>{schoolOptionDisplayName(school, option)}</option>
            ))}
          </select>
          <button onClick={() => void printStudentsPdf()} disabled={isExporting} type="button" className="pdf-export-button min-w-0 px-3 lg:flex-1 lg:basis-0">
            <Download className="h-4 w-4" /> {isExporting ? "Chargement…" : "Exporter PDF"}
          </button>
          </div>
        </div>
        {structuredClassesLoaded && filterOptionChoices.length === 0 && <p role="status" className="mb-3 text-sm text-slate-600">{classFilter ? "Aucune option disponible pour la classe sélectionnée." : sectionFilter !== "all" ? "Aucune option disponible pour cette section." : "Aucune option disponible pour les classes accessibles."}</p>}
        <ErrorNotice error={pdfError} onRetry={() => void printStudentsPdf()} />
        {missingSexNotice(statusCounts) && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{missingSexNotice(statusCounts)}</p>}
        {studentPage.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Impossible de charger les élèves : {studentPage.error}</p>}
        {studentPage.loading && <p className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-500">Chargement des élèves…</p>}
        <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Nom complet</th>
                <th className="px-3 py-3">Statut</th>
                <th className="px-3 py-3">Sexe</th>
                <th className="px-3 py-3">Classe</th>
                <th className="px-3 py-3">Date de naissance</th>
                <th className="px-3 py-3">Archivage</th>
                {showActionsColumn && <th className="px-3 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((student) => {
                const archived = isArchivedStudent(student);
                return (
                <tr key={student.id} className={`border-t border-slate-100 ${archived ? "bg-slate-50/70" : ""}`}>
                  <td className="px-3 py-3 font-semibold text-ink">{student.matricule}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => onOpenStudent(student.id)} className="text-left font-semibold text-ink hover:text-blue-700 hover:underline">
                      {student.nom} {student.postnom} {student.prenom}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    {archived ? (
                      <span className="inline-block max-w-[260px] break-words text-xs font-semibold text-ink">
                        {student.exitReasonDetails ?? student.exitReason ?? "Motif non renseigné"}
                      </span>
                    ) : (
                      canDecideTerminal && canonicalAnnualClassName(student.className) === "4ème Humanité"
                        ? <span className="text-xs font-semibold text-slate-700">{terminalDecisions[student.id] === "completed" || student.terminalDecision?.type === "completed" ? "Fin de scolarité confirmée" : terminalDecisions[student.id] === "reenrolled" || student.terminalDecision?.type === "reenrolled" ? "Réinscrit en 4ème Humanité" : "En attente de décision"}</span>
                        : <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Actif</span>
                    )}
                  </td>
                  <td className="px-3 py-3">{student.sexe}</td>
                  <td className="px-3 py-3">{formatOperationalStudentClassName({ ...student, option: student.option ? schoolOptionDisplayName(school, student.option) : student.option }, structuredClasses)}</td>
                  <td className="px-3 py-3">{displayStudentBirthDate(student.birthDate)}</td>
                  <td className="px-3 py-3">
                    {archived ? (
                      <div className="max-w-[260px] text-xs text-slate-600">
                        <p className="inline-flex rounded bg-slate-200 px-2 py-1 font-semibold text-slate-700">Archivé</p>
                        <p className="mt-1 text-slate-500">{formatArchiveDate(student.deletedAt)}</p>
                      </div>
                    ) : (
                      <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Actif</span>
                    )}
                  </td>
                  {showActionsColumn && <td className="px-3 py-3">
                    {studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate || canDecide(student) ? (
                      <div className="flex flex-wrap gap-1">
                        {archived ? (
                          <>
                            <IconButton label="Consulter" onClick={() => onOpenStudent(student.id)} icon={Eye} />
                            {studentCapabilities.canReactivate && <IconButton label="Réactiver l'élève" onClick={() => openReactivateStudentDialog(student.id)} icon={RefreshCw} />}
                          </>
                        ) : (
                          <>
                            {studentCapabilities.canEdit && <IconButton label="Modifier" onClick={() => openEditStudentForm(student)} icon={Edit3} />}
                            {studentCapabilities.canArchive && <IconButton label="Archiver" onClick={() => removeStudent(student.id)} icon={Trash2} danger />}
                          </>
                        )}
                        {canDecide(student) && <>
                          <button type="button" title="Confirmer la fin de scolarité" aria-label="Confirmer la fin de scolarité" className="grid h-10 w-10 place-items-center rounded bg-slate-100 text-slate-700" onClick={() => { setTerminalAction("complete"); setTerminalStudent(student); setTerminalConfirmation(""); setTerminalExamConfirmed(false); setTerminalError(""); }}><GraduationCap className="h-5 w-5" /></button>
                          <button type="button" title="Réinscrire en 4ème Humanité" aria-label="Réinscrire en 4ème Humanité" className="grid h-10 w-10 place-items-center rounded bg-slate-100 text-slate-700" onClick={() => { setTerminalAction("reenroll"); setTerminalStudent(student); setTerminalConfirmation(""); setTerminalExamConfirmed(false); setTerminalError(""); }}><RefreshCw className="h-5 w-5" /></button>
                        </>}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">{terminalDecisions[student.id] === "completed" || student.terminalDecision?.type === "completed" ? "Fin de scolarité confirmée" : terminalDecisions[student.id] === "reenrolled" || student.terminalDecision?.type === "reenrolled" ? "Réinscrit en 4ème Humanité" : canDecideTerminal && canonicalAnnualClassName(student.className) === "4ème Humanité" ? "En attente de décision" : "Lecture seule"}</span>
                    )}
                  </td>}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {studentPage.total > STUDENTS_PAGE_SIZE && (
          <nav aria-label="Pagination des élèves" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{studentPage.total} élèves · page {page}/{pageCount}</span>
            <div className="flex gap-2">
              <button type="button" className="secondary-button" disabled={page === 1 || studentPage.loading} onClick={studentPage.previous}>Précédent</button>
              <button type="button" className="secondary-button" disabled={page === pageCount || studentPage.loading} onClick={studentPage.next}>Suivant</button>
            </div>
          </nav>
        )}
      </div>
      {(studentCapabilities.canCreate || studentCapabilities.canEdit) && recordTarget && (
        <StudentRecordDrawer
          data={data}
          school={school}
          year={year}
          updateData={updateData}
          uid={uid}
          target={recordTarget}
          capabilities={studentCapabilities}
          studentRecords={studentRecords}
          parents={yearData.parents}
          classChoices={studentClassChoices}
          structuredClasses={structuredClasses}
          structuredClassesLoaded={structuredClassesLoaded}
          loadError={saveError}
          onClose={() => setRecordTarget(null)}
          onSaved={(_student, message) => { setRecordTarget(null); setSaveMessage(message); }}
        />
      )}
      {studentCapabilities.canArchive && archiveStudent && (
        <AdminDrawer title="Archiver l'élève" onClose={closeArchiveStudentDialog} closeLabel="Fermer l'archivage">
          <div className="grid min-w-0 gap-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">
                {archiveStudent.nom} {archiveStudent.postnom} {archiveStudent.prenom}
              </p>
              <p className="mt-1">Motif obligatoire : choisissez un motif d'archivage dans la liste.</p>
            </div>
            <ErrorNotice error={archiveError} onRetry={() => void confirmArchiveStudent()} />
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
              Motif d'archivage
              <select
                value={archiveReason}
                onChange={(event) => {
                  setArchiveReason(event.target.value);
                  setArchiveOtherReason("");
                  setArchiveError("");
                }}
                className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="" disabled hidden>Sélectionner un motif</option>
                {archiveReasonChoices.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </label>
            {archiveReason === "Autre" && (
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                Précisez le motif
                <input
                  value={archiveOtherReason}
                  onChange={(event) => {
                    setArchiveOtherReason(event.target.value);
                    setArchiveError("");
                  }}
                  className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Motif personnalisé"
                />
              </label>
            )}
            {/* Version 1.15.2 : « Annuler » et « OK » se partagent toute la largeur, moitié-moitié. */}
            <div className="grid w-full grid-cols-2 gap-2" data-archive-actions>
              <button type="button" onClick={closeArchiveStudentDialog} className="secondary-button w-full justify-center">
                Annuler
              </button>
              <button type="button" onClick={confirmArchiveStudent} disabled={!archiveReason || !finalArchiveReason} className="primary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50">
                OK
              </button>
            </div>
          </div>
        </AdminDrawer>
      )}
      {studentCapabilities.canReactivate && reactivationStudent && (
        <AdminDrawer title="Réactiver l'élève" onClose={closeReactivateStudentDialog} closeLabel="Fermer la réactivation">
          <div className="grid min-w-0 gap-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">
                {reactivationStudent.nom} {reactivationStudent.postnom} {reactivationStudent.prenom}
              </p>
              <p className="mt-1">La réactivation nécessite un motif obligatoire et sera enregistrée dans l'historique.</p>
            </div>
            <ErrorNotice error={reactivationError} onRetry={() => void reactivateStudent()} />
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
              Motif de réactivation
              <select
                value={reactivationReason}
                onChange={(event) => {
                  setReactivationReason(event.target.value);
                  setReactivationOtherReason("");
                  setReactivationError("");
                }}
                className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="" disabled hidden>Sélectionner un motif</option>
                {reactivationReasonChoices.map((reason) => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </label>
            {reactivationReason === "Autre" && (
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                Précisez la raison
                <input
                  value={reactivationOtherReason}
                  onChange={(event) => {
                    setReactivationOtherReason(event.target.value);
                    setReactivationError("");
                  }}
                  className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Raison personnalisée"
                />
              </label>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeReactivateStudentDialog} className="secondary-button justify-center">
                Annuler
              </button>
              <button type="button" onClick={reactivateStudent} disabled={!reactivationReason || !finalReactivationReason} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
                Réactiver
              </button>
            </div>
          </div>
        </AdminDrawer>
      )}
      {terminalFeedback && <p role="status" className="fixed bottom-24 right-4 z-[80] max-w-sm rounded border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800 shadow-lg">{terminalFeedback}</p>}
      {terminalStudent && activeTargetYear && (
        <AdminDrawer title={terminalAction === "complete" ? "Confirmer la fin de scolarité" : "Réinscrire l’élève"} onClose={() => !terminalBusy && setTerminalStudent(undefined)} closeLabel="Fermer la décision">
          <div className="grid min-w-0 gap-4">
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {terminalAction === "complete" ? "Confirmer la fin de scolarité de " : "Réinscrire "}<strong>{terminalStudent.nom} {terminalStudent.postnom} {terminalStudent.prenom}</strong> (année source {year.name}){terminalAction === "reenroll" ? ` en 4ème Humanité pour l’année scolaire ${activeTargetYear.name} ?` : " après réussite officielle à l’Examen d’État ?"}
            </p>
            <ErrorNotice error={terminalError} onRetry={() => void decideTerminal()} />
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={terminalExamConfirmed} disabled={terminalBusy} onChange={(event) => setTerminalExamConfirmed(event.target.checked)} /><span>Je confirme avoir vérifié {terminalAction === "complete" ? "la réussite" : "l’échec"} de cet élève à l’Examen d’État.</span></label>
            <label className="grid gap-1 text-sm font-semibold">Phrase de confirmation
              <input className="input" value={terminalConfirmation} disabled={terminalBusy} placeholder={terminalAction === "complete" ? "CONFIRMER LA FIN DE SCOLARITE" : "REINSCRIRE CET ELEVE"} onChange={(event) => setTerminalConfirmation(event.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button justify-center" disabled={terminalBusy} onClick={() => setTerminalStudent(undefined)}>Annuler</button>
              <button type="button" className="primary-button justify-center" disabled={terminalBusy || !terminalExamConfirmed || terminalConfirmation !== (terminalAction === "complete" ? "CONFIRMER LA FIN DE SCOLARITE" : "REINSCRIRE CET ELEVE")} onClick={() => void decideTerminal()}>{terminalBusy ? "Enregistrement…" : terminalAction === "complete" ? "Confirmer la fin de scolarité" : "Réinscrire"}</button>
            </div>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
