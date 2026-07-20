import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Banknote, BarChart3, BookOpen, CheckCircle2, Clock3, LogOut, Plus, RefreshCw, Settings, ShieldCheck, Trash2, UserRound, UsersRound, X } from "lucide-react";
import { AdminDrawer, Field, ImageUploadField, PasswordField } from "../../components/ui";
import { ParentsDirectoryDrawer } from "../../components/parents/ParentsDirectoryDrawer";
import { ValvesDrawerContent } from "../../components/valves/ValvesDrawerContent";
import type { ValveAttachmentDraft } from "../../components/valves/ValvesDrawerContent";
import { canUseFirestoreData, persistFirestorePatch } from "../../services/firestoreData";
import { deleteParentAccount, provisionSchoolUser } from "../../services/provisioning";
import { buildFeeTargetChoices, feeTargetClassName } from "../../utils/feeTargets";
import { getSchoolEducationLevels } from "../../utils/schoolConfig";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { AppData, AppUser, AuditLog, FeeKind, FeeType, ParentProfile, School, SchoolYear, Student, ValvePublication } from "../../types";
import { FEE_KINDS } from "../../types";

type SchoolUserProvisionRole = "cashier" | "discipline_director";

type MenuYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  valves: ValvePublication[];
};

type ValveDownloadAttachment = {
  name: string;
  type: string;
  size: number;
  url?: string;
};

type MenuModuleProps = {
  user: AppUser;
  data: AppData;
  yearData: MenuYearData;
  school: School;
  years: SchoolYear[];
  selectedYear: SchoolYear;
  onYearChange: (id: string) => void;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onLogout: () => void;
  valvesUploadsEnabled: boolean;
  onCreateParentFromDirectory: () => void;
  onEditParentFromDirectory: (parent: ParentProfile) => void;
  createId: (prefix: string) => string;
  createAuditLog: (user: AppUser, schoolId: string, schoolYearId: string, action: string, details: string) => AuditLog;
  nextSchoolYearDefaults: (year: SchoolYear) => { name: string; startsAt: string; endsAt: string };
  schoolEducationLevelChoices: string[];
  feeTargetHasOption: (target: string) => boolean;
  formatFeeTargetLabel: (fee: Pick<FeeType, "className" | "classOptionKey">) => string;
  renderFinancialReport: () => ReactNode;
  renderActivityHistory: (role: "admin" | "cashier") => ReactNode;
  getPublicationAttachmentDrafts: (publication: ValvePublication) => ValveAttachmentDraft[];
  getPublicationDownloadAttachments: (publication: ValvePublication) => ValveDownloadAttachment[];
  getValveAttachmentKey: (attachment: Pick<ValveAttachmentDraft, "name" | "size" | "path" | "url">) => string;
  validateValveAttachmentDrafts: (attachments: ValveAttachmentDraft[]) => string;
  getValvePublicationErrorMessage: (error: unknown, fallback: string) => string;
  getApproximateValveDocumentSize: (publication: ValvePublication) => number;
  maxValveDocumentBytes: number;
};

const schoolUserProvisionLabels: Record<SchoolUserProvisionRole, string> = {
  cashier: "Caissier",
  discipline_director: "Directeur de Discipline",
};

