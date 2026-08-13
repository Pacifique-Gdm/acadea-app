import { useEffect, useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import { AdminDrawer, Metric } from "../ui";
import { persistFirestorePatch } from "../../services/firestoreData";
import { createAuditLog } from "../../utils/audit";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { operationalSchoolClasses, subscribeToSchoolClasses } from "../../services/schoolSubclasses";
import { getClassSection, getStudentSection, promoteStudentForNewYear } from "../../utils/studentClasses";
import { exportAgeHomogeneityPdf } from "../../utils/studentPdf";
import { isArchivedStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, School, SchoolSection, SchoolYear, Student } from "../../types";

type SharedToolProps = {
  open: boolean;
  onClose: () => void;
  user: AppUser;
  data: AppData;
  school: School;
  year: SchoolYear;
};

export function ArchivedStudentsImportDrawer({
  open,
  onClose,
  user,
  data,
  school,
  year,
  updateData,
  createId,
  studentImportKey,
}: SharedToolProps & {
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  createId: (prefix: string) => string;
  studentImportKey: (student: Student) => string;
}) {
  const [sourceYearId, setSourceYearId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const canImport = user.role === "secretary" && user.status === "active" && user.schoolId === school.id && year.status !== "archived";
  const archivedYears = data.schoolYears.filter((item) => item.schoolId === school.id && item.status === "archived");
  const selectedYear = archivedYears.find((item) => item.id === sourceYearId);
  const selectedStudents = sourceYearId
    ? data.students.filter((student) => student.schoolId === school.id && student.schoolYearId === sourceYearId)
    : [];
  const studentsAlreadyImported = Boolean(year.studentsImportedFromArchivedYear);

  function closeDrawer() {
    if (isImporting) return;
    setSourceYearId("");
    setConfirmation("");
    setResult("");
    setError("");
    onClose();
  }

  async function importStudents() {
    if (!canImport || !selectedYear || isImporting) return;
    if (studentsAlreadyImported) {
      setError("Les élèves ont déjà été importés pour cette année scolaire. Cette opération ne peut être effectuée qu'une seule fois.");
      return;
    }
    if (confirmation !== "IMPORTER LES ELEVES") {
      setError("Phrase de confirmation incorrecte. Veuillez saisir exactement : IMPORTER LES ELEVES");
      return;
    }
    setIsImporting(true);
    const currentStudents = data.students.filter((student) => student.schoolId === school.id && student.schoolYearId === year.id);
    const existingKeys = new Set(currentStudents.map(studentImportKey));
    let skipped = 0;
    let promoted = 0;
    let maternelleToPrimaire = 0;
    let primaireToCteb = 0;
    let ctebToHumanities = 0;
    let optionPending = 0;
    let notPromoted = 0;
    const importedStudents: Student[] = [];

    selectedStudents.forEach((student) => {
      const key = studentImportKey(student);
      if (existingKeys.has(key)) {
        skipped += 1;
        return;
      }
      existingKeys.add(key);
      const promotion = promoteStudentForNewYear(student);
      if (promotion.promoted) promoted += 1;
      if (promotion.transition === "maternelle-primaire") maternelleToPrimaire += 1;
      if (promotion.transition === "primaire-cteb") primaireToCteb += 1;
      if (promotion.transition === "cteb-humanites") ctebToHumanities += 1;
      if (promotion.optionPending) optionPending += 1;
      if (!promotion.promoted) notPromoted += 1;
      const importedStudent: Student = {
        ...student,
        id: createId("student"),
        schoolYearId: year.id,
        annee_scolaire_id: year.id,
        className: promotion.className,
        section: getClassSection(promotion.className),
        option: promotion.option,
        status: "ACTIVE",
      };
      delete importedStudent.exitReason;
      delete importedStudent.exitReasonDetails;
      delete importedStudent.deletedAt;
      importedStudents.push(importedStudent);
    });

    const importedStudentIdsByParent = new Map<string, string[]>();
    importedStudents.forEach((student) => {
      if (!student.parentId) return;
      importedStudentIdsByParent.set(student.parentId, [...(importedStudentIdsByParent.get(student.parentId) ?? []), student.id]);
    });
    const nextParents = data.parents.map((parent) => {
      const studentIds = importedStudentIdsByParent.get(parent.id);
      return studentIds?.length ? { ...parent, studentIds: Array.from(new Set([...parent.studentIds, ...studentIds])) } : parent;
    });
    const nextUsers = data.users.map((item) => {
      const studentIds = item.parentId ? importedStudentIdsByParent.get(item.parentId) : undefined;
      return studentIds?.length ? { ...item, studentIds: Array.from(new Set([...(item.studentIds ?? []), ...studentIds])) } : item;
    });
    const updatedYear = {
      ...year,
      studentsImportedFromArchivedYear: true,
      studentsImportedFromYearId: selectedYear.id,
      studentsImportedAt: new Date().toISOString(),
    };
    const changedParents = nextParents.filter((parent) => data.parents.find((item) => item.id === parent.id)?.studentIds.join("|") !== parent.studentIds.join("|"));
    const auditLog = createAuditLog(user, school.id, year.id, "Import élèves année archivée", `${selectedYear.name} vers ${year.name} - ${importedStudents.length} importés, ${skipped} doublons`, createId);
    try {
      await persistFirestorePatch({ students: importedStudents, parents: changedParents, schoolYears: [updatedYear], auditLogs: [auditLog] }, { throwOnError: true });
      updateData({
        students: [...data.students, ...importedStudents],
        parents: nextParents,
        users: nextUsers,
        schoolYears: data.schoolYears.map((item) => item.id === year.id ? updatedYear : item),
        auditLogs: [auditLog, ...data.auditLogs],
      }, { persist: false });
      setResult([
        `${importedStudents.length} élève(s) importé(s).`,
        `${promoted} élève(s) promu(s).`,
        `${maternelleToPrimaire} passage(s) de Maternelle vers Primaire.`,
        `${primaireToCteb} passage(s) de Primaire vers CTEB.`,
        `${ctebToHumanities} passage(s) de CTEB vers Humanités.`,
        `${optionPending} élève(s) en attente d'affectation d'option.`,
        `${notPromoted} élève(s) non promu(s).`,
        `${skipped} élève(s) ignoré(s) pour doublon.`,
      ].join("\n"));
      setError("");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Réinscription impossible.");
    } finally {
      setIsImporting(false);
    }
  }

  if (!open) return null;
  return (
    <AdminDrawer title="Importer les élèves d’une année archivée" onClose={closeDrawer} closeLabel="Fermer l'import des élèves">
      <div className="grid min-w-0 gap-4">
        {!canImport && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">Votre compte ne permet pas d’importer des élèves.</p>}
        <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
          Seules les fiches élèves seront importées dans l'année active. Les paiements, reçus, présences, notes, messages, historiques et autres données opérationnelles ne seront pas copiés.
        </p>
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-bold">Confirmation obligatoire</p>
          <p className="mt-2">Vous êtes sur le point d'importer tous les élèves d'une année scolaire archivée vers la nouvelle année scolaire.</p>
          <p className="mt-2">Cette opération ne peut être exécutée qu'une seule fois et applique les règles de promotion Acadéa.</p>
        </div>
        {result ? (
          <p className="whitespace-pre-line rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{result}</p>
        ) : studentsAlreadyImported ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Les élèves ont déjà été importés pour cette année scolaire.</p>
        ) : archivedYears.length === 0 ? (
          <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucune année archivée disponible pour l'import.</p>
        ) : (
          <>
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">Année archivée
              <select value={sourceYearId} onChange={(event) => { setSourceYearId(event.target.value); setError(""); setResult(""); }} className="input">
                <option value="" disabled>Sélectionner une année</option>
                {archivedYears.map((archivedYear) => <option key={archivedYear.id} value={archivedYear.id}>{archivedYear.name}</option>)}
              </select>
            </label>
            <Metric label="Élèves disponibles" value={String(selectedStudents.length)} />
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">Phrase de confirmation
              <input value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} disabled={isImporting} className="input" placeholder="IMPORTER LES ELEVES" />
            </label>
            {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
            <button type="button" onClick={() => void importStudents()} disabled={!canImport || !selectedYear || selectedStudents.length === 0 || confirmation !== "IMPORTER LES ELEVES" || isImporting} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
              <Upload className="h-4 w-4" /> {isImporting ? "Importation…" : "Importer tous les élèves"}
            </button>
          </>
        )}
      </div>
    </AdminDrawer>
  );
}

export function AgeHomogeneityDrawer({ open, onClose, user, data, school, year, allowedSections, studentSource, classSource }: Omit<SharedToolProps, "data"> & { data?: AppData; allowedSections?: SchoolSection[]; studentSource?: Student[]; classSource?: import("../../types").SchoolClassRecord[] }) {
  const [section, setSection] = useState<"all" | SchoolSection>("all");
  const [className, setClassName] = useState("");
  const [archiveStatus, setArchiveStatus] = useState<"all" | "active" | "archived">("all");
  const [realtimeClasses, setRealtimeClasses] = useState<import("../../types").SchoolClassRecord[]>(classSource ?? []);
  useEffect(() => {
    if (classSource) { setRealtimeClasses(classSource); return undefined; }
    if (!open) return undefined;
    return subscribeToSchoolClasses(school.id, year.id, setRealtimeClasses, () => setRealtimeClasses([]));
  }, [classSource, open, school.id, year.id]);
  const sections = getSchoolSections(school).filter((item) => !allowedSections?.length || allowedSections.includes(item));
  const classes = useMemo(() => operationalSchoolClasses(realtimeClasses, school.id, year.id, allowedSections).filter((item) => section === "all" || getClassSection(item.name as import("../../types").SchoolClass) === section), [allowedSections, realtimeClasses, school.id, section, year.id]);
  const students = useMemo(() => (studentSource ?? data?.students ?? []).filter((student) => (
    student.schoolId === school.id
    && student.schoolYearId === year.id
    && (!allowedSections?.length || allowedSections.includes(getStudentSection(student)))
    && (section === "all" || getClassSection(student.className) === section)
    && (!className || student.subClassId === className || student.classId === className || student.className === classes.find((item) => item.id === className)?.name)
    && (archiveStatus === "all" || (archiveStatus === "archived" ? isArchivedStudent(student) : !isArchivedStudent(student)))
  )), [allowedSections, archiveStatus, className, classes, data?.students, school.id, section, studentSource, year.id]);
  const canView = (user.role === "secretary" || user.role === "study_director") && user.status === "active" && user.schoolId === school.id;

  if (!open) return null;
  return (
    <AdminDrawer title="Tableau d’homogénéité d’âge" onClose={onClose} closeLabel="Fermer le tableau d’homogénéité d’âge">
      <div className="grid min-w-0 gap-4">
        {!canView && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">Votre compte ne permet pas de consulter ce tableau.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={archiveStatus} onChange={(event) => setArchiveStatus(event.target.value as typeof archiveStatus)} className="input" aria-label="Statut des élèves">
            <option value="all">Tous les statuts</option><option value="active">Actifs</option><option value="archived">Archivés</option>
          </select>
          <select value={section} onChange={(event) => { setSection(event.target.value as typeof section); setClassName(""); }} className="input" aria-label="Section">
            <option value="all">Toutes les sections</option>{sections.map((item) => <option key={item} value={item}>{schoolSectionLabels[item]}</option>)}
          </select>
          <select value={className} onChange={(event) => setClassName(event.target.value)} className="input sm:col-span-2" aria-label="Classe">
            <option value="">Toutes les classes</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <Metric label="Élèves analysés" value={String(students.length)} />
        {students.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève ne correspond aux filtres sélectionnés.</p>}
        <button type="button" disabled={!canView || students.length === 0} onClick={() => void exportAgeHomogeneityPdf(school, year, students)} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
          <Download className="h-4 w-4" /> Imprimer / exporter le tableau
        </button>
      </div>
    </AdminDrawer>
  );
}
