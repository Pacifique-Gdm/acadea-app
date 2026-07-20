import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowUpDown, BookOpen, Building2, CheckCircle2, Filter, GraduationCap, LayoutDashboard, LogOut, Menu as MenuIcon, Plus, Search, ShieldCheck, Upload, UsersRound, X } from "lucide-react";
import { BillingControlsDrawer } from "../../components/platform/BillingControlsDrawer";
import { AuditTimeline, BiometricTerminalStatusBadge, InfoRow, MiniStat, PlatformCard, SchoolLogo, SchoolSaasCard, StatusBadge } from "../../components/platform";
import { AdminDrawer, Field, FormPanel, ImageUploadField, PasswordField } from "../../components/ui";
import type { UseBillingControlsResult } from "../../hooks/useBillingControls";
import { savePlatformSettings } from "../../services/firestoreData";
import { loadSuperAdminSchoolData } from "../../services/superAdminData";
import type { SuperAdminGlobalCounts } from "../../services/superAdminData";
import { manageSchool, provisionSchoolAdmin, provisionSchoolUser } from "../../services/provisioning";
import { isSessionAuditAction } from "../../utils/audit";
import { educationLevelsForSchoolLevel, schoolLevelFromConfig } from "../../utils/schoolConfig";
import type { SchoolLevelChoice } from "../../utils/schoolConfig";
import { formatStudentClassName } from "../../utils/studentClasses";
import { isArchivedStudent } from "../../utils/studentUtils";
import type { AppData, AppUser, AuditLog, BiometricTerminal, BiometricTerminalStatus, School, SchoolClass } from "../../types";
import { CLASSES } from "../../types";