export function MenuModule({
  user,
  data,
  yearData,
  school,
  years,
  selectedYear,
  onYearChange,
  updateData,
  onLogout,
  valvesUploadsEnabled,
  onCreateParentFromDirectory,
  onEditParentFromDirectory,
  createId,
  createAuditLog,
  nextSchoolYearDefaults,
  schoolEducationLevelChoices,
  feeTargetHasOption,
  formatFeeTargetLabel,
  renderFinancialReport,
  renderActivityHistory,
  getPublicationAttachmentDrafts,
  getPublicationDownloadAttachments,
  getValveAttachmentKey,
  validateValveAttachmentDrafts,
  getValvePublicationErrorMessage,
  getApproximateValveDocumentSize,
  maxValveDocumentBytes,
}: MenuModuleProps) {
  type MenuSection = "school" | "years" | "accounts" | "fees" | "financial" | "valves" | "parentsDirectory" | "history";
  const [schoolForm, setSchoolForm] = useState(school);
  const [schoolSaveStatus, setSchoolSaveStatus] = useState<"success" | "error" | "">("");
  const [schoolSaveMessage, setSchoolSaveMessage] = useState("");
  const [schoolSaving, setSchoolSaving] = useState(false);
  const [schoolUserRole, setSchoolUserRole] = useState<SchoolUserProvisionRole>("cashier");
  const [cashierName, setCashierName] = useState("");
  const [cashierPhone, setCashierPhone] = useState("");
  const [cashierEmail, setCashierEmail] = useState("");
  const [cashierPassword, setCashierPassword] = useState("");
  const [cashierError, setCashierError] = useState("");
  const [cashierSuccess, setCashierSuccess] = useState("");
  const [showCashierPassword, setShowCashierPassword] = useState(false);
  const [feeName, setFeeName] = useState<FeeKind>("Minerval");
  const [feeClassNames, setFeeClassNames] = useState<string[]>([]);
  const [feeAmount, setFeeAmount] = useState("100");
  const [editingFeeId, setEditingFeeId] = useState("");
  const [showNewFeeForm, setShowNewFeeForm] = useState(false);
  const [newFeeName, setNewFeeName] = useState("");
  const [customFeeKindChoices, setCustomFeeKindChoices] = useState<FeeKind[]>([]);
  const [newFeeError, setNewFeeError] = useState("");
  const [schoolOptionDraft, setSchoolOptionDraft] = useState("");
  const [feeDeleteTarget, setFeeDeleteTarget] = useState<FeeType | null>(null);
  const [feeDeleteConfirmation, setFeeDeleteConfirmation] = useState("");
  const [activeMenuSection, setActiveMenuSection] = useState<MenuSection | null>(null);
  const [newYearOpen, setNewYearOpen] = useState(false);
  const [newYearForm, setNewYearForm] = useState(() => nextSchoolYearDefaults(selectedYear));
  const [newYearConfirmation, setNewYearConfirmation] = useState("");
  const [newYearError, setNewYearError] = useState("");
  const [yearAction, setYearAction] = useState<{ type: "activate" | "archive"; yearId: string } | null>(null);
  const [yearActionConfirmation, setYearActionConfirmation] = useState("");
  const [yearActionError, setYearActionError] = useState("");
  const [parentDeleteOpen, setParentDeleteOpen] = useState(false);
  const [parentDeleteId, setParentDeleteId] = useState("");
  const [parentDeleteConfirmation, setParentDeleteConfirmation] = useState("");
  const [parentDeleteError, setParentDeleteError] = useState("");
  const [parentDeleteSaving, setParentDeleteSaving] = useState(false);
  const isArchivedContext = selectedYear.status === "archived";
  const canAdmin = user.role === "school_admin" && !isArchivedContext;
  const menuSections = [
    { id: "valves", title: "Valves", description: "Communiqués, palmarès, points, images et documents.", icon: BookOpen },
    { id: "parentsDirectory", title: "Parents / Tuteurs", description: "Annuaire interne des parents liés aux élèves.", icon: UsersRound },
    { id: "fees", title: "Types de frais", description: "Montants et catégories de frais scolaires.", icon: Banknote },
    { id: "financial", title: "Rapport financier", description: "Synthèse et exports des rapports financiers.", icon: BarChart3 },
    { id: "history", title: "Historique", description: "Activités et messages enregistrés pour ce compte.", icon: Clock3 },
    { id: "accounts", title: "Créer un utilisateur", description: "Compte de connexion caissier ou discipline lié à l'école.", icon: ShieldCheck },
    { id: "years", title: "Années scolaires", description: "Année active, années archivées et contexte global.", icon: BookOpen },
    { id: "school", title: "Paramètres école", description: "Logo, coordonnées et informations de l'établissement.", icon: Settings },
  ] satisfies { id: MenuSection; title: string; description: string; icon: typeof Settings }[];
  const persistedCustomFeeKindChoices = selectedYear.customFeeKindChoices ?? [];
  const feeKindChoices = Array.from(new Set([...FEE_KINDS, ...yearData.feeTypes.map((fee) => fee.name), ...persistedCustomFeeKindChoices, ...customFeeKindChoices]));
  const newFeeFormRef = useRef<HTMLDivElement>(null);
  const schoolFormEducationLevels = getSchoolEducationLevels(schoolForm).filter((level) => level !== "Mixte");
  const schoolFormOptions = schoolForm.schoolOptions ?? [];
  const feeClassChoices = buildFeeTargetChoices(yearData.students, feeClassNames);
  const parentDeleteTarget = yearData.parents.find((parent) => parent.id === parentDeleteId && parent.schoolId === school.id);
  const parentDeleteChildren = parentDeleteTarget
    ? yearData.students.filter((student) => student.parentId === parentDeleteTarget.id || parentDeleteTarget.studentIds.includes(student.id))
    : [];

  useEffect(() => {
    if (!showNewFeeForm) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (newFeeFormRef.current?.contains(target)) return;
      setShowNewFeeForm(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showNewFeeForm]);
  useEffect(() => {
    if (!schoolSaveStatus) return;
    const timer = window.setTimeout(() => {
      setSchoolSaveStatus("");
      setSchoolSaveMessage("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [schoolSaveStatus, schoolSaveMessage]);
  useEffect(() => {
    if (!cashierError && !cashierSuccess) return;
    const timer = window.setTimeout(() => {
      setCashierError("");
      setCashierSuccess("");
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [cashierError, cashierSuccess]);

  function openParentDeleteDrawer() {
    setParentDeleteOpen(true);
    setParentDeleteId("");
    setParentDeleteConfirmation("");
    setParentDeleteError("");
  }

  function closeParentDeleteDrawer() {
    if (parentDeleteSaving) return;
    setParentDeleteOpen(false);
    setParentDeleteId("");
    setParentDeleteConfirmation("");
    setParentDeleteError("");
  }

  async function confirmDeleteParent() {
    setParentDeleteError("");
    if (!parentDeleteTarget) {
      setParentDeleteError("Veuillez sélectionner un parent à supprimer.");
      return;
    }
    if (parentDeleteTarget.schoolId !== school.id) {
      setParentDeleteError("Suppression refusée : ce parent n'appartient pas à cette école.");
      return;
    }
    if (parentDeleteConfirmation !== "SUPPRIMER LE PARENT") {
      setParentDeleteError("Veuillez saisir exactement SUPPRIMER LE PARENT pour confirmer.");
      return;
    }

    setParentDeleteSaving(true);
    try {
      const result = await deleteParentAccount({
        schoolId: school.id,
        parentId: parentDeleteTarget.id,
        confirmation: parentDeleteConfirmation,
      });
      updateData(
        {
          parents: data.parents.filter((parent) => parent.id !== parentDeleteTarget.id),
          users: data.users.filter((item) => item.parentId !== parentDeleteTarget.id && item.id !== parentDeleteTarget.userId),
          students: data.students.map((student) => (student.parentId === parentDeleteTarget.id ? { ...student, parentId: undefined } : student)),
        },
        { persist: false },
      );
      setSchoolSaveStatus(result.status === "partial" ? "error" : "success");
      setSchoolSaveMessage(
        result.status === "partial"
          ? "Parent supprimé, mais le compte Firebase Authentication n'a pas pu être supprimé. Vérifiez le compte concerné."
          : "Parent supprimé avec succès.",
      );
      setParentDeleteOpen(false);
      setParentDeleteId("");
      setParentDeleteConfirmation("");
      setParentDeleteError("");
    } catch (error) {
      setParentDeleteError(error instanceof Error ? error.message : "Suppression du parent impossible. Veuillez réessayer.");
    } finally {
      setParentDeleteSaving(false);
    }
  }

  async function saveSchool() {
    if (schoolSaving) return;
    setSchoolSaving(true);
    setSchoolSaveStatus("");
    setSchoolSaveMessage("");
    const nextMotto = schoolForm.motto?.trim();
    const existingMotto = school.motto?.trim();
    const savedSchool = { ...schoolForm, motto: nextMotto || existingMotto || "" };
    const nextSchools = data.schools.map((item) => (item.id === school.id ? savedSchool : item));
    try {
      const persisted = await persistFirestorePatch({ schools: nextSchools }, { throwOnError: true });
      if (canUseFirestoreData() && persisted === false) {
        throw new Error("Persistance Firestore indisponible.");
      }
      updateData({ schools: nextSchools }, { persist: false });
      setSchoolForm(savedSchool);
      setSchoolSaveStatus("success");
      setSchoolSaveMessage("Paramètres de l'école enregistrés avec succès.");
      setActiveMenuSection(null);
    } catch (error) {
      console.warn("Enregistrement des paramètres école impossible.", error);
      setSchoolSaveStatus("error");
      setSchoolSaveMessage("Impossible d'enregistrer les paramètres de l'école. Veuillez réessayer.");
    } finally {
      setSchoolSaving(false);
    }
  }

  function activateYear(yearId: string) {
    updateData({
      schools: data.schools.map((item) => (item.id === school.id ? { ...item, activeSchoolYearId: yearId } : item)),
      schoolYears: data.schoolYears.map((year) =>
        year.schoolId === school.id ? { ...year, status: year.id === yearId ? "active" : year.status === "active" ? "draft" : year.status } : year,
      ),
    });
    onYearChange(yearId);
    setSchoolForm({ ...schoolForm, activeSchoolYearId: yearId });
  }

  function archiveYear(yearId: string) {
    updateData({ schoolYears: data.schoolYears.map((year) => (year.id === yearId ? { ...year, status: "archived" } : year)) });
  }

  function openYearAction(type: "activate" | "archive", yearId: string) {
    setYearActionConfirmation("");
    setYearActionError("");

    if (type === "archive") {
      const targetYear = years.find((year) => year.id === yearId);
      const activeYearsCount = years.filter((year) => year.status === "active").length;

      if (years.length === 1) {
        setYearActionError("Impossible d’archiver l’unique année scolaire de l’école.");
        return;
      }

      if (targetYear?.status === "active" && activeYearsCount <= 1) {
        setYearActionError("Impossible d’archiver la dernière année scolaire active.");
        return;
      }
    }

    setYearAction({ type, yearId });
  }

  function closeYearAction() {
    setYearAction(null);
    setYearActionConfirmation("");
    setYearActionError("");
  }

  function confirmYearAction() {
    if (!yearAction) return;

    const expectedConfirmation = yearAction.type === "archive" ? "ARCHIVER ECOLE" : "ACTIVER ECOLE";
    if (yearActionConfirmation !== expectedConfirmation) return;

    if (yearAction.type === "archive") {
      const targetYear = years.find((year) => year.id === yearAction.yearId);
      const activeYearsCount = years.filter((year) => year.status === "active").length;

      if (years.length === 1) {
        setYearActionError("Impossible d’archiver l’unique année scolaire de l’école.");
        return;
      }

      if (targetYear?.status === "active" && activeYearsCount <= 1) {
        setYearActionError("Impossible d’archiver la dernière année scolaire active.");
        return;
      }

      archiveYear(yearAction.yearId);
    } else {
      activateYear(yearAction.yearId);
    }

    closeYearAction();
  }

  function openNewYearForm() {
    const defaults = nextSchoolYearDefaults(years.find((year) => year.status === "active") ?? selectedYear);
    setNewYearForm(defaults);
    setNewYearConfirmation("");
    setNewYearError("");
    setNewYearOpen(true);
  }

  function createNewSchoolYear() {
    setNewYearError("");
    if (newYearConfirmation !== "CREER UNE NOUVELLE ANNEE") {
      setNewYearError("Veuillez saisir exactement CREER UNE NOUVELLE ANNEE pour confirmer.");
      return;
    }
    if (!newYearForm.name.trim() || !newYearForm.startsAt || !newYearForm.endsAt) {
      setNewYearError("Veuillez renseigner le nom, la date de début et la date de fin de la nouvelle année.");
      return;
    }
    if (years.some((year) => year.name.trim().toLowerCase() === newYearForm.name.trim().toLowerCase())) {
      setNewYearError("Une année scolaire avec ce nom existe déjà.");
      return;
    }

    const newYearId = createId("year");
    const nextUsers = data.users.map((item) => {
      if (item.schoolId !== school.id) return item;
      return {
        ...item,
        activeSchoolYearId: newYearId,
      };
    });
    const nextYear: SchoolYear = {
      id: newYearId,
      schoolId: school.id,
      name: newYearForm.name.trim(),
      startsAt: newYearForm.startsAt,
      endsAt: newYearForm.endsAt,
      status: "active",
    };

    updateData({
      schools: data.schools.map((item) => (item.id === school.id ? { ...item, activeSchoolYearId: newYearId } : item)),
      schoolYears: [
        ...data.schoolYears.map((year) =>
          year.schoolId === school.id && year.status === "active" ? { ...year, status: "archived" as const } : year,
        ),
        nextYear,
      ],
      users: nextUsers,
    });
    onYearChange(newYearId);
    setSchoolForm({ ...schoolForm, activeSchoolYearId: newYearId });
    setNewYearOpen(false);
  }

  async function saveSchoolUser() {
    setCashierError("");
    setCashierSuccess("");
    if (!cashierName || !cashierEmail || !cashierPassword) return;

    const existingUser = data.users.find((item) => item.email.toLowerCase() === cashierEmail.toLowerCase());
    if (existingUser) {
      setCashierError("Un compte existe deja avec cet email.");
      return;
    }
    let provisionedUser: AppUser | undefined;
    try {
      provisionedUser = await provisionSchoolUser({
        role: schoolUserRole,
        schoolId: school.id,
        schoolYearId: selectedYear.id,
        name: cashierName,
        email: cashierEmail,
        password: cashierPassword,
        phone: cashierPhone,
      });
    } catch (error) {
      setCashierError(error instanceof Error ? `Création Firebase Auth impossible : ${error.message}` : "Création Firebase Auth impossible.");
      return;
    }
    const auditLog = createAuditLog(user, school.id, selectedYear.id, `Création ${schoolUserProvisionLabels[schoolUserRole]}`, `${cashierName} - ${cashierEmail}`);
    updateData({ users: [...data.users, provisionedUser], auditLogs: [auditLog, ...data.auditLogs] });
    setCashierName("");
    setCashierPhone("");
    setCashierEmail("");
    setCashierPassword("");
    setShowCashierPassword(false);
    setSchoolUserRole("cashier");
    setCashierSuccess(`Compte ${schoolUserProvisionLabels[schoolUserRole].toLowerCase()} créé avec succès. Il peut maintenant se connecter avec son email et son mot de passe.`);
    window.setTimeout(() => {
      setActiveMenuSection((current) => (current === "accounts" ? null : current));
    }, 2000);
  }

  function saveFee() {
    if (!feeName || feeClassNames.length === 0 || !feeAmount) return;
    const amount = Number(feeAmount);
    const selectedClasses = Array.from(new Set(feeClassNames));
    const existingFeeKeys = new Set(
      data.feeTypes
        .filter((fee) => fee.schoolId === school.id && fee.schoolYearId === selectedYear.id && fee.id !== editingFeeId)
        .map((fee) => `${String(fee.name).trim().toLowerCase()}|${fee.classOptionKey ?? fee.className ?? ""}`),
    );
    const feesToSave = selectedClasses
      .filter((target) => !existingFeeKeys.has(`${String(feeName).trim().toLowerCase()}|${target}`))
      .map((target, index) => {
        const fee: FeeType = {
          id: editingFeeId && index === 0 ? editingFeeId : createId("fee"),
          schoolId: school.id,
          schoolYearId: selectedYear.id,
          name: feeName,
          className: feeTargetClassName(target),
          amount,
        };
        if (feeTargetHasOption(target)) {
          fee.classOptionKey = target;
        }
        return fee;
      });
    if (feesToSave.length === 0) return;
    const feeAction = editingFeeId ? "Modification type de frais" : "Ajout type de frais";
    const feeActionVerb = editingFeeId ? "modifié" : "ajouté";
    const feeAuditDetails = `Admin ${user.name} a ${feeActionVerb} le type de frais ${feeName}.`;
    updateData({
      feeTypes: editingFeeId
        ? [...data.feeTypes.map((item) => (item.id === editingFeeId ? feesToSave[0] : item)), ...feesToSave.slice(1)]
        : [...data.feeTypes, ...feesToSave],
      auditLogs: [createAuditLog(user, school.id, selectedYear.id, feeAction, feeAuditDetails), ...data.auditLogs],
    });
    setEditingFeeId("");
    setFeeName("Minerval");
    setFeeClassNames([]);
    setFeeAmount("100");
  }

  function editFee(fee: FeeType) {
    setEditingFeeId(fee.id);
    setFeeName(fee.name);
    const feeTarget = fee.classOptionKey ?? fee.className;
    setFeeClassNames(feeTarget ? [feeTarget] : []);
    setFeeAmount(String(fee.amount));
  }

  function toggleFeeClass(className: string) {
    setFeeClassNames((current) =>
      current.includes(className) ? current.filter((item) => item !== className) : [...current, className],
    );
  }

  function deleteFee(fee: FeeType) {
    setFeeDeleteTarget(fee);
    setFeeDeleteConfirmation("");
  }

  function closeFeeDeleteDialog() {
    setFeeDeleteTarget(null);
    setFeeDeleteConfirmation("");
  }

  function confirmDeleteFee() {
    if (!feeDeleteTarget || feeDeleteConfirmation !== "SUPPRIMER LE FRAIS") return;
    const fee = feeDeleteTarget;
    updateData({
      feeTypes: data.feeTypes.filter((item) => item.id !== fee.id),
      auditLogs: [
        createAuditLog(user, school.id, selectedYear.id, "Suppression type de frais", `Admin ${user.name} a supprimé le type de frais ${fee.name}.`),
        ...data.auditLogs,
      ],
    });
    closeFeeDeleteDialog();
  }

  function addFeeKind() {
    const trimmed = newFeeName.trim();
    if (!trimmed) return;
    const normalized = trimmed.toLowerCase();
    const feeKindExists = [...FEE_KINDS, ...yearData.feeTypes.map((fee) => fee.name), ...persistedCustomFeeKindChoices, ...customFeeKindChoices]
      .some((kind) => kind.trim().toLowerCase() === normalized);
    if (feeKindExists) {
      setNewFeeError("Ce type de frais existe déjà.");
      return;
    }
    const nextCustomFeeKindChoices = [...persistedCustomFeeKindChoices, trimmed];
    updateData({
      schoolYears: data.schoolYears.map((year) =>
        year.id === selectedYear.id ? { ...year, customFeeKindChoices: nextCustomFeeKindChoices } : year,
      ),
    });
    setCustomFeeKindChoices((current) => [...current, trimmed]);
    setFeeName(trimmed);
    setNewFeeName("");
    setNewFeeError("");
    setShowNewFeeForm(false);
  }

  function toggleSchoolFormEducationLevel(level: string) {
    setSchoolForm((current) => {
      const currentLevels = getSchoolEducationLevels(current).filter((item) => item !== "Mixte");
      const nextLevels = currentLevels.includes(level)
        ? currentLevels.filter((item) => item !== level)
        : [...currentLevels, level];
      const normalizedLevels = nextLevels.length > 0 ? nextLevels : currentLevels;
      return {
        ...current,
        educationLevels: normalizedLevels,
        schoolType: normalizedLevels.length === 1 ? (normalizedLevels[0] as School["schoolType"]) : "Mixte",
      };
    });
  }

  function addSchoolFormOption() {
    const trimmed = schoolOptionDraft.trim();
    if (!trimmed) return;
    setSchoolForm((current) => {
      const currentOptions = current.schoolOptions ?? [];
      const exists = currentOptions.some((option) => option.toLowerCase() === trimmed.toLowerCase());
      return exists ? current : { ...current, schoolOptions: [...currentOptions, trimmed] };
    });
    setSchoolOptionDraft("");
  }

  function removeSchoolFormOption(option: string) {
    setSchoolForm((current) => ({
      ...current,
      schoolOptions: (current.schoolOptions ?? []).filter((item) => item !== option),
    }));
  }

  function renderMenuSectionForm(sectionId: MenuSection) {
    if (sectionId === "school") {
      return (
        <div className="grid min-w-0 gap-4">
          <ImageUploadField label="Logo de l'école" value={schoolForm.logoUrl ?? ""} onChange={(value) => setSchoolForm({ ...schoolForm, logoUrl: value })} maxWidth={600} maxBytes={200 * 1024} disabled={!canAdmin} />
          <Field label="Nom de l'école" value={schoolForm.name} onChange={(value) => setSchoolForm({ ...schoolForm, name: value })} disabled={!canAdmin} />
          <Field label="Devise" value={schoolForm.motto ?? ""} onChange={(value) => setSchoolForm({ ...schoolForm, motto: value })} disabled={!canAdmin} />
          <Field label="Adresse" value={schoolForm.address} onChange={(value) => setSchoolForm({ ...schoolForm, address: value })} disabled={!canAdmin} />
          <Field label="Téléphone" value={schoolForm.phone} onChange={(value) => setSchoolForm({ ...schoolForm, phone: value })} disabled={!canAdmin} />
          <Field label="Email" value={schoolForm.email} onChange={(value) => setSchoolForm({ ...schoolForm, email: value })} disabled={!canAdmin} />
          <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Sections actuelles de l'école</legend>
            <div className="flex flex-wrap gap-2">
              {schoolEducationLevelChoices.map((level) => (
                <label key={level} className="inline-flex items-center gap-2 rounded bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={schoolFormEducationLevels.includes(level)}
                    onChange={() => toggleSchoolFormEducationLevel(level)}
                    disabled={!canAdmin || (schoolFormEducationLevels.length === 1 && schoolFormEducationLevels.includes(level))}
                    className="h-4 w-4 accent-ink disabled:opacity-50"
                  />
                  {level}
                </label>
              ))}
            </div>
            <p className="text-xs font-medium text-slate-500">Ces sections peuvent évoluer après la création de l'école.</p>
          </fieldset>
          <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Options actuelles de l'école</legend>
            <div className="flex flex-wrap gap-2">
              {schoolFormOptions.length === 0 && <p className="text-sm text-slate-500">Aucune option configurée.</p>}
              {schoolFormOptions.map((option) => (
                <span key={option} className="inline-flex items-center gap-2 rounded bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  {option}
                  {canAdmin && (
                    <button onClick={() => removeSchoolFormOption(option)} type="button" className="text-red-600 hover:text-red-700" aria-label={`Retirer l'option ${option}`}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {canAdmin && (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input value={schoolOptionDraft} onChange={(event) => setSchoolOptionDraft(event.target.value)} className="input" placeholder="Nouvelle option" />
                <button onClick={addSchoolFormOption} type="button" className="secondary-button justify-center">
                  <Plus className="h-4 w-4" /> Ajouter
                </button>
              </div>
            )}
            <p className="text-xs font-medium text-slate-500">Les options configurées ici alimentent les élèves, filtres et listes de l'école.</p>
          </fieldset>
          <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">Année scolaire : {selectedYear.name}</p>
          {schoolSaveStatus === "error" && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{schoolSaveMessage}</p>}
          {canAdmin && (
            <button onClick={saveSchool} disabled={schoolSaving} className="primary-button disabled:cursor-not-allowed disabled:opacity-60" type="button">
              <RefreshCw className={`h-4 w-4 ${schoolSaving ? "animate-spin" : "hidden"}`} />
              {!schoolSaving && <Settings className="h-4 w-4" />}
              {schoolSaving ? "Enregistrement..." : "Enregistrer"}
            </button>
          )}
        </div>
      );
    }

    if (sectionId === "years") {
      return (
        <div className="grid min-w-0 gap-4">
          {isArchivedContext && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
              Vous consultez une année scolaire archivée en lecture seule. Revenez à l'année active pour créer ou modifier des données.
            </p>
          )}
          {canAdmin && (
            <div className="flex justify-end">
              <button onClick={openNewYearForm} type="button" className="primary-button shadow-sm">
                <Plus className="h-4 w-4" /> Nouvelle année
              </button>
            </div>
          )}
          {yearActionError && !yearAction && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{yearActionError}</p>}
          {newYearOpen && canAdmin && (
            <div className="grid min-w-0 gap-3 rounded border border-amber-200 bg-amber-50 p-4">
              <div className="min-w-0">
                <p className="font-bold text-ink">Créer une nouvelle année scolaire</p>
                <p className="mt-1 text-sm text-amber-800">
                  Cette opération crée une nouvelle année scolaire active et archive automatiquement l'année active précédente. Les données historiques restent consultables dans leur dossier d'archives.
                </p>
              </div>
              {newYearError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{newYearError}</p>}
              <Field label="Nom de la nouvelle année" value={newYearForm.name} onChange={(value) => setNewYearForm({ ...newYearForm, name: value })} />
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                <Field label="Date de début" value={newYearForm.startsAt} onChange={(value) => setNewYearForm({ ...newYearForm, startsAt: value })} type="date" />
                <Field label="Date de fin" value={newYearForm.endsAt} onChange={(value) => setNewYearForm({ ...newYearForm, endsAt: value })} type="date" />
              </div>
              <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
                Confirmation obligatoire
                <input value={newYearConfirmation} onChange={(event) => setNewYearConfirmation(event.target.value)} className="input" placeholder="CREER UNE NOUVELLE ANNEE" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button onClick={createNewSchoolYear} type="button" className="primary-button">
                  <CheckCircle2 className="h-4 w-4" /> Créer l'année
                </button>
                <button onClick={() => setNewYearOpen(false)} type="button" className="secondary-button">
                  Annuler
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {years.map((year) => (
              <div key={year.id} className={`flex min-w-0 flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between ${year.id === selectedYear.id ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-white"}`}>
                <button onClick={() => onYearChange(year.id)} className="min-w-0 text-left" type="button">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-ink">{year.name}</p>
                    {year.id === selectedYear.id && <span className="rounded bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Contexte actuel</span>}
                    {year.status === "active" && <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Active</span>}
                    {year.status === "archived" && <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">Archivée</span>}
                  </div>
                  <p className="text-xs text-slate-500">{year.startsAt} au {year.endsAt}</p>
                </button>
                <div>
                  <p className="text-xs font-medium capitalize text-slate-500">{year.status}</p>
                </div>
                {canAdmin && (
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openYearAction("activate", year.id)} className="rounded bg-mint px-3 py-2 text-xs font-semibold text-white" type="button">Activer</button>
                    {year.status !== "archived" && <button onClick={() => openYearAction("archive", year.id)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">Archiver</button>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {yearAction && (
            <div className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
              <div className="min-w-0">
                <p className="font-bold text-ink">{yearAction.type === "archive" ? "Confirmer l'archivage" : "Confirmer l'activation"}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {yearAction.type === "archive"
                    ? "Cette action archive l'année scolaire sélectionnée. Les données restent conservées et consultables."
                    : "Cette action définit l'année scolaire sélectionnée comme année active de l'école."}
                </p>
              </div>
              {yearActionError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{yearActionError}</p>}
              <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
                Confirmation obligatoire
                <input
                  value={yearActionConfirmation}
                  onChange={(event) => setYearActionConfirmation(event.target.value)}
                  className="input"
                  placeholder={yearAction.type === "archive" ? "ARCHIVER ECOLE" : "ACTIVER ECOLE"}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={confirmYearAction}
                  disabled={yearActionConfirmation !== (yearAction.type === "archive" ? "ARCHIVER ECOLE" : "ACTIVER ECOLE")}
                  className="primary-button disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                >
                  <CheckCircle2 className="h-4 w-4" /> Confirmer
                </button>
                <button onClick={closeYearAction} type="button" className="secondary-button">
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (sectionId === "accounts" && canAdmin) {
      return (
        <div className="grid min-w-0 gap-4">
          {cashierError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{cashierError}</p>}
          {cashierSuccess && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{cashierSuccess}</p>}
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Type d'utilisateur
            <select value={schoolUserRole} onChange={(event) => setSchoolUserRole(event.target.value as SchoolUserProvisionRole)} className="input">
              <option value="cashier">Caissier</option>
              <option value="discipline_director">Directeur de Discipline</option>
            </select>
          </label>
          <Field label="Nom complet" value={cashierName} onChange={setCashierName} />
          <Field label="Téléphone" value={cashierPhone} onChange={setCashierPhone} />
          <Field label="Email" value={cashierEmail} onChange={setCashierEmail} />
          <PasswordField
            label="Mot de passe temporaire"
            value={cashierPassword}
            onChange={setCashierPassword}
            visible={showCashierPassword}
            onToggle={() => setShowCashierPassword(!showCashierPassword)}
          />
          <button onClick={saveSchoolUser} disabled={!cashierName || !cashierEmail || !cashierPassword} className="primary-button disabled:opacity-50" type="button">
            <UserRound className="h-4 w-4" /> Créer l'utilisateur
          </button>
        </div>
      );
    }

    if (sectionId === "fees" && canAdmin) {
      return (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_120px_auto]">
            <select
              value={feeName}
              onChange={(event) => {
                if (event.target.value === "__add_fee__") {
                  setShowNewFeeForm(true);
                  return;
                }
                setFeeName(event.target.value);
              }}
              className="input"
            >
              {feeKindChoices.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
              <option value="__add_fee__">Ajouter un frais</option>
            </select>
            <fieldset className="max-h-40 min-w-0 overflow-y-auto rounded border border-slate-200 bg-white p-2 text-sm text-slate-700 scrollbar-thin">
              <legend className="mb-1 px-1 text-xs font-semibold text-slate-500">Classes concernées</legend>
              <div className="grid gap-1">
                {feeClassChoices.map((choice) => (
                  <label key={choice.value} className="flex min-w-0 items-center gap-2 rounded px-2 py-1 hover:bg-slate-50">
                    <input type="checkbox" checked={feeClassNames.includes(choice.value)} onChange={() => toggleFeeClass(choice.value)} className="h-4 w-4 shrink-0 accent-[#1E3A8A]" />
                    <span className="min-w-0 break-words">{choice.label}</span>
                  </label>
                ))}
                {feeClassChoices.length === 0 && (
                  <p className="rounded bg-slate-50 p-2 text-xs text-slate-500">Aucune classe n'est disponible pour cette école.</p>
                )}
              </div>
            </fieldset>
            <input value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} type="number" className="input" />
            <button onClick={saveFee} disabled={feeClassNames.length === 0} className="primary-button w-full justify-center disabled:opacity-50 sm:w-auto" type="button"><Plus className="h-4 w-4" /> {editingFeeId ? "Enregistrer" : "Ajouter"}</button>
          </div>
          {editingFeeId && (
            <button
              onClick={() => {
                setEditingFeeId("");
                setFeeName("Minerval");
                setFeeClassNames([]);
                setFeeAmount("100");
              }}
              className="secondary-button w-fit"
              type="button"
            >
              Annuler la modification
            </button>
          )}
          {showNewFeeForm && (
            <div ref={newFeeFormRef} className="rounded border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">Nouveau frais</p>
              {newFeeError && <p className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-sm font-semibold text-red-700">{newFeeError}</p>}
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={newFeeName}
                  onChange={(event) => {
                    setNewFeeName(event.target.value);
                    setNewFeeError("");
                  }}
                  className="input"
                  placeholder="Nom du frais"
                />
                <button onClick={addFeeKind} type="button" className="primary-button w-full justify-center sm:w-auto">
                  <Plus className="h-4 w-4" /> Ajouter le frais
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {yearData.feeTypes.map((fee) => (
              <div key={fee.id} className="flex min-w-0 flex-col gap-3 rounded bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-words font-semibold text-ink">{fee.name} - {formatFeeTargetLabel(fee)}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <strong>${fee.amount}</strong>
                  <button onClick={() => editFee(fee)} type="button" className="rounded bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
                    Modifier
                  </button>
                  <button onClick={() => deleteFee(fee)} type="button" className="rounded bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100">
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
          {feeDeleteTarget && (
            <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" role="dialog" aria-modal="true" aria-labelledby="fee-delete-title">
              <section className="w-full max-w-md rounded border border-slate-200 bg-white p-4 shadow-2xl">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <h2 id="fee-delete-title" className="break-words text-lg font-bold text-ink">Supprimer le frais</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">
                      {feeDeleteTarget.name} - {formatFeeTargetLabel(feeDeleteTarget)}
                    </p>
                  </div>
                  <button onClick={closeFeeDeleteDialog} type="button" className="rounded bg-slate-100 p-2 text-slate-700" aria-label="Annuler la suppression du frais">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-4 grid gap-3">
                  <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                    Pour confirmer la suppression, saisissez exactement : SUPPRIMER LE FRAIS
                  </p>
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Phrase de confirmation
                    <input
                      value={feeDeleteConfirmation}
                      onChange={(event) => setFeeDeleteConfirmation(event.target.value)}
                      className="input"
                      placeholder="SUPPRIMER LE FRAIS"
                    />
                  </label>
                  {feeDeleteConfirmation && feeDeleteConfirmation !== "SUPPRIMER LE FRAIS" && (
                    <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                      Phrase incorrecte. Veuillez saisir exactement : SUPPRIMER LE FRAIS
                    </p>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button onClick={closeFeeDeleteDialog} type="button" className="secondary-button justify-center">
                      Annuler
                    </button>
                    <button
                      onClick={confirmDeleteFee}
                      disabled={feeDeleteConfirmation !== "SUPPRIMER LE FRAIS"}
                      type="button"
                      className="inline-flex items-center justify-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" /> Supprimer
                    </button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      );
    }

    if (sectionId === "financial") {
      return (
        <div className="grid min-w-0 gap-4">
          {renderFinancialReport()}
        </div>
      );
    }

    if (sectionId === "valves" && (canAdmin || user.role === "cashier")) {
      return (
        <ValvesDrawerContent
          user={user}
          data={data}
          yearData={yearData}
          school={school}
          year={selectedYear}
          updateData={updateData}
          canManage={canAdmin}
          valvesUploadsEnabled={valvesUploadsEnabled}
          createId={createId}
          createAuditLog={createAuditLog}
          getPublicationAttachmentDrafts={getPublicationAttachmentDrafts}
          getPublicationDownloadAttachments={getPublicationDownloadAttachments}
          getValveAttachmentKey={getValveAttachmentKey}
          validateValveAttachmentDrafts={validateValveAttachmentDrafts}
          getValvePublicationErrorMessage={getValvePublicationErrorMessage}
          getApproximateValveDocumentSize={getApproximateValveDocumentSize}
          maxValveDocumentBytes={maxValveDocumentBytes}
        />
      );
    }

    if (sectionId === "parentsDirectory" && canAdmin) {
      return (
        <ParentsDirectoryDrawer
          parents={yearData.parents}
          students={yearData.students}
          school={school}
          year={selectedYear}
          schoolId={school.id}
          schoolYearId={selectedYear.id}
          onCreateParent={onCreateParentFromDirectory}
          onEditParent={onEditParentFromDirectory}
          onDeleteParent={openParentDeleteDrawer}
        />
      );
    }

    if (sectionId === "history") {
      return renderActivityHistory(user.role === "cashier" ? "cashier" : "admin");
    }

    return null;
  }

  const visibleMenuSections = menuSections.filter((section) => (canAdmin ? true : user.role === "cashier" && (section.id === "valves" || section.id === "history")));
  const activeMenuSectionConfig = visibleMenuSections.find((section) => section.id === activeMenuSection);

  return (
    <section className="grid min-w-0 gap-3">
      {schoolSaveStatus && (
        <p className={`rounded border p-3 text-sm font-semibold ${schoolSaveStatus === "success" ? "border-mint/30 bg-mint/10 text-mint" : "border-red-200 bg-red-50 text-red-700"}`}>
          {schoolSaveMessage}
        </p>
      )}
      {visibleMenuSections.map((section) => {
        const Icon = section.icon;
        const active = activeMenuSection === section.id;
        return (
          <button
            key={section.id}
            onClick={() => setActiveMenuSection(section.id)}
            className={`min-w-0 rounded border p-4 text-left shadow-sm transition ${
              active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-mint"
            }`}
            type="button"
          >
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="break-words font-bold text-ink">{section.title}</h2>
                <p className="mt-1 break-words text-sm text-slate-500">{section.description}</p>
              </div>
            </div>
          </button>
        );
      })}
      {activeMenuSection && activeMenuSectionConfig && (
        <AdminDrawer title={activeMenuSectionConfig.title} onClose={() => setActiveMenuSection(null)} closeLabel={`Fermer ${activeMenuSectionConfig.title}`}>
          {renderMenuSectionForm(activeMenuSection)}
        </AdminDrawer>
      )}
      {parentDeleteOpen && (
        <AdminDrawer title="Supprimer un parent" onClose={closeParentDeleteDrawer} closeLabel="Annuler la suppression du parent">
          <div className="grid min-w-0 gap-4">
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              Cette action supprime le compte parent et détache ses élèves sans supprimer les élèves ni leurs données scolaires.
            </p>
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
              Parent à supprimer
              <select
                value={parentDeleteId}
                onChange={(event) => {
                  setParentDeleteId(event.target.value);
                  setParentDeleteConfirmation("");
                  setParentDeleteError("");
                }}
                className="input"
              >
                <option value="">Sélectionner un parent</option>
                {yearData.parents
                  .filter((parent) => parent.schoolId === school.id)
                  .map((parent) => (
                    <option key={parent.id} value={parent.id}>
                      {parent.fullName} - {parent.phone || parent.email}
                    </option>
                  ))}
              </select>
            </label>
            {parentDeleteTarget && (
              <div className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
                <div>
                  <p className="font-bold text-ink">{parentDeleteTarget.fullName}</p>
                  <p className="break-words text-slate-500">{parentDeleteTarget.phone || "Téléphone non renseigné"} | {parentDeleteTarget.email || "Email non renseigné"}</p>
                  <p className="break-words text-slate-500">Compte utilisateur : {parentDeleteTarget.userId || "Non renseigné"}</p>
                </div>
                <div className="rounded bg-slate-50 p-3">
                  <p className="font-semibold text-slate-700">{parentDeleteChildren.length} enfant(s) lié(s)</p>
                  <p className="mt-1 break-words text-slate-500">
                    {parentDeleteChildren.length
                      ? parentDeleteChildren.map((student) => `${student.nom} ${student.prenom} (${formatStudentClassName(student)})`).join(", ")
                      : "Aucun enfant lié dans cette année scolaire."}
                  </p>
                </div>
              </div>
            )}
            <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
              Confirmation obligatoire
              <input
                value={parentDeleteConfirmation}
                onChange={(event) => {
                  setParentDeleteConfirmation(event.target.value);
                  setParentDeleteError("");
                }}
                className="input"
                placeholder="SUPPRIMER LE PARENT"
              />
            </label>
            {parentDeleteError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{parentDeleteError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={closeParentDeleteDrawer} type="button" className="secondary-button justify-center" disabled={parentDeleteSaving}>
                Annuler
              </button>
              <button
                onClick={confirmDeleteParent}
                type="button"
                disabled={!parentDeleteTarget || parentDeleteConfirmation !== "SUPPRIMER LE PARENT" || parentDeleteSaving}
                className="inline-flex items-center justify-center gap-2 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> {parentDeleteSaving ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </AdminDrawer>
      )}
      <div className="mt-2 border-t border-slate-200 pt-4">
        <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </div>
    </section>
  );
}
