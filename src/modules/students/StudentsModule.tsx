import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit3, Eye, Plus, RefreshCw, RotateCcw, Search, Trash2 } from "lucide-react";
import { StudentForm } from "../../components/students/StudentForm";
import { AdminDrawer, IconButton, SectionTitle } from "../../components/ui";
import { persistFirestorePatch } from "../../services/firestoreData";
import { provisionParent, requestTerminalStudentReenrollment } from "../../services/provisioning";
import { createAuditLog } from "../../utils/audit";
import { nextParentEmail, parentEmailExists } from "../../utils/parents";
import { reconcileStudentParentMembership } from "../../utils/parentStudentLink";
import { getSchoolClassChoices, getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { canonicalSchoolOption, normalizeSchoolOptions } from "../../utils/schoolOptions";
import { persistSchoolOption } from "../../services/schoolOptionsRepository";
import { formatStudentClassName, getClassSection } from "../../utils/studentClasses";
import { emptyStudent, generateMatricule, isArchivedStudent, studentForPersistence, validateStudentForSave } from "../../utils/studentUtils";
import { exportStudentsPdf, sortStudentsForPdfByClass } from "../../utils/studentPdf";
import type { AppData, AppUser, ParentProfile, School, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import type { SchoolClassRecord } from "../../types";
import { activeSubclasses, createSchoolSubclasses, schoolClassOptionKey, secondarySubclassesForOption, studentSchoolClassOptionKey, subscribeToSchoolClasses } from "../../services/schoolSubclasses";
import { canonicalAnnualClassName, isEligibleForAnnualTransition, studentImportKey } from "../../utils/studentYearTransition.js";

export interface StudentModuleCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReactivate: boolean;
  canCreateParent: boolean;
  canManageOptions: boolean;
}

type PendingQuickParent = {
  parentId: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
};

type QuickParentForm = { fullName: string; phone: string; email: string; password: string };

function emptyQuickParent(email = ""): QuickParentForm {
  return { fullName: "", phone: "", email, password: "" };
}

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
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("all");
  const [form, setForm] = useState<Student>(() => emptyStudent(school.id, year.id));
  const [quickParent, setQuickParent] = useState<QuickParentForm>(() => emptyQuickParent());
  const [quickParentFeedback, setQuickParentFeedback] = useState("");
  const [pendingQuickParent, setPendingQuickParent] = useState<PendingQuickParent>();
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const saveInProgressRef = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [structuredClasses, setStructuredClasses] = useState<SchoolClassRecord[]>([]);
  const [archiveStudentId, setArchiveStudentId] = useState<string | null>(null);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveOtherReason, setArchiveOtherReason] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [reactivationStudentId, setReactivationStudentId] = useState<string | null>(null);
  const [reactivationReason, setReactivationReason] = useState("");
  const [reactivationOtherReason, setReactivationOtherReason] = useState("");
  const [reactivationError, setReactivationError] = useState("");
  const [terminalStudent, setTerminalStudent] = useState<Student>();
  const [terminalConfirmation, setTerminalConfirmation] = useState("");
  const [terminalError, setTerminalError] = useState("");
  const [terminalFeedback, setTerminalFeedback] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [reenrolledSourceIds, setReenrolledSourceIds] = useState<string[]>([]);
  const [activeYearClasses, setActiveYearClasses] = useState<SchoolClassRecord[]>([]);
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
  const canReenrollTerminal = year.status === "archived" && ["school_admin", "secretary"].includes(user.role) && user.status !== "inactive" && user.schoolId === school.id && Boolean(activeTargetYear);
  const hasTerminalTargetClass = activeYearClasses.some((item) => item.active !== false && !item.parentClassId && canonicalAnnualClassName(item.name) === "4ème Humanité");
  const showActionsColumn = studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate || canReenrollTerminal;
  const studentSectionChoices = getSchoolSections(school).filter((section) => !allowedSections?.length || allowedSections.includes(section));
  const studentClassChoices = getSchoolClassChoices(school).filter((className) => studentSectionChoices.includes(getClassSection(className)));
  const availableClasses = studentClassChoices.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);
  const schoolOptions = normalizeSchoolOptions(school.schoolOptions);
  // Les choix viennent exclusivement du référentiel persistant de l'école.
  // Les anciennes options présentes uniquement sur des élèves doivent être
  // réconciliées par une migration dédiée, jamais réintroduites en mémoire.
  const optionChoices = schoolOptions;
  const emptyCurrentStudent = () => {
    const className = studentClassChoices[0] ?? CLASSES[0];
    return { ...emptyStudent(school.id, year.id), className, section: getClassSection(className) };
  };

  useEffect(() => {
    return subscribeToSchoolClasses(school.id, year.id, setStructuredClasses, (cause) => setSaveError(cause.message));
  }, [school.id, year.id]);
  useEffect(() => {
    if (!canReenrollTerminal || !activeTargetYear) { setActiveYearClasses([]); return; }
    return subscribeToSchoolClasses(school.id, activeTargetYear.id, setActiveYearClasses, (cause) => setTerminalError(cause.message));
  }, [activeTargetYear, canReenrollTerminal, school.id]);
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
  useEffect(() => {
    if (!quickParentFeedback) return;
    const timer = window.setTimeout(() => setQuickParentFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [quickParentFeedback]);

  const students = yearData.students.filter((student) => {
    const text = `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom}`.toLowerCase();
    const archived = isArchivedStudent(student);
    return (
      student.schoolId === school.id &&
      student.schoolYearId === year.id &&
      (!allowedSections?.length || allowedSections.includes(getClassSection(student.className))) &&
      (archiveFilter === "all" || (archiveFilter === "archived" ? archived : !archived)) &&
      text.includes(query.toLowerCase()) &&
      (sectionFilter === "all" || getClassSection(student.className) === sectionFilter) &&
      (!classFilter || student.className === classFilter) &&
      (!optionFilter || canonicalSchoolOption(student.option ?? "") === optionFilter)
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

  function canReenroll(student: Student) {
    if (!canReenrollTerminal || !activeTargetYear || !hasTerminalTargetClass || canonicalAnnualClassName(student.className) !== "4ème Humanité" || !isEligibleForAnnualTransition(student)) return false;
    if (reenrolledSourceIds.includes(student.id)) return false;
    return !data.students.some((item) => item.schoolId === school.id && item.schoolYearId === activeTargetYear.id
      && (item.importedFromStudentId === student.id || studentImportKey(item) === studentImportKey(student)));
  }

  async function reenrollTerminal() {
    if (!terminalStudent || !canReenroll(terminalStudent) || terminalConfirmation !== "REINSCRIRE CET ELEVE" || terminalBusy) return;
    setTerminalBusy(true); setTerminalError(""); setTerminalFeedback("");
    try {
      const result = await requestTerminalStudentReenrollment({ schoolId: school.id, sourceStudentId: terminalStudent.id, mode: "reenroll", confirmation: terminalConfirmation });
      setReenrolledSourceIds((current) => current.includes(terminalStudent.id) ? current : [...current, terminalStudent.id]);
      setTerminalFeedback(result.status === "already-reenrolled"
        ? "Cet élève est déjà réinscrit pour l’année scolaire active."
        : `Élève réinscrit avec succès en 4ème Humanité pour l’année scolaire ${activeTargetYear?.name ?? "active"}.`);
      setTerminalStudent(undefined); setTerminalConfirmation("");
    } catch (cause) {
      setTerminalError(cause instanceof Error ? cause.message : "Réinscription impossible.");
    } finally { setTerminalBusy(false); }
  }

  function studentParentPhone(student: Student) {
    const directParent = student.parentId ? parentsById.get(student.parentId) : undefined;
    const parent = directParent ?? parentByStudentId.get(student.id);
    return parent?.phone?.trim() || "—";
  }

  async function saveStudent() {
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setIsSaving(true);
    setSaveError("");
    setSaveMessage("");
    try {
      const exists = data.students.some((item) => item.id === form.id);
      if ((exists && !studentCapabilities.canEdit) || (!exists && !studentCapabilities.canCreate)) {
        setSaveError("Votre compte n'est pas autorisé à enregistrer cette fiche élève.");
        return;
      }
      const validationError = validateStudentForSave(form, school.id, year.id);
      if (validationError) {
        setSaveError(validationError);
        return;
      }
      const selectedClass = structuredClasses.find((item) => item.id === form.classId && !item.parentClassId);
      const selectedOptionKey = studentSchoolClassOptionKey(structuredClasses, form);
      const selectedSubclasses = selectedClass
        ? getClassSection(form.className) === "Secondaire"
          ? secondarySubclassesForOption(structuredClasses, selectedClass.id, selectedOptionKey, form.subClassId)
          : activeSubclasses(structuredClasses, selectedClass.id)
        : [];
      if (selectedSubclasses.length >= 2 && !form.subClassId) { setSaveError("La sous-classe est obligatoire pour cette option subdivisée."); return; }
      if (form.subClassId && !selectedSubclasses.some((item) => item.id === form.subClassId)) { setSaveError("La sous-classe sélectionnée n’appartient pas à cette classe."); return; }
      const selectedParentId = form.parentId?.trim() ?? "";
      const pendingParentForStudent = pendingQuickParent?.parentId === selectedParentId ? pendingQuickParent : undefined;
      const matchingParents = data.parents.filter((parent) => parent.id === selectedParentId && parent.schoolId === school.id);
      if (selectedParentId && matchingParents.length === 0 && !pendingParentForStudent) {
        setSaveError("Veuillez lier cet élève à un parent avant d'enregistrer.");
        return;
      }
      if (matchingParents.length > 1) {
        setSaveError("Un élève ne peut être lié qu'à un seul parent.");
        return;
      }
      const targetYearId = exists ? form.schoolYearId : year.id;
      const targetYearName = exists ? data.schoolYears.find((item) => item.id === form.schoolYearId)?.name ?? year.name : year.name;
      const matricule = exists ? form.matricule : generateMatricule(data.students, targetYearName, school.id, targetYearId);
      const student = studentForPersistence({
        ...form,
        id: exists ? form.id : uid("student"),
        option: form.option ? canonicalSchoolOption(form.option) : undefined,
        matricule,
        section: getClassSection(form.className),
        status: form.status ?? "ACTIVE",
        schoolId: school.id,
        schoolYearId: targetYearId,
        annee_scolaire_id: targetYearId,
      });
      if (selectedOptionKey) student.classOptionKey = selectedOptionKey;
      else delete student.classOptionKey;
      if (student.section !== "Secondaire" || !student.option) delete student.option;
      if (!student.classId) delete student.classId;
      if (!student.subClassId) delete student.subClassId;
      if (selectedParentId && !pendingParentForStudent) {
        student.parentId = selectedParentId;
      } else {
        delete student.parentId;
      }
      const parents = reconcileStudentParentMembership(data.parents, student.id, student.parentId);
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
      const auditLog = createAuditLog(user, school.id, targetYearId, exists ? "Modification élève" : "Création élève", `${student.matricule} - ${student.nom} ${student.prenom}`, uid);
      await persistFirestorePatch(
        {
          students: [student],
          ...(changedParents.length ? { parents: changedParents } : {}),
          auditLogs: [auditLog],
        },
        { throwOnError: true },
      );

      if (pendingParentForStudent) {
        try {
          const provisioned = await provisionParent({
            schoolId: school.id,
            schoolYearId: targetYearId,
            parentId: pendingParentForStudent.parentId,
            name: pendingParentForStudent.fullName,
            email: pendingParentForStudent.email,
            password: pendingParentForStudent.password,
            phone: pendingParentForStudent.phone,
            address: "",
            studentIds: [student.id],
            status: "active",
          });
          const linkedStudent = { ...student, parentId: provisioned.parent.id };
          updateData({
            students: [...nextStudents.filter((item) => item.id !== linkedStudent.id), linkedStudent],
            parents: [...parents.filter((item) => item.id !== provisioned.parent.id), provisioned.parent],
            users: [...users.filter((item) => item.id !== provisioned.user.id), provisioned.user],
            auditLogs: [auditLog, ...data.auditLogs],
          }, { persist: false });
          setPendingQuickParent(undefined);
          setForm(emptyCurrentStudent());
          setQuickParent(emptyQuickParent());
          setQuickParentFeedback("");
          setShowForm(false);
          setSaveMessage("Élève et compte parent enregistrés avec succès.");
          return;
        } catch (error) {
          updateData({
            students: nextStudents,
            parents,
            users,
            auditLogs: [auditLog, ...data.auditLogs],
          }, { persist: false });
          setForm(student);
          setSaveError(error instanceof Error
            ? `L’élève a été enregistré, mais le compte Parent n’a pas pu être créé : ${error.message}`
            : "L’élève a été enregistré, mais le compte Parent n’a pas pu être créé. Vous pouvez reprendre la liaison depuis sa fiche.");
          return;
        }
      }
      updateData({
        students: nextStudents,
        parents,
        users,
        auditLogs: [auditLog, ...data.auditLogs],
      }, { persist: false });
      setForm(emptyCurrentStudent());
      setPendingQuickParent(undefined);
      setQuickParent({ fullName: "", phone: "", email: "", password: "" });
      setShowForm(false);
      setSaveMessage(exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.");
    } catch (error) {
      if (import.meta.env.DEV) console.error("Enregistrement de l'élève impossible.", error);
      setSaveError("Impossible d'enregistrer l'élève. Vérifiez les informations saisies.");
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  function openAddStudentForm() {
    if (!studentCapabilities.canCreate) return;
    setForm(emptyCurrentStudent());
    setQuickParent(emptyQuickParent(nextParentEmail(school, data.users, data.parents)));
    setQuickParentFeedback("");
    setPendingQuickParent(undefined);
    setSaveError("");
    setSaveMessage("");
    setShowForm(true);
  }

  function openEditStudentForm(student: Student) {
    if (!studentCapabilities.canEdit || isArchivedStudent(student)) return;
    setForm({ ...student, option: student.option ? canonicalSchoolOption(student.option) : undefined });
    setPendingQuickParent(undefined);
    setQuickParentFeedback("");
    setSaveError("");
    setSaveMessage("");
    setShowForm(true);
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
      auditLogs: [createAuditLog(user, school.id, year.id, "Réactivation élève", `${student.matricule} - ${student.nom} ${student.prenom} - ${reason}`, uid), ...data.auditLogs],
    });
    closeReactivateStudentDialog();
  }

  async function createParentForStudent() {
    if (!studentCapabilities.canCreateParent) return;
    setSaveError("");
    setQuickParentFeedback("");
    if (!quickParent.fullName || !quickParent.phone || !quickParent.email) return;
    const parentId = uid("parent");
    const resolvedEmail = parentEmailExists(quickParent.email, data.users, data.parents) ? nextParentEmail(school, data.users, data.parents) : quickParent.email.trim();
    if (!quickParent.password) {
      setSaveError("Mot de passe requis pour créer le compte Firebase Auth du parent.");
      return;
    }

    const existingStudent = data.students.find((student) => student.id === form.id);
    if (!existingStudent) {
      const pendingParent = { parentId, fullName: quickParent.fullName.trim(), phone: quickParent.phone.trim(), email: resolvedEmail, password: quickParent.password };
      setPendingQuickParent(pendingParent);
      setForm({ ...form, parentId });
      setQuickParent(emptyQuickParent(nextParentEmail(school, data.users, data.parents)));
      setQuickParentFeedback("Parent prêt et sélectionné. Il sera créé lors de l’enregistrement de l’élève.");
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
        studentIds: [existingStudent.id],
        status: "active",
      });
      updateData({
        students: data.students.map((student) => student.id === existingStudent.id ? { ...student, parentId: provisioned.parent.id } : student),
        parents: [...data.parents, provisioned.parent],
        users: [...data.users, provisioned.user],
      }, { persist: false });
      setForm({ ...form, parentId: provisioned.parent.id });
      setQuickParent(emptyQuickParent(nextParentEmail(school, [...data.users, provisioned.user], [...data.parents, provisioned.parent])));
      setQuickParentFeedback("Parent créé et sélectionné avec succès.");
    } catch (error) {
      setSaveError(error instanceof Error ? `Création Firebase Auth parent impossible : ${error.message}` : "Création Firebase Auth parent impossible.");
    }
  }

  async function addSchoolOption(option: string) {
    if (!studentCapabilities.canManageOptions) return;
    const trimmed = option.trim();
    if (!trimmed) return;
    try {
      const persisted = await persistSchoolOption(school.id, trimmed);
      updateData({ schools: data.schools.map((item) => (item.id === school.id ? { ...item, schoolOptions: persisted.schoolOptions } : item)) }, { persist: false });
      const selectedClass = structuredClasses.find((item) => !item.parentClassId && (item.id === form.classId || item.name === form.className));
      setForm({ ...form, option: persisted.option, classOptionKey: selectedClass ? schoolClassOptionKey(selectedClass.id, persisted.option) : undefined, subClassId: undefined });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Impossible d'enregistrer cette option scolaire.");
    }
  }

  function printStudentsPdf() {
    const filters = [
      `Recherche: ${query || "Toutes"}`,
      `Statut: ${archiveFilter === "active" ? "Actifs" : archiveFilter === "archived" ? "Archivés" : "Tous"}`,
      `Section: ${sectionFilter === "all" ? "Toutes les sections" : schoolSectionLabels[sectionFilter]}`,
      `Classe: ${classFilter || "Toutes les classes"}`,
      `Option: ${optionFilter || "Toutes les options"}`,
    ];
    exportStudentsPdf(school, year, sortStudentsForPdfByClass(students), filters);
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
            className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0"
          >
            <option value="all">Toutes les sections</option>
            {studentSectionChoices.map((section) => (
              <option key={section} value={section}>{schoolSectionLabels[section]}</option>
            ))}
          </select>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            <option value="">Toutes les classes</option>
            {availableClasses.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
          <select value={optionFilter} onChange={(event) => setOptionFilter(event.target.value)} className="min-w-0 w-full rounded border border-slate-200 bg-white px-3 py-2 lg:flex-1 lg:basis-0">
            <option value="">Toutes les options</option>
            {optionChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button onClick={printStudentsPdf} type="button" className="pdf-export-button min-w-0 px-3 lg:flex-1 lg:basis-0">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
          </div>
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
                {showActionsColumn && <th className="px-3 py-3">Actions</th>}
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
                  {showActionsColumn && <td className="px-3 py-3">
                    {studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate || canReenroll(student) ? (
                      <div className="flex gap-1">
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
                        {canReenroll(student) && <IconButton label="Réinscrire en 4ème Humanité" onClick={() => { setTerminalStudent(student); setTerminalConfirmation(""); setTerminalError(""); setTerminalFeedback(""); }} icon={RotateCcw} />}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Lecture seule</span>
                    )}
                  </td>}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {(studentCapabilities.canCreate || studentCapabilities.canEdit) && showForm && (
        <AdminDrawer title={form.id.startsWith("new") ? "Ajouter un élève" : "Modifier l'élève"} onClose={() => { setShowForm(false); setQuickParentFeedback(""); }} closeLabel="Fermer le formulaire élève">
        <StudentForm
            form={form}
            setForm={setForm}
            parents={yearData.parents}
            pendingParent={pendingQuickParent ? { id: pendingQuickParent.parentId, fullName: pendingQuickParent.fullName, phone: pendingQuickParent.phone } : undefined}
            quickParent={quickParent}
            quickParentFeedback={quickParentFeedback}
            setQuickParent={setQuickParent}
            classChoices={studentClassChoices}
            optionChoices={optionChoices}
            onAddOption={addSchoolOption}
            onCreateParent={createParentForStudent}
            onSave={saveStudent}
            onReset={() => { setForm(emptyStudent(school.id, year.id)); setPendingQuickParent(undefined); setQuickParentFeedback(""); }}
            errorMessage={saveError}
            isSaving={isSaving}
            canCreateParent={studentCapabilities.canCreateParent}
          canAddOption={studentCapabilities.canManageOptions}
          structuredClasses={structuredClasses}
          onAddSubclasses={(parent, labels, classOptionKey) => createSchoolSubclasses({ user, parent, labels, classOptionKey, existing: structuredClasses })}
          />
        </AdminDrawer>
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
      {studentCapabilities.canReactivate && reactivationStudent && (
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
      {terminalFeedback && <p role="status" className="fixed bottom-24 right-4 z-[80] max-w-sm rounded border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-800 shadow-lg">{terminalFeedback}</p>}
      {terminalStudent && activeTargetYear && (
        <AdminDrawer title="Réinscrire l’élève" onClose={() => !terminalBusy && setTerminalStudent(undefined)} closeLabel="Fermer la réinscription">
          <div className="grid min-w-0 gap-4">
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Réinscrire <strong>{terminalStudent.nom} {terminalStudent.postnom} {terminalStudent.prenom}</strong> en 4ème Humanité pour l’année scolaire {activeTargetYear.name} ?
            </p>
            {terminalError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{terminalError}</p>}
            <label className="grid gap-1 text-sm font-semibold">Phrase de confirmation
              <input className="input" value={terminalConfirmation} disabled={terminalBusy} placeholder="REINSCRIRE CET ELEVE" onChange={(event) => setTerminalConfirmation(event.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="secondary-button justify-center" disabled={terminalBusy} onClick={() => setTerminalStudent(undefined)}>Annuler</button>
              <button type="button" className="primary-button justify-center" disabled={terminalBusy || terminalConfirmation !== "REINSCRIRE CET ELEVE"} onClick={() => void reenrollTerminal()}>{terminalBusy ? "Réinscription…" : "Réinscrire"}</button>
            </div>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
