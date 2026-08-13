import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Edit3, Eye, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { StudentForm } from "../../components/students/StudentForm";
import { AdminDrawer, IconButton, SectionTitle } from "../../components/ui";
import { persistFirestorePatch } from "../../services/firestoreData";
import { provisionParent } from "../../services/provisioning";
import { createAuditLog } from "../../utils/audit";
import { nextParentEmail, parentEmailExists } from "../../utils/parents";
import { getSchoolClassChoices, getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { normalizeSchoolOptions } from "../../utils/schoolOptions";
import { formatStudentClassName, getClassSection } from "../../utils/studentClasses";
import { emptyStudent, generateMatricule, isArchivedStudent, validateStudentForSave } from "../../utils/studentUtils";
import { exportStudentsPdf, sortStudentsForPdfByClass } from "../../utils/studentPdf";
import type { AppData, AppUser, ParentProfile, School, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import type { SchoolClassRecord } from "../../types";
import { activeSubclasses, createSchoolSubclasses, schoolClassOptionKey, secondarySubclassesForOption, subscribeToSchoolClasses } from "../../services/schoolSubclasses";

export interface StudentModuleCapabilities {
  canCreate: boolean;
  canEdit: boolean;
  canArchive: boolean;
  canReactivate: boolean;
  canCreateParent: boolean;
  canManageOptions: boolean;
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
  const [quickParent, setQuickParent] = useState({ fullName: "", phone: "", email: "", password: "" });
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
  const defaultCanManage = user.role === "school_admin" && year.status !== "archived";
  const studentCapabilities: StudentModuleCapabilities = {
    canCreate: capabilities?.canCreate ?? defaultCanManage,
    canEdit: capabilities?.canEdit ?? defaultCanManage,
    canArchive: capabilities?.canArchive ?? defaultCanManage,
    canReactivate: capabilities?.canReactivate ?? defaultCanManage,
    canCreateParent: capabilities?.canCreateParent ?? defaultCanManage,
    canManageOptions: capabilities?.canManageOptions ?? defaultCanManage,
  };
  const showActionsColumn = studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate;
  const studentSectionChoices = getSchoolSections(school).filter((section) => !allowedSections?.length || allowedSections.includes(section));
  const studentClassChoices = getSchoolClassChoices(school).filter((className) => studentSectionChoices.includes(getClassSection(className)));
  const availableClasses = studentClassChoices.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);
  const schoolOptions = normalizeSchoolOptions(school.schoolOptions);
  const optionChoices = Array.from(new Set([...schoolOptions, ...yearData.students.map((student) => student.option).filter(Boolean)])) as string[];
  const emptyCurrentStudent = () => {
    const className = studentClassChoices[0] ?? CLASSES[0];
    return { ...emptyStudent(school.id, year.id), className, section: getClassSection(className) };
  };

  useEffect(() => {
    return subscribeToSchoolClasses(school.id, year.id, setStructuredClasses, (cause) => setSaveError(cause.message));
  }, [school.id, year.id]);
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
      student.schoolId === school.id &&
      student.schoolYearId === year.id &&
      (!allowedSections?.length || allowedSections.includes(getClassSection(student.className))) &&
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
      const selectedOptionKey = selectedClass && form.option ? schoolClassOptionKey(selectedClass.id, form.option) : undefined;
      const selectedSubclasses = selectedClass
        ? getClassSection(form.className) === "Secondaire"
          ? secondarySubclassesForOption(structuredClasses, selectedClass.id, selectedOptionKey, form.subClassId)
          : activeSubclasses(structuredClasses, selectedClass.id)
        : [];
      if (selectedSubclasses.length >= 2 && !form.subClassId) { setSaveError("La sous-classe est obligatoire pour cette option subdivisée."); return; }
      if (form.subClassId && !selectedSubclasses.some((item) => item.id === form.subClassId)) { setSaveError("La sous-classe sélectionnée n’appartient pas à cette classe."); return; }
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
      if (selectedOptionKey) student.classOptionKey = selectedOptionKey;
      else delete student.classOptionKey;
      if (!student.classId) delete student.classId;
      if (!student.subClassId) delete student.subClassId;
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
      const auditLog = createAuditLog(user, school.id, targetYearId, exists ? "Modification élève" : "Création élève", `${student.matricule} - ${student.nom} ${student.prenom}`, uid);
      await persistFirestorePatch(
        {
          students: [student],
          ...(changedParents.length ? { parents: changedParents } : {}),
          auditLogs: [auditLog],
        },
        { throwOnError: true },
      );
      updateData({
        students: nextStudents,
        parents,
        users,
        auditLogs: [auditLog, ...data.auditLogs],
      }, { persist: false });
      setForm(emptyCurrentStudent());
      setQuickParent({ fullName: "", phone: "", email: "", password: "" });
      setShowForm(false);
      setSaveMessage(exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.");
    } catch (error) {
      setSaveError(error instanceof Error ? `Impossible d'enregistrer l'élève : ${error.message}` : "Impossible d'enregistrer l'élève. Veuillez réessayer.");
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }

  function openAddStudentForm() {
    if (!studentCapabilities.canCreate) return;
    setForm(emptyCurrentStudent());
    setQuickParent({ fullName: "", phone: "", email: nextParentEmail(school, data.users, data.parents), password: "" });
    setSaveError("");
    setSaveMessage("");
    setShowForm(true);
  }

  function openEditStudentForm(student: Student) {
    if (!studentCapabilities.canEdit || isArchivedStudent(student)) return;
    setForm(student);
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
    if (!studentCapabilities.canManageOptions) return;
    const trimmed = option.trim();
    if (!trimmed) return;
    const nextOptions = schoolOptions.some((item) => item.toLowerCase() === trimmed.toLowerCase())
      ? schoolOptions
      : [...schoolOptions, trimmed];
    updateData({ schools: data.schools.map((item) => (item.id === school.id ? { ...item, schoolOptions: nextOptions } : item)) });
    const selectedClass = structuredClasses.find((item) => !item.parentClassId && (item.id === form.classId || item.name === form.className));
    setForm({ ...form, option: trimmed, classOptionKey: selectedClass ? schoolClassOptionKey(selectedClass.id, trimmed) : undefined, subClassId: undefined });
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
                  <td className="px-3 py-3">
                    {studentCapabilities.canEdit || studentCapabilities.canArchive || studentCapabilities.canReactivate ? (
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
      {(studentCapabilities.canCreate || studentCapabilities.canEdit) && showForm && (
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
    </section>
  );
}
