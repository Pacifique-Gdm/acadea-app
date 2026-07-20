import { useEffect, useMemo, useState } from "react";
import { Download, Edit3, Eye, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { StudentForm } from "../../components/students/StudentForm";
import { AdminDrawer, IconButton, Metric, SectionTitle } from "../../components/ui";
import { persistFirestorePatch } from "../../services/firestoreData";
import { provisionParent } from "../../services/provisioning";
import { nextParentEmail, parentEmailExists } from "../../utils/parents";
import { getSchoolClassChoices, getSchoolEducationLevels } from "../../utils/schoolConfig";
import { formatStudentClassName, getClassSection, promoteStudentForNewYear } from "../../utils/studentClasses";
import { emptyStudent, generateMatricule, isArchivedStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, AuditLog, ParentProfile, School, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";

export function StudentsModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onOpenStudent,
  uid,
  createAuditLog,
  formatArchiveDate,
  exportStudentsPdf,
  exportAgeHomogeneityPdf,
  sortStudentsForPdfByClass,
  studentImportKey,
}: {
  user: AppUser;
  data: AppData;
  yearData: Pick<AppData, "students" | "parents">;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onOpenStudent: (studentId: string) => void;
  uid: (prefix: string) => string;
  createAuditLog: (user: AppUser, schoolId: string, schoolYearId: string, action: string, details: string) => AuditLog;
  formatArchiveDate: (value?: string) => string;
  exportStudentsPdf: (school: School, year: SchoolYear, students: Student[], filters: string[]) => void | Promise<void>;
  exportAgeHomogeneityPdf: (school: School, year: SchoolYear, students: Student[]) => void | Promise<void>;
  sortStudentsForPdfByClass: (students: Student[]) => Student[];
  studentImportKey: (student: Student) => string;
}) {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [classFilter, setClassFilter] = useState("");
  const [optionFilter, setOptionFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("all");
  const [form, setForm] = useState<Student>(() => emptyStudent(school.id, year.id));
  const [quickParent, setQuickParent] = useState({ fullName: "", phone: "", email: "", password: "" });
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [archiveStudentId, setArchiveStudentId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOtherReason, setArchiveOtherReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [reactivationStudentId, setReactivationStudentId] = useState<string | null>(null);
  const [reactivationReason, setReactivationReason] = useState("");
  const [reactivationOtherReason, setReactivationOtherReason] = useState("");
  const [reactivationError, setReactivationError] = useState("");
  const [importStudentsOpen, setImportStudentsOpen] = useState(false);
  const [importSourceYearId, setImportSourceYearId] = useState("");
  const [importResult, setImportResult] = useState("");
  const [importConfirmation, setImportConfirmation] = useState("");
  const [importError, setImportError] = useState("");
  const canEdit = user.role === "school_admin" && year.status !== "archived";
  const studentClassChoices = getSchoolClassChoices(school);
  const studentSectionChoices = getSchoolEducationLevels(school)
    .map((level) => (level === "Maternelle" ? "maternelle" : level === "Primaire" ? "primaire" : level === "Secondaire" ? "secondaire" : ""))
    .filter(Boolean) as SchoolSection[];
  const availableClasses = studentClassChoices.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);
  const optionChoices = Array.from(new Set([...(school.schoolOptions ?? []), ...yearData.students.map((student) => student.option).filter(Boolean)])) as string[];
  const emptyCurrentStudent = () => {
    const className = studentClassChoices[0] ?? CLASSES[0];
    return { ...emptyStudent(school.id, year.id), className, section: getClassSection(className) };
  };
  const archivedYearsForImport = data.schoolYears.filter((item) => item.schoolId === school.id && item.status === "archived");
  const selectedImportYear = archivedYearsForImport.find((item) => item.id === importSourceYearId);
  const selectedImportStudents = importSourceYearId
    ? data.students.filter((student) => student.schoolId === school.id && student.schoolYearId === importSourceYearId)
    : [];
  const studentsAlreadyImported = Boolean(year.studentsImportedFromArchivedYear);

  useEffect(() => {
    if (sectionFilter !== "all" && !studentSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [studentSectionChoices, sectionFilter]);
  useEffect(() => {
    if (!saveError && !saveMessage) return;
    const timer = window.setTimeout(() => {
      setSaveError("");
      setSaveMessage("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [saveError, saveMessage]);

  const students = yearData.students.filter((student) => {
    const text = `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom}`.toLowerCase();
    const archived = isArchivedStudent(student);
    return (
      (archiveFilter === "all" || (archiveFilter === "archived" ? archived : !archived)) &&
      text.includes(query.toLowerCase()) &&
      (sectionFilter === "all" || getClassSection(student.className) === sectionFilter) &&
      (!classFilter || student.className === classFilter) &&
      (!optionFilter || student.option === optionFilter)
    );
  });
  const parentsById = useMemo(
    () => new Map(yearData.parents.filter((parent) => parent.schoolId === school.id).map((parent) => [parent.id, parent])),
    [school.id, yearData.parents],
  );
  const parentByStudentId = useMemo(() => {
    const index = new Map<string, ParentProfile>();
    yearData.parents.forEach((parent) => {
      if (parent.schoolId !== school.id) return;
      parent.studentIds.forEach((studentId) => {
        if (!index.has(studentId)) index.set(studentId, parent);
      });
    });
    return index;
  }, [school.id, yearData.parents]);
  const archiveStudent = archiveStudentId ? data.students.find((student) => student.id === archiveStudentId) : undefined;
  const reactivationStudent = reactivationStudentId ? data.students.find((student) => student.id === reactivationStudentId) : undefined;
  const archiveReasonChoices = ["Abandon", "Mutation", "Exclusion", "Décès", "Fin de scolarité", "Erreur administrative", "Autre"] as const;
  const reactivationReasonChoices = ["Retour à l'école", "Erreur d'archivage", "Réinscription", "Mutation annulée", "Suspension levée", "Décision administrative", "Autre"] as const;
  const finalArchiveReason = archiveReason === "Autre" ? archiveOtherReason.trim() : archiveReason;
  const finalReactivationReason = reactivationReason === "Autre" ? reactivationOtherReason.trim() : reactivationReason;

  function studentParentPhone(student: Student) {
    const directParent = student.parentId ? parentsById.get(student.parentId) : undefined;
    const parent = directParent ?? parentByStudentId.get(student.id);
    return parent?.phone?.trim() || "—";
  }

  async function saveStudent() {
    setSaveError("");
    setSaveMessage("");
    const selectedParentId = form.parentId?.trim() ?? "";
    const matchingParents = data.parents.filter((parent) => parent.id === selectedParentId && parent.schoolId === school.id);
    if (selectedParentId && matchingParents.length === 0) {
      setSaveError("Veuillez lier cet élève à un parent avant d'enregistrer.");
      return;
    }
    if (matchingParents.length > 1) {
      setSaveError("Un élève ne peut être lié qu'à un seul parent.");
      return;
    }
    const exists = data.students.some((item) => item.id === form.id);
    const targetYearId = exists ? form.schoolYearId : year.id;
    const targetYearName = exists ? data.schoolYears.find((item) => item.id === form.schoolYearId)?.name ?? year.name : year.name;
    const matricule = exists ? form.matricule : generateMatricule(data.students, targetYearName, school.id, targetYearId);
    const student: Student = {
      ...form,
      matricule,
      section: getClassSection(form.className),
      status: form.status ?? "ACTIVE",
      schoolId: school.id,
      schoolYearId: targetYearId,
      annee_scolaire_id: targetYearId,
    };
    if (selectedParentId) {
      student.parentId = selectedParentId;
    } else {
      delete student.parentId;
    }
    const parents = data.parents.map((parent) => {
      const withoutStudent = parent.studentIds.filter((studentId) => studentId !== student.id);
      return parent.id === student.parentId ? { ...parent, studentIds: Array.from(new Set([...withoutStudent, student.id])) } : { ...parent, studentIds: withoutStudent };
    });
    const users = data.users.map((item) => {
      if (item.role !== "parent" || !item.parentId) return item;
      const parent = parents.find((parentItem) => parentItem.id === item.parentId);
      return parent ? { ...item, studentIds: parent.studentIds } : item;
    });
    const nextStudents = exists ? data.students.map((item) => (item.id === student.id ? student : item)) : [...data.students, student];
    const changedParents = parents.filter((parent) => {
      const previousParent = data.parents.find((item) => item.id === parent.id);
      return previousParent && previousParent.studentIds.join("|") !== parent.studentIds.join("|");
    });
    const auditLog = createAuditLog(user, school.id, targetYearId, exists ? "Modification élève" : "Création élève", `${student.matricule} - ${student.nom} ${student.prenom}`);
    try {
      await persistFirestorePatch(
        {
          students: [student],
          ...(changedParents.length ? { parents: changedParents } : {}),
          auditLogs: [auditLog],
        },
        { throwOnError: true },
      );
    } catch (error) {
      setSaveError(error instanceof Error ? `Impossible d'enregistrer l'élève dans Firestore : ${error.message}` : "Impossible d'enregistrer l'élève dans Firestore.");
      return;
    }
    updateData({
      students: nextStudents,
      parents,
      users,
      auditLogs: [auditLog, ...data.auditLogs],
    }, { persist: false });
    setForm(emptyCurrentStudent());
    setShowForm(false);
    setSaveMessage(exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.");
  }

  function openAddStudentForm() {
    setForm(emptyCurrentStudent());
    setQuickParent({ fullName: "", phone: "", email: nextParentEmail(school, data.users, data.parents), password: "" });
    setSaveError("");
    setSaveMessage("");
    setShowForm(true);
  }

  function openEditStudentForm(student: Student) {
    setForm(student);
    setSaveError("");
    setSaveMessage("");
    setShowForm(true);
  }

  function removeStudent(id: string) {
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
    const student = data.students.find((item) => item.id === id);
    if (!student) return;
    const reason = finalArchiveReason;
    if (!archiveReason || !reason) {
      setArchiveError(archiveReason === "Autre" ? "Veuillez préciser le motif d'archivage." : "Le motif d'archivage est obligatoire.");
      return;
    }
    const normalized = reason.toLowerCase();
    const status = normalized.includes("décès") || normalized.includes("deces") ? "DECEASED" : normalized.includes("abandon") ? "DROPPED" : "TRANSFERRED";
    updateData({
      students: data.students.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              exitReason: archiveReason as Student["exitReason"],
              exitReasonDetails: reason,
              deletedAt: new Date().toISOString(),
            }
          : item,
      ),
      auditLogs: [createAuditLog(user, school.id, year.id, "Archivage élève", `${student.matricule} - ${reason}`), ...data.auditLogs],
    });
    closeArchiveStudentDialog();
  }

  function openReactivateStudentDialog(id: string) {
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
    const student = data.students.find((item) => item.id === id);
    if (!student) return;
    updateData({
      students: data.students.map((item) =>
        item.id === id
          ? (() => {
              const activeStudent = { ...item, status: "ACTIVE" as const };
              delete activeStudent.exitReason;
              delete activeStudent.exitReasonDetails;
              delete activeStudent.deletedAt;
              return activeStudent;
            })()
          : item,
      ),
      auditLogs: [createAuditLog(user, school.id, year.id, "Réactivation élève", `${student.matricule} - ${student.nom} ${student.prenom} - ${reason}`), ...data.auditLogs],
    });
    closeReactivateStudentDialog();
  }

  async function createParentForStudent() {
    setSaveError("");
    if (!quickParent.fullName || !quickParent.phone || !quickParent.email) return;
    const parentId = uid("parent");
    const resolvedEmail = parentEmailExists(quickParent.email, data.users, data.parents) ? nextParentEmail(school, data.users, data.parents) : quickParent.email.trim();
    let userId: string | undefined;
    if (!userId) {
      if (!quickParent.password) {
        setSaveError("Mot de passe requis pour créer le compte Firebase Auth du parent.");
        return;
      }
      try {
        const provisioned = await provisionParent({
          schoolId: school.id,
          schoolYearId: year.id,
          parentId,
          name: quickParent.fullName,
          email: resolvedEmail,
          password: quickParent.password,
          phone: quickParent.phone,
          address: "",
          studentIds: [form.id],
          status: "active",
        });
        userId = provisioned.user.id;
      } catch (error) {
        setSaveError(error instanceof Error ? `Création Firebase Auth parent impossible : ${error.message}` : "Création Firebase Auth parent impossible.");
        return;
      }
    }
    const parent: ParentProfile = {
      id: parentId,
      schoolId: school.id,
      schoolYearId: year.id,
      userId,
      fullName: quickParent.fullName,
      phone: quickParent.phone,
      email: resolvedEmail,
      address: "",
      studentIds: [form.id],
      status: "active",
    };
    const parentUser: AppUser = {
      id: userId,
      name: parent.fullName,
      email: parent.email,
      role: "parent",
      schoolId: school.id,
      activeSchoolYearId: year.id,
      parentId,
      studentIds: [form.id],
      status: "active",
      phone: parent.phone,
    };
    updateData(
      {
        parents: [...data.parents, parent],
        users: [...data.users, parentUser],
      },
      { persist: false },
    );
    setForm({ ...form, parentId });
    setQuickParent({ fullName: "", phone: "", email: "", password: "" });
    setSaveMessage("Compte parent créé avec succès. Il peut maintenant se connecter avec son email et son mot de passe.");
  }

  function addSchoolOption(option: string) {
    const trimmed = option.trim();
    if (!trimmed) return;
    const nextOptions = (school.schoolOptions ?? []).some((item) => item.toLowerCase() === trimmed.toLowerCase())
      ? school.schoolOptions ?? []
      : [...(school.schoolOptions ?? []), trimmed];
    updateData({ schools: data.schools.map((item) => (item.id === school.id ? { ...item, schoolOptions: nextOptions } : item)) });
    setForm({ ...form, option: trimmed });
  }

  function printStudentsPdf() {
    const filters = [
      `Recherche: ${query || "Toutes"}`,
      `Statut: ${archiveFilter === "active" ? "Actifs" : archiveFilter === "archived" ? "Archivés" : "Tous"}`,
      `Section: ${sectionFilter === "all" ? "Toutes les sections" : sectionFilter}`,
      `Classe: ${classFilter || "Toutes les classes"}`,
      `Option: ${optionFilter || "Toutes les options"}`,
    ];
    exportStudentsPdf(school, year, sortStudentsForPdfByClass(students), filters);
  }

  function printAgeHomogeneityPdf() {
    exportAgeHomogeneityPdf(school, year, students);
  }

  function openImportStudentsDrawer() {
    if (studentsAlreadyImported) {
      setImportResult("Les élèves ont déjà été importés pour cette année scolaire. Cette opération ne peut être effectuée qu'une seule fois.");
      return;
    }
    setImportSourceYearId(archivedYearsForImport[0]?.id ?? "");
    setImportResult("");
    setImportConfirmation("");
    setImportError("");
    setImportStudentsOpen(true);
  }

  function closeImportStudentsDrawer() {
    setImportStudentsOpen(false);
    setImportSourceYearId("");
    setImportResult("");
    setImportConfirmation("");
    setImportError("");
  }

  function importStudentsFromArchivedYear() {
    if (!selectedImportYear) return;
    if (studentsAlreadyImported) {
      setImportError("Les élèves ont déjà été importés pour cette année scolaire. Cette opération ne peut être effectuée qu'une seule fois.");
      return;
    }
    if (importConfirmation !== "IMPORTER LES ELEVES") {
      setImportError("Phrase de confirmation incorrecte. Veuillez saisir exactement : IMPORTER LES ELEVES");
      return;
    }
    const currentStudents = data.students.filter((student) => student.schoolId === school.id && student.schoolYearId === year.id);
    const existingKeys = new Set(currentStudents.map((student) => studentImportKey(student)));
    let skipped = 0;
    let promoted = 0;
    let maternelleToPrimaire = 0;
    let primaireToCteb = 0;
    let ctebToHumanities = 0;
    let optionPending = 0;
    let notPromoted = 0;
    const importedStudents: Student[] = [];

    selectedImportStudents.forEach((student) => {
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
        id: uid("student"),
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
      if (!studentIds?.length) return parent;
      return { ...parent, studentIds: Array.from(new Set([...parent.studentIds, ...studentIds])) };
    });
    const nextUsers = data.users.map((item) => {
      const studentIds = item.parentId ? importedStudentIdsByParent.get(item.parentId) : undefined;
      if (!studentIds?.length) return item;
      return { ...item, studentIds: Array.from(new Set([...(item.studentIds ?? []), ...studentIds])) };
    });

    updateData({
      students: [...data.students, ...importedStudents],
      parents: nextParents,
      users: nextUsers,
      schoolYears: data.schoolYears.map((item) =>
        item.id === year.id
          ? {
              ...item,
              studentsImportedFromArchivedYear: true,
              studentsImportedFromYearId: selectedImportYear.id,
              studentsImportedAt: new Date().toISOString(),
            }
          : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Import élèves année archivée", `${selectedImportYear.name} vers ${year.name} - ${importedStudents.length} importés, ${skipped} doublons`),
        ...data.auditLogs,
      ],
    });
    setImportResult(
      [
        `${importedStudents.length} élève(s) importé(s).`,
        `${promoted} élève(s) promu(s).`,
        `${maternelleToPrimaire} passage(s) de Maternelle vers Primaire.`,
        `${primaireToCteb} passage(s) de Primaire vers CTEB.`,
        `${ctebToHumanities} passage(s) de CTEB vers Humanités.`,
        `${optionPending} élève(s) en attente d'affectation d'option.`,
        `${notPromoted} élève(s) non promu(s).`,
        `${skipped} élève(s) ignoré(s) pour doublon.`,
      ].join("\n"),
    );
    setImportError("");
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0">
        <SectionTitle title="Élèves" subtitle="Ajouter, modifier, rechercher et filtrer par direction puis classe." />
        {saveMessage && <p className="mb-3 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{saveMessage}</p>}
        <div className={`mb-3 grid min-w-0 gap-2 sm:grid-cols-2 lg:w-full ${canEdit ? "lg:grid-cols-[minmax(130px,0.75fr)_minmax(280px,1.35fr)_minmax(230px,1.1fr)_minmax(220px,1fr)]" : "lg:grid-cols-2"}`}>
          {canEdit && (
            <button onClick={openAddStudentForm} type="button" className="primary-button w-full justify-center">
              <Plus className="h-4 w-4" /> Ajouter un élève
            </button>
          )}
          {canEdit && (
            <button
              onClick={openImportStudentsDrawer}
              type="button"
              disabled={studentsAlreadyImported}
              className="secondary-button w-full justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
              title={studentsAlreadyImported ? "Les élèves ont déjà été importés pour cette année scolaire." : undefined}
            >
              <Upload className="h-4 w-4" /> Importer les élèves d'une année archivée
            </button>
          )}
          <button onClick={printAgeHomogeneityPdf} type="button" className="primary-button w-full justify-center">
            <Download className="h-4 w-4" /> Tableau d'homogénéité d'âge
          </button>
          <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" className="min-w-0 flex-1 outline-none" />
          </label>
        </div>
        {studentsAlreadyImported && (
          <p className="mb-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
            Les élèves ont déjà été importés pour cette année scolaire. Cette opération ne peut être effectuée qu'une seule fois.
          </p>
        )}
        <div className="mb-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:w-full lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(150px,0.9fr)]">
          <select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2">
            <option value="active">Actifs</option>
            <option value="archived">Archivés</option>
            <option value="all">Tous</option>
          </select>
          <select
            value={sectionFilter}
            onChange={(event) => {
              setSectionFilter(event.target.value as typeof sectionFilter);
              setClassFilter("");
            }}
            className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2"
          >
            <option value="all">Toutes les sections</option>
            {studentSectionChoices.includes("maternelle") && <option value="maternelle">Maternelle</option>}
            {studentSectionChoices.includes("primaire") && <option value="primaire">Primaire</option>}
            {studentSectionChoices.includes("secondaire") && <option value="secondaire">Secondaire</option>}
          </select>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2">
            <option value="">Toutes les classes</option>
            {availableClasses.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          <select value={optionFilter} onChange={(event) => setOptionFilter(event.target.value)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2">
            <option value="">Toutes les options</option>
            {optionChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button onClick={printStudentsPdf} type="button" className="primary-button w-full justify-center">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
        </div>
        <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="min-w-[980px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Nom complet</th>
                <th className="px-3 py-3">Statut</th>
                <th className="px-3 py-3">Sexe</th>
                <th className="px-3 py-3">Classe</th>
                <th className="px-3 py-3">Téléphone</th>
                <th className="px-3 py-3">Archivage</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
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
                      <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Actif</span>
                    )}
                  </td>
                  <td className="px-3 py-3">{student.sexe}</td>
                  <td className="px-3 py-3">{formatStudentClassName(student)}</td>
                  <td className="px-3 py-3">{studentParentPhone(student)}</td>
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
                  <td className="px-3 py-3">
                    {canEdit ? (
                      <div className="flex gap-1">
                        {archived ? (
                          <>
                            <IconButton label="Consulter" onClick={() => onOpenStudent(student.id)} icon={Eye} />
                            <IconButton label="Réactiver l'élève" onClick={() => openReactivateStudentDialog(student.id)} icon={RefreshCw} />
                          </>
                        ) : (
                          <>
                            <IconButton label="Modifier" onClick={() => openEditStudentForm(student)} icon={Edit3} />
                            <IconButton label="Archiver" onClick={() => removeStudent(student.id)} icon={Trash2} danger />
                          </>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Lecture seule</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {canEdit && showForm && (
        <AdminDrawer title={form.id.startsWith("new") ? "Ajouter un élève" : "Modifier l'élève"} onClose={() => setShowForm(false)} closeLabel="Fermer le formulaire élève">
          <StudentForm
            form={form}
            setForm={setForm}
            parents={yearData.parents}
            quickParent={quickParent}
            setQuickParent={setQuickParent}
            classChoices={studentClassChoices}
            optionChoices={optionChoices}
            onAddOption={addSchoolOption}
            onCreateParent={createParentForStudent}
            onSave={saveStudent}
            onReset={() => setForm(emptyStudent(school.id, year.id))}
            errorMessage={saveError}
          />
        </AdminDrawer>
      )}
      {canEdit && archiveStudent && (
        <AdminDrawer title="Archiver l'élève" onClose={closeArchiveStudentDialog} closeLabel="Fermer l'archivage">
          <div className="grid min-w-0 gap-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">
                {archiveStudent.nom} {archiveStudent.postnom} {archiveStudent.prenom}
              </p>
              <p className="mt-1">Motif obligatoire : choisissez un motif d'archivage dans la liste.</p>
            </div>
            {archiveError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{archiveError}</p>}
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
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeArchiveStudentDialog} className="secondary-button justify-center">
                Annuler
              </button>
              <button type="button" onClick={confirmArchiveStudent} disabled={!archiveReason || !finalArchiveReason} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
                OK
              </button>
            </div>
          </div>
        </AdminDrawer>
      )}
      {canEdit && reactivationStudent && (
        <AdminDrawer title="Réactiver l'élève" onClose={closeReactivateStudentDialog} closeLabel="Fermer la réactivation">
          <div className="grid min-w-0 gap-4">
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">
                {reactivationStudent.nom} {reactivationStudent.postnom} {reactivationStudent.prenom}
              </p>
              <p className="mt-1">La réactivation nécessite un motif obligatoire et sera enregistrée dans l'historique.</p>
            </div>
            {reactivationError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{reactivationError}</p>}
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
      {canEdit && importStudentsOpen && (
        <AdminDrawer title="Importer les élèves" onClose={closeImportStudentsDrawer} closeLabel="Fermer l'import des élèves">
          <div className="grid min-w-0 gap-4">
            <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
              Seules les fiches élèves seront importées dans l'année active. Les paiements, reçus, présences, notes, messages, historiques et autres données opérationnelles ne seront pas copiés.
            </p>
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">Confirmation obligatoire</p>
              <p className="mt-2">
                Vous êtes sur le point d'importer tous les élèves d'une année scolaire archivée vers la nouvelle année scolaire.
              </p>
              <p className="mt-2">
                Cette opération est importante, ne peut être exécutée qu'une seule fois pour cette année scolaire et déclenchera automatiquement la promotion des élèves selon les règles définies par Acadéa.
              </p>
              <p className="mt-2">Veuillez confirmer votre choix.</p>
            </div>
            {archivedYearsForImport.length === 0 ? (
              <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucune année archivée disponible pour l'import.</p>
            ) : (
              <>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Année archivée
                  <select value={importSourceYearId} onChange={(event) => setImportSourceYearId(event.target.value)} className="input">
                    {archivedYearsForImport.map((archivedYear) => (
                      <option key={archivedYear.id} value={archivedYear.id}>{archivedYear.name}</option>
                    ))}
                  </select>
                </label>
                <Metric label="Élèves disponibles" value={String(selectedImportStudents.length)} />
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Phrase de confirmation
                  <input
                    value={importConfirmation}
                    onChange={(event) => {
                      setImportConfirmation(event.target.value);
                      setImportError("");
                    }}
                    className="input"
                    placeholder="IMPORTER LES ELEVES"
                  />
                </label>
                {importError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{importError}</p>}
                {importResult && <p className="whitespace-pre-line rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{importResult}</p>}
                <button type="button" onClick={importStudentsFromArchivedYear} disabled={!selectedImportYear || selectedImportStudents.length === 0 || importConfirmation !== "IMPORTER LES ELEVES"} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
                  <Upload className="h-4 w-4" /> Importer tous les élèves
                </button>
              </>
            )}
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