export function PlatformModule({
  user,
  data,
  updateData,
  platformCounts,
  platformLogoUrl,
  onPlatformLogoSaved,
  showInstallButton,
  onInstallPwa,
  onLogout,
  billingControls,
  uid,
  schoolEducationLevelChoices,
  schoolLevelChoices,
  defaultSchoolOptions,
  getPlatformSchoolStats,
  applyPlatformLogoAssets,
  EnvironmentBanner,
  InstallPwaNavButton,
  showStagingBanner,
  roleLabels,
  schoolTabLabel,
}: {
  user: AppUser;
  data: AppData;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  platformCounts: SuperAdminGlobalCounts | null;
  platformLogoUrl: string;
  onPlatformLogoSaved: (logoUrl: string) => void;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onLogout: () => void;
  billingControls: UseBillingControlsResult;
  uid: (prefix: string) => string;
  schoolEducationLevelChoices: string[];
  schoolLevelChoices: SchoolLevelChoice[];
  defaultSchoolOptions: string[];
  getPlatformSchoolStats: (schoolId: string, data: AppData) => { students: number; parents: number; admins: number; users: number };
  applyPlatformLogoAssets: () => Promise<void>;
  EnvironmentBanner: () => ReactNode;
  InstallPwaNavButton: ({ onInstall }: { onInstall: () => void }) => ReactNode;
  showStagingBanner: boolean;
  roleLabels: Record<AppUser["role"], string>;
  schoolTabLabel: (tab: "overview" | "info" | "admins" | "history") => string;
}) {
  type PlatformView = "dashboard" | "students" | "menu";
  type SchoolDetailTab = "overview" | "info" | "admins" | "history";
  type SchoolSort = "az" | "recent" | "users";
  const removedSchoolOptions = new Set<string>();
  const isAllowedSchoolOption = (option: string) => !removedSchoolOptions.has(option.trim());
  const schoolOptionChoices = defaultSchoolOptions.filter(isAllowedSchoolOption);

  const [schoolName, setSchoolName] = useState("");
  const [mainAdminName, setMainAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [schoolSections, setSchoolSections] = useState<string[]>(["Primaire"]);
  const [selectedSchoolOptions, setSelectedSchoolOptions] = useState<string[]>([]);
  const [customSchoolOption, setCustomSchoolOption] = useState("");
  const [platformView, setPlatformView] = useState<PlatformView>("dashboard");
  const [selectedSchoolId, setSelectedSchoolId] = useState(data.schools[0]?.id ?? "");
  const [schoolDrawerId, setSchoolDrawerId] = useState("");
  const [detailTab, setDetailTab] = useState<SchoolDetailTab>("overview");
  const [platformMenuDrawer, setPlatformMenuDrawer] = useState<"create-school" | "logo" | "billing-controls" | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | School["status"]>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | NonNullable<School["schoolType"]>>("all");
  const [sortBy, setSortBy] = useState<SchoolSort>("az");
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [adminName, setAdminName] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [modalAdminEmail, setModalAdminEmail] = useState("");
  const [modalAdminPassword, setModalAdminPassword] = useState("");
  const [modalAdminPasswordConfirm, setModalAdminPasswordConfirm] = useState("");
  const [showModalPassword, setShowModalPassword] = useState(false);
  const [provisioningError, setProvisioningError] = useState("");
  const [provisioningLoading, setProvisioningLoading] = useState(false);
  const [schoolActionError, setSchoolActionError] = useState("");
  const [schoolActionSuccess, setSchoolActionSuccess] = useState("");
  const [schoolDeleteTarget, setSchoolDeleteTarget] = useState<School | null>(null);
  const [schoolDeleteConfirmation, setSchoolDeleteConfirmation] = useState("");
  const [schoolDeleteLoading, setSchoolDeleteLoading] = useState(false);
  const [schoolLevelChangeTarget, setSchoolLevelChangeTarget] = useState<{ school: School; level: SchoolLevelChoice } | null>(null);
  const [schoolLevelConfirmation, setSchoolLevelConfirmation] = useState("");
  const [biometricSchoolId, setBiometricSchoolId] = useState("");
  const [terminalFormOpen, setTerminalFormOpen] = useState(false);
  const [editingTerminalId, setEditingTerminalId] = useState("");
  const [terminalForm, setTerminalForm] = useState({ name: "", brand: "", model: "", serialNumber: "", deviceId: "", location: "", notes: "" });
  const [terminalError, setTerminalError] = useState("");
  const [terminalMessage, setTerminalMessage] = useState("");
  const [platformLogoDraft, setPlatformLogoDraft] = useState(platformLogoUrl);
  const [platformLogoMessage, setPlatformLogoMessage] = useState("");
  const [schoolDetailLoading, setSchoolDetailLoading] = useState(false);
  const [schoolDetailError, setSchoolDetailError] = useState("");
  const schoolDetailRequestRef = useRef(0);

  const visibleSchools = data.schools.filter((school) => String(school.status) !== "deleted");
  const totalStudents = platformCounts?.students ?? data.students.length;
  const totalParents = platformCounts?.parents ?? data.parents.length;
  const totalAdmins = platformCounts?.admins ?? data.users.filter((item) => item.role === "school_admin").length;
  const activeSchools = visibleSchools.filter((school) => school.status === "active").length;
  const suspendedSchools = visibleSchools.filter((school) => school.status === "suspended").length;
  const schoolStatusChart = [
    { label: "Actives", value: activeSchools, className: "bg-mint", textClassName: "text-mint" },
    { label: "Suspendues", value: suspendedSchools, className: "bg-red-600", textClassName: "text-red-600" },
    { label: "En attente", value: visibleSchools.filter((school) => String(school.status) === "pending").length, className: "bg-amber-500", textClassName: "text-amber-700" },
    { label: "Désactivées", value: visibleSchools.filter((school) => String(school.status) === "inactive").length, className: "bg-slate-500", textClassName: "text-slate-600" },
  ];
  const maxStatusCount = Math.max(1, ...schoolStatusChart.map((item) => item.value));
  const hasSecondarySection = schoolSections.includes("Secondaire");
  const hasCustomSchoolOption = selectedSchoolOptions.includes("Autre");
  const visibleSchoolOptionChoices = Array.from(new Set([...schoolOptionChoices, ...selectedSchoolOptions.filter((option) => option !== "Autre" && isAllowedSchoolOption(option))]));
  const selectedSchool = visibleSchools.find((school) => school.id === selectedSchoolId) ?? visibleSchools[0];
  const drawerSchool = visibleSchools.find((school) => school.id === schoolDrawerId);
  const biometricSchool = visibleSchools.find((school) => school.id === biometricSchoolId);
  const biometricSchoolTerminals = biometricSchool ? data.biometricTerminals.filter((terminal) => terminal.schoolId === biometricSchool.id).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")) : [];
  const drawerSchoolOptions = (drawerSchool?.schoolOptions ?? []).filter(isAllowedSchoolOption);
  const drawerStats = drawerSchool ? getPlatformSchoolStats(drawerSchool.id, data) : { students: 0, parents: 0, admins: 0, users: 0 };
  const drawerAdmins = drawerSchool ? data.users.filter((item) => item.role === "school_admin" && item.schoolId === drawerSchool.id) : [];
  const drawerMainAdmin = drawerSchool ? drawerAdmins.find((admin) => admin.id === drawerSchool.mainAdminId) ?? drawerAdmins[0] : undefined;
  const drawerLogs = drawerSchool
    ? data.auditLogs.filter((log) => log.schoolId === drawerSchool.id && !isSessionAuditAction(log.action)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const drawerClassEnrollment = useMemo(() => {
    if (!drawerSchool) return [];
    const counts = new Map<string, { label: string; className: SchoolClass; count: number }>();
    data.students
      .filter((student) => student.schoolId === drawerSchool.id)
      .filter((student) => (drawerSchool.activeSchoolYearId ? student.schoolYearId === drawerSchool.activeSchoolYearId : true))
      .filter((student) => !isArchivedStudent(student))
      .forEach((student) => {
        const label = formatStudentClassName(student);
        const key = `${student.className}::${student.option ?? ""}`;
        const current = counts.get(key);
        counts.set(key, {
          label,
          className: student.className,
          count: (current?.count ?? 0) + 1,
        });
      });
    return Array.from(counts.values()).sort((first, second) => {
      const firstClassIndex = CLASSES.indexOf(first.className);
      const secondClassIndex = CLASSES.indexOf(second.className);
      if (firstClassIndex !== secondClassIndex) return firstClassIndex - secondClassIndex;
      return first.label.localeCompare(second.label, "fr");
    });
  }, [data.students, drawerSchool]);
  const maxDrawerClassEnrollment = Math.max(1, ...drawerClassEnrollment.map((item) => item.count));
  const adminFormValid =
    adminName.trim().length >= 2 &&
    modalAdminEmail.includes("@") &&
    (editingAdminId || modalAdminPassword.length >= 6) &&
    (editingAdminId || modalAdminPassword === modalAdminPasswordConfirm);
  const filteredSchools = visibleSchools
    .filter((school) => school.name.toLowerCase().includes(search.toLowerCase()) || (school.acronym ?? "").toLowerCase().includes(search.toLowerCase()))
    .filter((school) => (statusFilter === "all" ? true : school.status === statusFilter))
    .filter((school) => (typeFilter === "all" ? true : school.schoolType === typeFilter))
    .sort((a, b) => {
      if (sortBy === "recent") return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      if (sortBy === "users") return getPlatformSchoolStats(b.id, data).users - getPlatformSchoolStats(a.id, data).users;
      return a.name.localeCompare(b.name);
    });

  function writeAudit(schoolId: string | undefined, action: string): AuditLog {
    return {
      id: uid("audit"),
      schoolId,
      actorId: user.id,
      actorName: user.name,
      action,
      createdAt: new Date().toISOString(),
    };
  }

  async function createSchool() {
    if (provisioningLoading) return;
    if (!schoolName || !mainAdminName || !adminEmail || !adminPassword || schoolSections.length === 0) return;
    const trimmedCustomSchoolOption = customSchoolOption.trim();
    if (hasSecondarySection && hasCustomSchoolOption && !trimmedCustomSchoolOption) {
      setProvisioningError("Veuillez préciser la nouvelle option scolaire.");
      return;
    }
    if (hasSecondarySection && hasCustomSchoolOption && !isAllowedSchoolOption(trimmedCustomSchoolOption)) {
      setProvisioningError("Cette option scolaire n'est plus disponible.");
      return;
    }
    const nextSchoolOptions = hasSecondarySection
      ? [
          ...selectedSchoolOptions.filter((option) => option !== "Autre" && isAllowedSchoolOption(option)),
          ...(hasCustomSchoolOption ? [trimmedCustomSchoolOption] : []),
        ]
      : [];

    setProvisioningError("");
    setProvisioningLoading(true);
    try {
      const provisioned = await provisionSchoolAdmin({
        schoolName: schoolName.trim(),
        adminName: mainAdminName.trim(),
        adminEmail: adminEmail.trim(),
        adminPassword,
        educationLevels: schoolSections,
        schoolType: schoolSections.length === 1 ? (schoolSections[0] as School["schoolType"]) : "Mixte",
        schoolOptions: nextSchoolOptions,
      });

      updateData(
        {
          schools: [...data.schools, provisioned.school],
          schoolYears: [...data.schoolYears, provisioned.schoolYear],
          users: [...data.users, provisioned.adminUser],
          auditLogs: [provisioned.auditLog, ...data.auditLogs],
        },
        { persist: false },
      );
      setSchoolName("");
      setMainAdminName("");
      setAdminEmail("");
      setAdminPassword("");
      setSchoolSections(["Primaire"]);
      setSelectedSchoolOptions([]);
      setCustomSchoolOption("");
      setSelectedSchoolId(provisioned.school.id);
      setPlatformView("students");
      setDetailTab("overview");
      setPlatformMenuDrawer(null);
    } catch (error) {
      setProvisioningError(error instanceof Error ? error.message : "Provisionnement impossible.");
    } finally {
      setProvisioningLoading(false);
    }
  }

  async function updateSchool(schoolId: string, next: Partial<School>) {
    updateData({
      schools: data.schools.map((school) => (school.id === schoolId ? { ...school, ...next } : school)),
      auditLogs: [writeAudit(schoolId, "Mise à jour des informations école"), ...data.auditLogs],
    });
  }

  async function updateSchoolLevel(school: School, level: SchoolLevelChoice) {
    await updateSchool(school.id, {
      schoolType: level,
      educationLevels: educationLevelsForSchoolLevel(level),
    });
  }

  function openSchoolLevelChangeDialog(school: School, level: SchoolLevelChoice) {
    if (schoolLevelFromConfig(school) === level) return;
    setSchoolLevelChangeTarget({ school, level });
    setSchoolLevelConfirmation("");
  }

  function closeSchoolLevelChangeDialog() {
    setSchoolLevelChangeTarget(null);
    setSchoolLevelConfirmation("");
  }

  async function confirmSchoolLevelChange() {
    if (!schoolLevelChangeTarget || schoolLevelConfirmation !== "CHANGER LE NIVEAU DE L'ECOLE") return;
    await updateSchoolLevel(schoolLevelChangeTarget.school, schoolLevelChangeTarget.level);
    closeSchoolLevelChangeDialog();
  }

  function toggleSchoolSection(section: string) {
    setSchoolSections((current) => {
      if (current.includes(section)) {
        if (section === "Secondaire") {
          setSelectedSchoolOptions([]);
          setCustomSchoolOption("");
          setProvisioningError("");
        }
        return current.filter((item) => item !== section);
      }
      return [...current, section];
    });
  }

  function toggleSchoolOption(option: string) {
    setSelectedSchoolOptions((current) => {
      if (current.includes(option)) {
        if (option === "Autre") {
          setCustomSchoolOption("");
          setProvisioningError("");
        }
        return current.filter((item) => item !== option);
      }
      return [...current, option];
    });
  }

  function addCustomSchoolOption() {
    const option = customSchoolOption.trim();
    if (!option) {
      setProvisioningError("Veuillez préciser la nouvelle option scolaire.");
      return;
    }
    setSelectedSchoolOptions((current) => Array.from(new Set([...current.filter((item) => item !== "Autre"), option])));
    setCustomSchoolOption("");
    setProvisioningError("");
  }

  async function changeSchoolStatus(school: School) {
    const action = school.status === "active" ? "suspend" : "reactivate";
    const label = action === "suspend" ? "suspendre" : "reactiver";
    if (!confirm(`Confirmer: ${label} ${school.name} ?`)) return;

    setSchoolActionError("");
    setSchoolActionSuccess("");
    try {
      const payload = await manageSchool({ action, schoolId: school.id });
      if (!payload.school) throw new Error("Reponse ecole incomplete.");
      updateData(
        {
          schools: data.schools.map((item) => (item.id === school.id ? (payload.school as School) : item)),
          auditLogs: [writeAudit(school.id, `${action === "suspend" ? "Suspension" : "Reactivation"} de l'ecole ${school.name}`), ...data.auditLogs],
        },
        { persist: false },
      );
    } catch (error) {
      setSchoolActionError(error instanceof Error ? error.message : "Changement de statut impossible.");
    }
  }

  async function editSchool(school: School) {
    const name = window.prompt("Nom de l'ecole", school.name);
    if (name === null) return;
    const address = window.prompt("Adresse", school.address ?? "");
    if (address === null) return;
    const phone = window.prompt("Telephone", school.phone ?? "");
    if (phone === null) return;
    const email = window.prompt("Email", school.email ?? "");
    if (email === null) return;
    await updateSchool(school.id, {
      name: name.trim(),
      address: address.trim(),
      phone: phone.trim(),
      email: email.trim(),
    });
  }

  function resetTerminalForm() {
    setTerminalForm({ name: "", brand: "", model: "", serialNumber: "", deviceId: "", location: "", notes: "" });
    setEditingTerminalId("");
    setTerminalFormOpen(false);
    setTerminalError("");
  }

  function openBiometricDrawer(school: School) {
    setBiometricSchoolId(school.id);
    setTerminalMessage("");
    resetTerminalForm();
  }

  function closeBiometricDrawer() {
    setBiometricSchoolId("");
    setTerminalMessage("");
    resetTerminalForm();
  }

  function openCreateTerminalForm() {
    setEditingTerminalId("");
    setTerminalForm({ name: "", brand: "", model: "", serialNumber: "", deviceId: "", location: "", notes: "" });
    setTerminalError("");
    setTerminalMessage("");
    setTerminalFormOpen(true);
  }

  function openEditTerminalForm(terminal: BiometricTerminal) {
    setEditingTerminalId(terminal.id);
    setTerminalForm({
      name: terminal.name,
      brand: terminal.brand,
      model: terminal.model,
      serialNumber: terminal.serialNumber,
      deviceId: terminal.deviceId ?? "",
      location: terminal.location,
      notes: terminal.notes ?? "",
    });
    setTerminalError("");
    setTerminalMessage("");
    setTerminalFormOpen(true);
  }

  function saveTerminal() {
    if (!biometricSchool) return;
    const now = new Date().toISOString();
    const serialNumber = terminalForm.serialNumber.trim();
    const requiredFields = [terminalForm.name, terminalForm.brand, terminalForm.model, serialNumber, terminalForm.location];
    if (requiredFields.some((value) => !value.trim())) {
      setTerminalError("Veuillez renseigner le nom, la marque, le modèle, le numéro de série et l'emplacement.");
      return;
    }
    const normalizedSerial = serialNumber.toLowerCase();
    const duplicate = data.biometricTerminals.find(
      (terminal) => terminal.id !== editingTerminalId && terminal.serialNumber.trim().toLowerCase() === normalizedSerial,
    );
    if (duplicate) {
      setTerminalError("Ce numéro de série est déjà associé à une école.");
      return;
    }

    const existing = editingTerminalId ? data.biometricTerminals.find((terminal) => terminal.id === editingTerminalId && terminal.schoolId === biometricSchool.id) : undefined;
    const terminalId = existing?.terminalId ?? uid("terminal");
    const nextTerminal: BiometricTerminal = {
      id: existing?.id ?? terminalId,
      terminalId,
      schoolId: biometricSchool.id,
      name: terminalForm.name.trim(),
      brand: terminalForm.brand.trim(),
      model: terminalForm.model.trim(),
      serialNumber,
      location: terminalForm.location.trim(),
      status: existing?.status ?? "unconfigured",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      createdBy: existing?.createdBy ?? user.id,
      updatedBy: user.id,
    };
    const deviceId = terminalForm.deviceId.trim();
    const notes = terminalForm.notes.trim();
    if (deviceId) nextTerminal.deviceId = deviceId;
    if (notes) nextTerminal.notes = notes;
    if (existing?.lastSyncAt) nextTerminal.lastSyncAt = existing.lastSyncAt;
    if (existing?.replacedByTerminalId) nextTerminal.replacedByTerminalId = existing.replacedByTerminalId;
    updateData({
      biometricTerminals: [nextTerminal, ...data.biometricTerminals.filter((terminal) => terminal.id !== nextTerminal.id)],
      auditLogs: [writeAudit(biometricSchool.id, `${existing ? "Modification" : "Ajout"} terminal biométrique ${nextTerminal.serialNumber}`), ...data.auditLogs],
    });
    setTerminalMessage(existing ? "Terminal biométrique mis à jour." : "Terminal biométrique ajouté.");
    resetTerminalForm();
  }

  function setTerminalStatus(terminal: BiometricTerminal, status: BiometricTerminalStatus) {
    const nextTerminal = {
      ...terminal,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    };
    updateData({
      biometricTerminals: [nextTerminal, ...data.biometricTerminals.filter((item) => item.id !== terminal.id)],
      auditLogs: [writeAudit(terminal.schoolId, `Statut terminal biométrique ${terminal.serialNumber}: ${status}`), ...data.auditLogs],
    });
    setTerminalMessage(status === "disabled" ? "Terminal désactivé." : "Terminal mis à jour.");
  }

  function replaceTerminal(terminal: BiometricTerminal) {
    setTerminalStatus(terminal, "disabled");
    setEditingTerminalId("");
    setTerminalForm({
      name: `${terminal.name} - remplacement`,
      brand: terminal.brand,
      model: terminal.model,
      serialNumber: "",
      deviceId: "",
      location: terminal.location,
      notes: `Remplace le terminal ${terminal.serialNumber}`,
    });
    setTerminalError("");
    setTerminalFormOpen(true);
  }

  function testTerminalConnection() {
    setTerminalMessage("Le test de connexion sera disponible lorsque l'intégration technique du terminal sera activée.");
  }

  function openDeleteSchoolDialog(school: School) {
    setSchoolActionError("");
    setSchoolActionSuccess("");
    setSchoolDeleteTarget(school);
    setSchoolDeleteConfirmation("");
  }

  function closeDeleteSchoolDialog() {
    if (schoolDeleteLoading) return;
    setSchoolDeleteTarget(null);
    setSchoolDeleteConfirmation("");
  }

  async function deleteSchool() {
    if (!schoolDeleteTarget || schoolDeleteLoading) return;
    const school = schoolDeleteTarget;
    const normalizedConfirmation = schoolDeleteConfirmation.trim();
    if (normalizedConfirmation !== "SUPPRIMER ECOLE") {
      setSchoolActionSuccess("");
      setSchoolActionError("Confirmation de suppression invalide. Tapez exactement SUPPRIMER ECOLE.");
      return;
    }

    setSchoolActionError("");
    setSchoolActionSuccess("");
    setSchoolDeleteLoading(true);
    try {
      const payload = await manageSchool({ action: "delete", schoolId: school.id, confirmation: normalizedConfirmation });
      if (payload.schoolId !== school.id) {
        throw new Error("Reponse de suppression ecole incoherente.");
      }
      const remainingSchools = data.schools.filter((item) => item.id !== school.id && String(item.status) !== "deleted");
      updateData(
        {
          schools: remainingSchools,
          schoolYears: data.schoolYears.filter((item) => item.schoolId !== school.id),
          users: data.users.filter((item) => item.schoolId !== school.id),
          students: data.students.filter((item) => item.schoolId !== school.id),
          parents: data.parents.filter((item) => item.schoolId !== school.id),
          feeTypes: data.feeTypes.filter((item) => item.schoolId !== school.id),
          payments: data.payments.filter((item) => item.schoolId !== school.id),
          expenses: data.expenses.filter((item) => item.schoolId !== school.id),
          messages: data.messages.filter((item) => item.schoolId !== school.id),
          notifications: data.notifications.filter((item) => item.schoolId !== school.id),
          auditLogs: data.auditLogs.filter((item) => item.schoolId !== school.id),
          biometricTerminals: data.biometricTerminals.filter((item) => item.schoolId !== school.id),
          disciplineSanctions: data.disciplineSanctions.filter((item) => item.schoolId !== school.id),
        },
        { persist: false },
      );
      setSelectedSchoolId(remainingSchools[0]?.id ?? "");
      setPlatformView("students");
      setSchoolDrawerId("");
      setSchoolDeleteTarget(null);
      setSchoolDeleteConfirmation("");
      setSchoolActionSuccess(`Ecole ${school.name} supprimee avec succes.`);
    } catch (error) {
      setSchoolActionError(error instanceof Error ? error.message : "Suppression ecole impossible.");
    } finally {
      setSchoolDeleteLoading(false);
    }
  }

  useEffect(() => {
    setPlatformLogoDraft(platformLogoUrl);
  }, [platformLogoUrl]);

  async function savePlatformLogo() {
    try {
      const saved = await savePlatformSettings({
        loginLogoUrl: platformLogoDraft,
        updatedAt: new Date().toISOString(),
      });
      if (!saved) throw new Error("Enregistrement Firestore indisponible.");
      onPlatformLogoSaved(platformLogoDraft);
      void applyPlatformLogoAssets();
      setPlatformLogoMessage(platformLogoDraft ? "Logo de l'application enregistré avec succès." : "Logo de l'application supprimé.");
    } catch (error) {
      setPlatformLogoMessage(error instanceof Error ? error.message : "Enregistrement du logo impossible.");
    }
  }

  function openCreateAdminModal() {
    setEditingAdminId(null);
    setAdminName("");
    setAdminPhone("");
    setModalAdminEmail("");
    setModalAdminPassword("");
    setModalAdminPasswordConfirm("");
    setShowModalPassword(false);
    setAdminModalOpen(true);
  }

  function openEditAdminModal(admin: AppUser) {
    setEditingAdminId(admin.id);
    setAdminName(admin.name);
    setAdminPhone(admin.phone ?? "");
    setModalAdminEmail(admin.email);
    setModalAdminPassword("");
    setModalAdminPasswordConfirm("");
    setShowModalPassword(false);
    setAdminModalOpen(true);
  }

  async function saveAdmin() {
    if (!selectedSchool || !adminFormValid) return;

    if (editingAdminId) {
      updateData({
        users: data.users.map((item) =>
          item.id === editingAdminId ? { ...item, name: adminName, phone: adminPhone, email: modalAdminEmail } : item,
        ),
        auditLogs: [writeAudit(selectedSchool.id, `Modification de l'administrateur ${adminName}`), ...data.auditLogs],
      });
    } else {
      const adminUser = await provisionSchoolUser({
        role: "school_admin",
        schoolId: selectedSchool.id,
        schoolYearId: selectedSchool.activeSchoolYearId,
        name: adminName,
        email: modalAdminEmail,
        password: modalAdminPassword,
        phone: adminPhone,
      });
      updateData({
        users: [...data.users, adminUser],
        auditLogs: [writeAudit(selectedSchool.id, `Ajout de l'administrateur ${adminName}`), ...data.auditLogs],
      });
    }

    setAdminModalOpen(false);
  }

  function toggleAdminStatus(admin: AppUser) {
    const nextStatus = admin.status === "inactive" ? "active" : "inactive";
    const label = nextStatus === "inactive" ? "désactiver" : "réactiver";
    if (!confirm(`Confirmer: ${label} ${admin.name} ?`)) return;

    updateData({
      users: data.users.map((item) => (item.id === admin.id ? { ...item, status: nextStatus } : item)),
      auditLogs: [writeAudit(admin.schoolId, `${nextStatus === "inactive" ? "Désactivation" : "Réactivation"} de l'administrateur ${admin.name}`), ...data.auditLogs],
    });
  }

  function selectSchool(schoolId: string, tab: SchoolDetailTab = "overview") {
    setSelectedSchoolId(schoolId);
    setDetailTab(tab);
    setPlatformView("students");
  }

  function openSchoolDrawer(schoolId: string) {
    const requestId = schoolDetailRequestRef.current + 1;
    schoolDetailRequestRef.current = requestId;
    selectSchool(schoolId);
    setSchoolDrawerId(schoolId);
    setSchoolDetailError("");
    setSchoolDetailLoading(true);
    loadSuperAdminSchoolData(schoolId)
      .then((schoolData) => {
        if (schoolDetailRequestRef.current !== requestId) return;
        updateData(
          {
            users: [...data.users.filter((item) => item.role === "super_admin" || !item.schoolId), ...schoolData.admins],
            students: schoolData.students,
            parents: schoolData.parents,
            feeTypes: schoolData.feeTypes,
            payments: schoolData.payments,
            expenses: schoolData.expenses,
            messages: schoolData.messages,
            notifications: schoolData.notifications,
            auditLogs: schoolData.auditLogs,
            valves: schoolData.valves,
            biometricTerminals: [...data.biometricTerminals.filter((terminal) => terminal.schoolId !== schoolId), ...schoolData.biometricTerminals],
            disciplineSanctions: [],
          },
          { persist: false },
        );
      })
      .catch((error) => {
        if (schoolDetailRequestRef.current !== requestId) return;
        console.warn("Chargement des données de l'école indisponible.", error);
        setSchoolDetailError("Impossible de charger les données de cette école. Veuillez réessayer.");
      })
      .finally(() => {
        if (schoolDetailRequestRef.current === requestId) {
          setSchoolDetailLoading(false);
        }
      });
  }

  function closeSchoolDrawer() {
    schoolDetailRequestRef.current += 1;
    setSchoolDrawerId("");
    setBiometricSchoolId("");
    setSchoolDetailLoading(false);
    setSchoolDetailError("");
    resetTerminalForm();
    updateData(
      {
        users: data.users.filter((item) => item.role === "super_admin" || !item.schoolId),
        students: [],
        parents: [],
        feeTypes: [],
        payments: [],
        expenses: [],
        messages: [],
        notifications: [],
        auditLogs: [],
        valves: [],
        disciplineSanctions: [],
      },
      { persist: false },
    );
  }

  const platformTabs = [
    { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { id: "students" as const, label: "Écoles", icon: Building2 },
    { id: "menu" as const, label: "Menu", icon: MenuIcon },
  ];

  function renderPlatformLogoForm() {
    return (
      <>
        <ImageUploadField
          label="Logo affiché sur l'écran de connexion"
          value={platformLogoDraft}
          onChange={(value) => {
            setPlatformLogoDraft(value);
            setPlatformLogoMessage("");
          }}
          maxWidth={700}
          maxBytes={250 * 1024}
          acceptSvg
          previewFit="contain"
        />
        {platformLogoMessage && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{platformLogoMessage}</p>}
        <button onClick={savePlatformLogo} className="primary-button justify-center" type="button">
          <CheckCircle2 className="h-4 w-4" /> Enregistrer le logo
        </button>
      </>
    );
  }

  function renderCreateSchoolForm() {
    return (
      <>
        <Field label="Nom de l'école" value={schoolName} onChange={setSchoolName} />
        <Field label="Nom de l'Administrateur" value={mainAdminName} onChange={setMainAdminName} />
        <Field label="Email admin école" value={adminEmail} onChange={setAdminEmail} type="email" />
        <PasswordField label="Mot de passe admin" value={adminPassword} onChange={setAdminPassword} />
        <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-700">Sections disponibles</legend>
          <div className="flex flex-wrap gap-2">
            {schoolEducationLevelChoices.map((section) => (
              <label key={section} className="inline-flex items-center gap-2 rounded bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={schoolSections.includes(section)} onChange={() => toggleSchoolSection(section)} className="h-4 w-4 accent-ink" />
                {section}
              </label>
            ))}
          </div>
        </fieldset>
        {hasSecondarySection && (
          <fieldset className="grid gap-2 rounded border border-slate-200 p-3">
            <legend className="px-1 text-sm font-semibold text-slate-700">Options scolaires</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visibleSchoolOptionChoices.map((option) => (
                <label key={option} className="flex min-w-0 items-center gap-2 rounded bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={selectedSchoolOptions.includes(option)} onChange={() => toggleSchoolOption(option)} className="h-4 w-4 shrink-0 accent-ink" />
                  <span className="min-w-0 break-words">{option}</span>
                </label>
              ))}
            </div>
            {hasCustomSchoolOption && (
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                Nouvelle option scolaire
                <span className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    value={customSchoolOption}
                    onChange={(event) => {
                      setCustomSchoolOption(event.target.value);
                      setProvisioningError("");
                    }}
                    className="input"
                    placeholder="Ex. Informatique"
                  />
                  <button type="button" onClick={addCustomSchoolOption} className="secondary-button justify-center">
                    <Plus className="h-4 w-4" /> Ajouter
                  </button>
                </span>
              </label>
            )}
          </fieldset>
        )}
        {provisioningError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{provisioningError}</p>}
        <button
          onClick={createSchool}
          disabled={provisioningLoading || !mainAdminName.trim() || schoolSections.length === 0 || (hasSecondarySection && hasCustomSchoolOption && !customSchoolOption.trim())}
          className="primary-button disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
        >
          <Plus className="h-4 w-4" /> {provisioningLoading ? "Création..." : "Créer"}
        </button>
      </>
    );
  }

  return (
    <div className="min-h-screen max-w-full overflow-x-hidden bg-[#f6f8fb] pb-24 text-ink">
      <EnvironmentBanner />
      <div className="min-w-0 pt-[68px]">
        <header className={`fixed inset-x-0 ${showStagingBanner ? "top-9 sm:top-10" : "top-0"} z-20 max-w-full border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur`}>
          <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-3 px-3 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white font-bold text-ink">
              {platformLogoUrl ? <img src={platformLogoUrl} alt="" className="h-full w-full object-contain p-1" /> : "A"}
            </div>
            <div className="min-w-0">
              <p className="break-words text-lg font-bold text-ink">Plateforme Acadéa</p>
              <p className="break-words text-xs text-slate-500">{roleLabels[user.role]} | dashboard SaaS anonymisé</p>
            </div>
          </div>
          </div>
        </header>

        <main className="mx-auto grid w-full max-w-7xl min-w-0 gap-5 overflow-x-hidden px-3 py-5 sm:px-6 lg:px-8">
          {schoolActionError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{schoolActionError}</p>}
          {schoolActionSuccess && <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{schoolActionSuccess}</p>}

          {platformView === "dashboard" && (
            <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PlatformCard label="Écoles" value={data.schools.length} icon={BookOpen} description={`${activeSchools} actives, ${suspendedSchools} suspendues`} tone="mint" />
              <PlatformCard label="Élèves totalisés" value={totalStudents} icon={GraduationCap} description="Chiffre agrégé, sans détail individuel" tone="sky" />
              <PlatformCard label="Parents" value={totalParents} icon={UsersRound} description="Comptes rattachés aux écoles" tone="violet" />
              <PlatformCard label="Administrateurs" value={totalAdmins} icon={ShieldCheck} description="Comptes administrateurs école" tone="amber" />
            </section>
          )}

          {platformView === "dashboard" && (
            <section className="grid min-w-0 gap-4">
              <div className="grid min-w-0 gap-4">
                <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="font-bold text-ink">Répartition des écoles par statut</h2>
                      <p className="text-sm text-slate-500">État global des établissements de la plateforme.</p>
                    </div>
                    <span className="w-fit rounded bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">{visibleSchools.length} école(s)</span>
                  </div>
                  <div className="mt-5 grid gap-3">
                    {schoolStatusChart.map((item) => (
                      <div key={item.label} className="grid gap-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-semibold text-slate-700">{item.label}</span>
                          <span className={`font-bold ${item.textClassName}`}>{item.value}</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${item.className}`} style={{ width: `${Math.max(4, (item.value / maxStatusCount) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {platformView === "students" && (
            <section className="grid gap-4">
              <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid min-w-0 gap-3">
                  <label className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} className="input pl-9" placeholder="Rechercher une école..." />
                  </label>
                  <FilterSelect icon={Filter} value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                    <option value="all">Tous statuts</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspendue</option>
                  </FilterSelect>
                  <FilterSelect icon={Building2} value={typeFilter} onChange={(value) => setTypeFilter(value as typeof typeFilter)}>
                    <option value="all">Tous types</option>
                    <option value="Maternelle">Maternelle</option>
                    <option value="Primaire">Primaire</option>
                    <option value="Secondaire">Secondaire</option>
                    <option value="Primaire uniquement">Primaire uniquement</option>
                    <option value="Secondaire uniquement">Secondaire uniquement</option>
                    <option value="Mixte">Mixte</option>
                  </FilterSelect>
                  <FilterSelect icon={ArrowUpDown} value={sortBy} onChange={(value) => setSortBy(value as SchoolSort)}>
                    <option value="az">A-Z</option>
                    <option value="recent">Plus récente</option>
                    <option value="users">Plus d'utilisateurs</option>
                  </FilterSelect>
                </div>
              </div>

              <div className="grid min-w-0 gap-3">
                {filteredSchools.length === 0 && (
                  <div className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
                    Aucune école ne correspond aux filtres.
                  </div>
                )}
                {filteredSchools.map((school) => (
                  <SchoolSaasCard
                    key={school.id}
                    school={school}
                    selected={school.id === selectedSchool?.id}
                    onSelect={() => openSchoolDrawer(school.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {platformView === "menu" && (
            <section className="grid min-w-0 gap-4">
              <div className="grid min-w-0 gap-3">
                <button
                  onClick={() => setPlatformMenuDrawer("create-school")}
                  className="group flex min-w-0 items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block break-words font-bold text-ink">Créer une école</span>
                    <span className="mt-1 block break-words text-sm text-slate-500">Ajouter une école et son administrateur principal.</span>
                  </span>
                  <Plus className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:text-blue-700" />
                </button>
                <button
                  onClick={() => setPlatformMenuDrawer("logo")}
                  className="group flex min-w-0 items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block break-words font-bold text-ink">Logo de l'application</span>
                    <span className="mt-1 block break-words text-sm text-slate-500">Gérer le logo affiché sur l'écran de connexion.</span>
                  </span>
                  <Upload className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:text-blue-700" />
                </button>
                <button
                  onClick={() => setPlatformMenuDrawer("billing-controls")}
                  className="group flex min-w-0 items-center justify-between gap-3 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40"
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block break-words font-bold text-ink">Contrôle des pièces jointes Valves</span>
                    <span className="mt-1 block break-words text-sm text-slate-500">Suspendre ou réactiver les nouveaux uploads Valves.</span>
                  </span>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-slate-400 transition group-hover:text-blue-700" />
                </button>
              </div>

              <FormPanel title="Session">
                <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                  <LogOut className="h-4 w-4" /> Déconnexion
                </button>
              </FormPanel>
            </section>
          )}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
        <div className={`mx-auto grid w-full max-w-lg ${showInstallButton ? "grid-cols-4" : "grid-cols-3"} gap-1`}>
          {platformTabs.map((tab) => {
            const Icon = tab.icon;
            const active = platformView === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setPlatformView(tab.id)}
                className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold transition min-[360px]:text-[11px] sm:px-1 sm:text-xs ${
                  active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                }`}
                aria-current={active ? "page" : undefined}
                type="button"
              >
                <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-700" : "text-slate-400"}`} />
                <span className="max-w-full truncate">{tab.label}</span>
              </button>
            );
          })}
          {showInstallButton && <InstallPwaNavButton onInstall={onInstallPwa} />}
        </div>
      </nav>

      {platformMenuDrawer === "create-school" && (
        <AdminDrawer title="Créer une école" onClose={() => setPlatformMenuDrawer(null)} closeLabel="Fermer la création d'école">
          {renderCreateSchoolForm()}
        </AdminDrawer>
      )}
      {platformMenuDrawer === "logo" && (
        <AdminDrawer title="Logo de l'application" onClose={() => setPlatformMenuDrawer(null)} closeLabel="Fermer la gestion du logo">
          {renderPlatformLogoForm()}
        </AdminDrawer>
      )}
      {platformMenuDrawer === "billing-controls" && (
        <AdminDrawer title="Contrôle des pièces jointes Valves" onClose={() => setPlatformMenuDrawer(null)} closeLabel="Fermer le contrôle des pièces jointes Valves">
          <BillingControlsDrawer
            controls={billingControls.controls}
            loading={billingControls.loading}
            error={billingControls.error}
            updatedBy={user.id}
            onSetValvesUploadsEnabled={billingControls.setValvesUploadsEnabled}
          />
        </AdminDrawer>
      )}

      {drawerSchool && (
        <AdminDrawer title={drawerSchool.name} onClose={closeSchoolDrawer} closeLabel="Fermer les informations de l'école">
          <div className="grid gap-4">
            <div className="flex min-w-0 items-start gap-3 rounded border border-slate-200 bg-slate-50 p-4">
              <SchoolLogo school={drawerSchool} />
              <div className="min-w-0">
                <h2 className="break-words text-lg font-bold text-ink">{drawerSchool.name}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge status={drawerSchool.status} />
                </div>
              </div>
            </div>
            <div className="grid gap-3 rounded border border-slate-200 bg-white p-3 shadow-sm">
              <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                {(["overview", "info", "admins", "history"] as SchoolDetailTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDetailTab(tab)}
                    className={`inline-flex min-w-0 items-center justify-center rounded px-2 py-2 text-center text-xs font-semibold transition sm:px-3 ${
                      detailTab === tab ? "bg-ink text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                    type="button"
                  >
                    {schoolTabLabel(tab)}
                  </button>
                ))}
              </div>
              <div className="grid min-w-0 grid-cols-2 gap-2 border-t border-slate-100 pt-3 sm:grid-cols-4">
                <button onClick={() => void editSchool(drawerSchool)} className="secondary-button justify-center px-2 text-xs sm:px-3 sm:text-sm" type="button">Modifier</button>
                <button onClick={() => void changeSchoolStatus(drawerSchool)} className="secondary-button justify-center px-2 text-xs sm:px-3 sm:text-sm" type="button">
                  {drawerSchool.status === "active" ? "Suspendre" : "Reactiver"}
                </button>
                <button onClick={() => openBiometricDrawer(drawerSchool)} className="secondary-button justify-center px-2 text-xs sm:px-3 sm:text-sm" type="button">
                  Terminal biométrique
                </button>
                <button onClick={() => openDeleteSchoolDialog(drawerSchool)} className="inline-flex min-w-0 items-center justify-center rounded bg-red-50 px-2 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 sm:px-3 sm:text-sm" type="button">
                  Supprimer
                </button>
              </div>
            </div>
            {schoolDetailLoading && (
              <p className="rounded border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                Chargement des données de cette école...
              </p>
            )}
            {schoolDetailError && (
              <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                {schoolDetailError}
              </p>
            )}

            {detailTab === "overview" && (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniStat label="Élèves" value={drawerStats.students} />
                  <MiniStat label="Parents" value={drawerStats.parents} />
                  <MiniStat label="Administrateurs" value={drawerStats.admins} />
                  <MiniStat label="Total utilisateurs" value={drawerStats.users} />
                </div>
                <div className="rounded bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-ink">Effectif des élèves par classe</p>
                  <p className="mt-1 text-xs text-slate-500">Répartition des élèves inscrits dans les différentes classes de l'établissement.</p>
                  <div className="mt-4 grid gap-3">
                    {drawerClassEnrollment.length === 0 && (
                      <p className="rounded border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                        Aucun élève actif chargé pour l'année scolaire de cette école.
                      </p>
                    )}
                    {drawerClassEnrollment.map((item) => (
                      <div key={item.label} className="grid gap-1">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words font-semibold text-slate-700">{item.label}</span>
                          <span className="shrink-0 font-bold text-ink">{item.count}</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-white">
                          <div className="h-full rounded-full bg-mint" style={{ width: `${Math.max(4, (item.count / maxDrawerClassEnrollment) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <AuditTimeline logs={drawerLogs.slice(0, 4)} />
              </div>
            )}

            {detailTab === "info" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoRow label="Nom" value={drawerSchool.name} />
                <InfoRow label="Sigle" value={drawerSchool.acronym ?? "-"} />
                <InfoRow label="Adresse" value={drawerSchool.address || "-"} />
                <InfoRow label="Téléphone" value={drawerSchool.phone || "-"} />
                <InfoRow label="Email" value={drawerSchool.email || "-"} />
                <label className="grid gap-1 rounded bg-slate-50 p-3 text-sm">
                  <span className="font-semibold text-slate-500">Niveau de l'école</span>
                  <select
                    value={schoolLevelFromConfig(drawerSchool)}
                    onChange={(event) => openSchoolLevelChangeDialog(drawerSchool, event.target.value as SchoolLevelChoice)}
                    className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2 font-semibold text-ink"
                  >
                    {schoolLevelChoices.map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </label>
                <InfoRow label="Statut" value={drawerSchool.status} />
                <InfoRow label="Date de création" value={drawerSchool.createdAt ? new Date(drawerSchool.createdAt).toLocaleDateString("fr-FR") : "-"} />
                <InfoRow label="Administrateur principal" value={drawerMainAdmin?.name ?? "-"} />
                <InfoRow label="Niveaux" value={(drawerSchool.educationLevels ?? []).join(", ") || "-"} />
                <InfoRow label="Options" value={drawerSchoolOptions.join(", ") || "-"} />
                <InfoRow label="Type" value={drawerSchool.schoolType ?? "-"} />
                <InfoRow label="Élèves" value={String(drawerStats.students)} />
                <InfoRow label="Parents" value={String(drawerStats.parents)} />
                <InfoRow label="Administrateurs" value={String(drawerStats.admins)} />
                <InfoRow label="Utilisateurs" value={String(drawerStats.users)} />
              </div>
            )}

            {detailTab === "admins" && (
              <div className="grid gap-3">
                <button
                  onClick={() => {
                    setSelectedSchoolId(drawerSchool.id);
                    openCreateAdminModal();
                  }}
                  className="primary-button justify-center"
                  type="button"
                >
                  <Plus className="h-4 w-4" /> Ajouter un admin
                </button>
                {drawerAdmins.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun administrateur pour cette école.</p>}
                {drawerAdmins.map((admin) => (
                  <div key={admin.id} className="rounded border border-slate-200 p-3">
                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{admin.name}</p>
                        <p className="break-words text-sm text-slate-500">{admin.email}</p>
                        <p className="break-words text-xs text-slate-400">{admin.phone ?? "Téléphone non renseigné"}</p>
                      </div>
                      <StatusPill active={admin.status !== "inactive"} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button onClick={() => openEditAdminModal(admin)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">
                        Modifier
                      </button>
                      <button onClick={() => toggleAdminStatus(admin)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">
                        {admin.status === "inactive" ? "Réactiver" : "Désactiver"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {detailTab === "history" && <AuditTimeline logs={drawerLogs} />}

          </div>
        </AdminDrawer>
      )}

      {biometricSchool && (
        <AdminDrawer title="Terminal biométrique" onClose={closeBiometricDrawer} closeLabel="Fermer les terminaux biométriques">
          <div className="grid min-w-0 gap-4">
            <div className="rounded border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-500">École</p>
              <h2 className="mt-1 break-words text-lg font-bold text-ink">{biometricSchool.name}</h2>
              <p className="mt-2 text-sm text-slate-500">Acadéa enregistre et rattache les terminaux compatibles. Aucun secret matériel n'est stocké dans cette interface.</p>
            </div>
            {terminalMessage && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{terminalMessage}</p>}
            {terminalError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{terminalError}</p>}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-bold text-ink">Terminaux liés</p>
                <p className="text-sm text-slate-500">{biometricSchoolTerminals.length} terminal(aux) enregistré(s)</p>
              </div>
              <button onClick={openCreateTerminalForm} className="primary-button justify-center" type="button">
                <Plus className="h-4 w-4" /> Ajouter un terminal
              </button>
            </div>

            {terminalFormOpen && (
              <div className="grid gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-ink">{editingTerminalId ? "Modifier le terminal" : "Ajouter un terminal"}</h3>
                    <p className="text-sm text-slate-500">Le terminal sera rattaché uniquement à cette école.</p>
                  </div>
                  <button onClick={resetTerminalForm} className="rounded bg-slate-100 p-2 text-slate-500 hover:text-ink" type="button" aria-label="Fermer le formulaire terminal">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Nom du terminal
                    <input value={terminalForm.name} onChange={(event) => setTerminalForm((current) => ({ ...current, name: event.target.value }))} className="input" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Marque
                    <input value={terminalForm.brand} onChange={(event) => setTerminalForm((current) => ({ ...current, brand: event.target.value }))} className="input" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Modèle
                    <input value={terminalForm.model} onChange={(event) => setTerminalForm((current) => ({ ...current, model: event.target.value }))} className="input" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Numéro de série
                    <input value={terminalForm.serialNumber} onChange={(event) => setTerminalForm((current) => ({ ...current, serialNumber: event.target.value }))} className="input" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Device ID
                    <input value={terminalForm.deviceId} onChange={(event) => setTerminalForm((current) => ({ ...current, deviceId: event.target.value }))} className="input" placeholder="Optionnel" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600">
                    Emplacement
                    <input value={terminalForm.location} onChange={(event) => setTerminalForm((current) => ({ ...current, location: event.target.value }))} className="input" placeholder="Entrée principale" />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold text-slate-600 sm:col-span-2">
                    Notes facultatives
                    <textarea value={terminalForm.notes} onChange={(event) => setTerminalForm((current) => ({ ...current, notes: event.target.value }))} className="input min-h-24" />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button onClick={resetTerminalForm} className="secondary-button justify-center" type="button">Annuler</button>
                  <button onClick={saveTerminal} className="primary-button justify-center" type="button">
                    <CheckCircle2 className="h-4 w-4" /> Enregistrer le terminal
                  </button>
                </div>
              </div>
            )}

            {biometricSchoolTerminals.length === 0 ? (
              <p className="rounded border border-dashed border-slate-300 bg-white p-5 text-center text-sm font-semibold text-slate-500">
                Aucun terminal biométrique enregistré pour cette école.
              </p>
            ) : (
              <div className="grid gap-3">
                {biometricSchoolTerminals.map((terminal) => (
                  <article key={terminal.id} className="rounded border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words font-bold text-ink">{terminal.name}</h3>
                          <BiometricTerminalStatusBadge status={terminal.status} />
                        </div>
                        <p className="mt-1 break-words text-sm font-semibold text-slate-500">{terminal.brand} · {terminal.model}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => openEditTerminalForm(terminal)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">Modifier</button>
                        <button onClick={() => setTerminalStatus(terminal, "disabled")} className="rounded bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" type="button">Désactiver</button>
                        <button onClick={() => replaceTerminal(terminal)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">Remplacer</button>
                        <button onClick={testTerminalConnection} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">Tester la connexion</button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <InfoRow label="Numéro de série" value={terminal.serialNumber} />
                      <InfoRow label="Device ID" value={terminal.deviceId || "-"} />
                      <InfoRow label="Emplacement" value={terminal.location || "-"} />
                      <InfoRow label="Terminal ID" value={terminal.terminalId} />
                      <InfoRow label="Date d'ajout" value={new Date(terminal.createdAt).toLocaleDateString("fr-FR")} />
                      <InfoRow label="Dernière synchronisation" value={terminal.lastSyncAt ? new Date(terminal.lastSyncAt).toLocaleString("fr-FR") : "-"} />
                      {terminal.notes && <InfoRow label="Notes" value={terminal.notes} />}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </AdminDrawer>
      )}

      {schoolDeleteTarget && (
        <AdminDrawer title="Supprimer l'école" onClose={closeDeleteSchoolDialog} closeLabel="Annuler la suppression de l'école">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            Cette action supprimera définitivement l'école {schoolDeleteTarget.name} et ses données rattachées. Pour confirmer, saisissez exactement : SUPPRIMER ECOLE
          </p>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Phrase de confirmation
            <input
              value={schoolDeleteConfirmation}
              onChange={(event) => {
                setSchoolDeleteConfirmation(event.target.value);
                setSchoolActionError("");
              }}
              className="input"
              placeholder="SUPPRIMER ECOLE"
              disabled={schoolDeleteLoading}
            />
          </label>
          {schoolDeleteConfirmation && schoolDeleteConfirmation.trim() !== "SUPPRIMER ECOLE" && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
              Confirmation incorrecte. Saisissez exactement : SUPPRIMER ECOLE
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={closeDeleteSchoolDialog} disabled={schoolDeleteLoading} className="secondary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Annuler
            </button>
            <button
              onClick={() => void deleteSchool()}
              disabled={schoolDeleteLoading || schoolDeleteConfirmation.trim() !== "SUPPRIMER ECOLE"}
              className="inline-flex min-w-0 items-center justify-center rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              {schoolDeleteLoading ? "Suppression..." : "Supprimer"}
            </button>
          </div>
        </AdminDrawer>
      )}

      {schoolLevelChangeTarget && (
        <AdminDrawer title="Changer le niveau de l'école" onClose={closeSchoolLevelChangeDialog} closeLabel="Annuler le changement de niveau">
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Cette modification est importante et peut avoir un impact sur le fonctionnement de l'école {schoolLevelChangeTarget.school.name}. Pour confirmer le passage au niveau {schoolLevelChangeTarget.level}, saisissez exactement : CHANGER LE NIVEAU DE L'ECOLE
          </p>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Phrase de confirmation
            <input
              value={schoolLevelConfirmation}
              onChange={(event) => setSchoolLevelConfirmation(event.target.value)}
              className="input"
              placeholder="CHANGER LE NIVEAU DE L'ECOLE"
            />
          </label>
          {schoolLevelConfirmation && schoolLevelConfirmation !== "CHANGER LE NIVEAU DE L'ECOLE" && (
            <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
              Confirmation incorrecte. Saisissez exactement : CHANGER LE NIVEAU DE L'ECOLE
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={closeSchoolLevelChangeDialog} className="secondary-button justify-center" type="button">
              Annuler
            </button>
            <button
              onClick={() => void confirmSchoolLevelChange()}
              disabled={schoolLevelConfirmation !== "CHANGER LE NIVEAU DE L'ECOLE"}
              className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
            >
              Confirmer
            </button>
          </div>
        </AdminDrawer>
      )}

      {adminModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <section className="max-h-[calc(100vh-2rem)] w-full max-w-lg min-w-0 overflow-y-auto rounded border border-slate-200 bg-white p-4 shadow-xl sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{editingAdminId ? "Modifier administrateur" : "Ajouter administrateur"}</h2>
                <p className="text-sm text-slate-500">{selectedSchool?.name}</p>
              </div>
              <button onClick={() => setAdminModalOpen(false)} className="rounded bg-slate-100 p-2">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid gap-3">
              <Field label="Nom" value={adminName} onChange={setAdminName} />
              <Field label="Email" value={modalAdminEmail} onChange={setModalAdminEmail} type="email" />
              <Field label="Téléphone" value={adminPhone} onChange={setAdminPhone} />
              {!editingAdminId && (
                <>
                  <PasswordField label="Mot de passe" value={modalAdminPassword} onChange={setModalAdminPassword} visible={showModalPassword} onToggle={() => setShowModalPassword(!showModalPassword)} />
                  <PasswordField label="Confirmation" value={modalAdminPasswordConfirm} onChange={setModalAdminPasswordConfirm} visible={showModalPassword} onToggle={() => setShowModalPassword(!showModalPassword)} />
                  <p className={`text-xs font-semibold ${modalAdminPassword.length >= 6 ? "text-mint" : "text-amber-700"}`}>
                    Minimum 6 caractères, confirmation identique.
                  </p>
                </>
              )}
              <button disabled={!adminFormValid} onClick={saveAdmin} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50">
                <CheckCircle2 className="h-4 w-4" /> Enregistrer
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${active ? "bg-mint/10 text-mint" : "bg-slate-100 text-slate-500"}`}>{active ? "Actif" : "Inactif"}</span>;
}

function FilterSelect({
  icon: Icon,
  value,
  onChange,
  children,
}: {
  icon: typeof BookOpen;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="relative">
      <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <select value={value} onChange={(event) => onChange(event.target.value)} className="input pl-9">
        {children}
      </select>
    </label>
  );
}
