import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  ArrowUpDown,
  ArrowLeft,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Edit3,
  Eye,
  EyeOff,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Menu as MenuIcon,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  UserRound,
  UsersRound,
} from "lucide-react";
import { getDefaultRoute, signIn, signOutUser, subscribeToFirebaseUser, validateDisciplineDirector, validateParent, validatePlatformAdmin, validateSchoolStaff } from "./services/auth";
import { DisciplineHistoryDrawer } from "./components/discipline/DisciplineHistoryDrawer";
import { DisciplineStatistics } from "./components/discipline/DisciplineStatistics";
import { DisciplineStatus } from "./components/discipline/DisciplineStatus";
import { DisciplineAttendanceDrawer } from "./components/discipline/DisciplineAttendanceDrawer";
import { AttendanceSettingsDrawer } from "./components/discipline/AttendanceSettingsDrawer";
import { NewSanctionDrawer } from "./components/discipline/NewSanctionDrawer";
import { MessageDrawerContent } from "./components/messages/MessageDrawerContent";
import { ParentFormEditor } from "./components/parents/ParentFormEditor";
import { ParentsDirectoryDrawer } from "./components/parents/ParentsDirectoryDrawer";
import { StudentDetailPage } from "./components/students/StudentDetailPage";
import { ValvesDrawerContent } from "./components/valves/ValvesDrawerContent";
import { StudentsModule } from "./modules/students/StudentsModule";
import { PlatformModule } from "./modules/platform/PlatformModule";
import { AdminDrawer, Field, FormPanel, IconButton, ImageUploadField, Metric, PasswordField, SectionTitle } from "./components/ui";
import { useBillingControls } from "./hooks/useBillingControls";
import { usePaginatedControlHistory } from "./hooks/usePaginatedControlHistory";
import { usePaginatedNotifications } from "./hooks/usePaginatedNotifications";
import { useRealtimeMessageFeed } from "./hooks/useRealtimeMessageFeed";
import { markNotificationsReadTargeted } from "./services/notificationsPagination";
import { canUseFirestoreData, loadDisciplineYearData, loadFirestoreData, loadFirestoreYearData, loadPlatformSettings, persistFirestorePatch } from "./services/firestoreData";
import { markConversationUnreadCountRead, persistMessageWithConversation } from "./services/conversations";
import { loadSuperAdminInitialData } from "./services/superAdminData";
import type { SuperAdminGlobalCounts } from "./services/superAdminData";
import { completeDisciplineSanction, createDisciplineSanction, saveDisciplineAuditLog } from "./services/discipline";
import { db } from "./firebase";
import { deleteParentAccount, provisionSchoolUser } from "./services/provisioning";
import { fetchParentMessageQuota, sendParentMessageWithQuota } from "./services/parentMessaging";
import type { ParentMessageQuota } from "./services/parentMessaging";
import { buildDashboardFinancialAggregates, buildDashboardTransactionDayRows } from "./utils/dashboardStats";
import { formatSchoolRecipientLabel } from "./utils/messages";
import { escapePdfHtml, generateReceiptPdf, money, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./utils/pdf";
import type { PdfTableColumn } from "./utils/pdf";
import { resolveDefaultSchoolYear } from "./utils/schoolYears";
import { buildStats, getStudentBalance } from "./utils/stats";
import { getStudentFeeSummaries } from "./utils/studentFeeSummary";
import { buildSchoolYearDataIndexes, sumPaymentsForStudentFee } from "./utils/dataIndexes";
import { buildDisciplineStats } from "./utils/disciplineStats";
import { attendanceRecordId, attendanceStatusText, resolveAttendanceStatusForArrival } from "./utils/attendance";
import { buildFeeTargetChoices, feeAppliesToStudent, feeTargetClassName, formatFeeTargetValue } from "./utils/feeTargets";
import { formatValveAttachmentSize, MAX_VALVE_ATTACHMENTS, MAX_VALVE_ATTACHMENTS_TOTAL_SIZE, validateValveAttachments } from "./utils/valvesMedia";
import { getSchoolClassChoices, getSchoolEducationLevels } from "./utils/schoolConfig";
import type { SchoolLevelChoice } from "./utils/schoolConfig";
import { formatStudentClassName, getClassSection } from "./utils/studentClasses";
import { isArchivedStudent } from "./utils/studentUtils";
import type {
  AppData,
  AppNotification,
  AppUser,
  AttendanceRecord,
  AttendanceSettings,
  AttendanceStatus,
  AuditLog,
  DisciplineSanction,
  Expense,
  FeeKind,
  FeeType,
  Message,
  ParentProfile,
  Payment,
  School,
  SchoolClass,
  SchoolSection,
  SchoolYear,
  Student,
  ValvePublication,
} from "./types";
import { CLASSES, FEE_KINDS } from "./types";

type Tab = "dashboard" | "students" | "parents" | "control" | "reports" | "messages" | "menu";
type ParentTab = "children" | "messages" | "menu";
type DisciplineTab = "status" | "attendance" | "messages" | "menu";
type SchoolUserProvisionRole = "cashier" | "discipline_director";
type NewDisciplineSanctionFormInput = {
  students: Student[];
  reason: string;
  description: string;
  sanctionType: string;
  duration: number;
  startDate: string;
  expectedEndDate: string;
  observation: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const roleLabels: Record<AppUser["role"], string> = {
  super_admin: "Super Administrateur",
  school_admin: "Administrateur d'école",
  cashier: "Caissier",
  discipline_director: "Directeur de Discipline",
  parent: "Parent",
};

const schoolUserProvisionLabels: Record<SchoolUserProvisionRole, string> = {
  cashier: "Caissier",
  discipline_director: "Directeur de Discipline",
};

const appEnvironment = import.meta.env.VITE_APP_ENV ?? "development";
const showStagingBanner = import.meta.env.VITE_STAGING_BANNER === "true" || appEnvironment === "staging" || appEnvironment === "preview";
const stagingLabel = import.meta.env.VITE_STAGING_LABEL ?? "ENVIRONNEMENT DE TEST";
const defaultManifestHref = "/manifest.webmanifest";
const emptyAppData: AppData = {
  users: [],
  schools: [],
  schoolYears: [],
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
  attendance: [],
  attendanceSettings: [],
  biometricTerminals: [],
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function parentEmailDomain(school: School) {
  const cleanedName = school.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^(c\.?\s*s\.?|ecole|institut|complexe\s+scolaire|groupe\s+scolaire|college|lycee)\s+/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return `${cleanedName || "acadea"}.com`;
}

function parentEmailExists(email: string, users: AppUser[], parents: ParentProfile[]) {
  const normalizedEmail = email.trim().toLowerCase();
  return [...users, ...parents].some((item) => item.email.toLowerCase() === normalizedEmail);
}

function nextParentEmail(school: School, users: AppUser[], parents: ParentProfile[]) {
  const domain = parentEmailDomain(school);
  const usedNumbers = new Set<number>();
  [...users, ...parents].forEach((item) => {
    if (item.schoolId !== school.id) return;
    const match = item.email.toLowerCase().match(new RegExp(`^parent(\\d{4})@${domain.replace(/\./g, "\\.")}$`));
    if (match) usedNumbers.add(Number(match[1]));
  });
  let nextNumber = 1;
  while (usedNumbers.has(nextNumber) || parentEmailExists(`parent${String(nextNumber).padStart(4, "0")}@${domain}`, users, parents)) {
    nextNumber += 1;
  }
  return `parent${String(nextNumber).padStart(4, "0")}@${domain}`;
}

function nextSchoolYearDefaults(year: SchoolYear) {
  const startYear = Number(year.startsAt.slice(0, 4));
  const fallbackStartYear = new Date().getFullYear();
  const nextStartYear = Number.isFinite(startYear) ? startYear + 1 : fallbackStartYear;
  const nextEndYear = nextStartYear + 1;
  return {
    name: `${nextStartYear}-${nextEndYear}`,
    startsAt: `${nextStartYear}-09-01`,
    endsAt: `${nextEndYear}-07-31`,
  };
}

function loadInitialData() {
  return emptyAppData;
}

function mergeNotificationsById(currentItems: AppNotification[], nextItems: AppNotification[]) {
  const itemsById = new Map<string, AppNotification>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function mergeMessagesById(currentItems: Message[], nextItems: Message[]) {
  const itemsById = new Map<string, Message>();
  [...currentItems, ...nextItems].forEach((item) => {
    itemsById.set(item.id, item);
  });
  return Array.from(itemsById.values()).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

function getOrCreateHeadLink(selector: string, rel: string) {
  let link = document.head.querySelector<HTMLLinkElement>(selector);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

async function applyPlatformLogoAssets() {
  if (typeof document === "undefined") return;
  const manifestLink = getOrCreateHeadLink('link[rel="manifest"]', "manifest");
  manifestLink.href = defaultManifestHref;
  const appleIcon = getOrCreateHeadLink('link[rel="apple-touch-icon"]', "apple-touch-icon");
  appleIcon.href = "/icons/apple-touch-icon.png";
  const iconLink = getOrCreateHeadLink('link[rel="icon"]', "icon");
  iconLink.href = "/favicon.png";
  iconLink.type = "image/png";
  delete iconLink.dataset.platformLogo;
}

function getInitialRoute() {
  if (typeof window === "undefined") return "/login";
  const path = window.location.pathname;
  return path === "/platform" ? "/platform" : "/login";
}

function EnvironmentBanner() {
  if (!showStagingBanner) return null;

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-[70] bg-amber-500 px-3 py-2 text-center text-xs font-extrabold uppercase tracking-wide text-ink shadow-sm sm:text-sm">
        {stagingLabel}
      </div>
      <div className="h-9 sm:h-10" />
    </>
  );
}

function PlatformLogoSlot({ logoUrl, compact = false }: { logoUrl: string; compact?: boolean }) {
  const [logoShape, setLogoShape] = useState<"horizontal" | "vertical" | "balanced">("balanced");
  useEffect(() => {
    setLogoShape("balanced");
  }, [logoUrl]);
  const logoSource = logoUrl || "/acadea-icon.png";

  const containerClass =
    logoShape === "horizontal"
      ? compact
        ? "max-w-[220px] min-h-14"
        : "max-w-[320px] min-h-[72px] sm:max-w-[380px] sm:min-h-[88px]"
      : logoShape === "vertical"
        ? compact
          ? "max-w-[120px] min-h-20"
          : "max-w-[150px] min-h-[112px] sm:max-w-[180px] sm:min-h-[136px]"
        : compact
          ? "max-w-[150px] min-h-16"
          : "max-w-[210px] min-h-[88px] sm:max-w-[240px] sm:min-h-[108px]";
  const imageClass =
    logoShape === "horizontal"
      ? compact
        ? "max-h-14"
        : "max-h-20 sm:max-h-24"
      : logoShape === "vertical"
        ? compact
          ? "max-h-20"
          : "max-h-32 sm:max-h-40"
        : compact
          ? "max-h-16"
          : "max-h-24 sm:max-h-28";

  return (
    <div
      className={`mx-auto flex w-full items-center justify-center ${compact ? "mb-4" : ""} ${containerClass}`}
    >
      <img
        src={logoSource}
        alt="Logo de l'application"
        className={`h-auto w-auto max-w-full object-contain drop-shadow-[0_14px_28px_rgba(15,23,42,0.10)] ${imageClass}`}
        decoding="async"
        onError={(event) => {
          const image = event.currentTarget;
          if (image.src.endsWith("/acadea-icon.png")) return;
          image.src = "/acadea-icon.png";
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          const width = image.naturalWidth || image.width;
          const height = image.naturalHeight || image.height;
          if (!width || !height) return;
          const ratio = width / height;
          setLogoShape(ratio >= 1.45 ? "horizontal" : ratio <= 0.72 ? "vertical" : "balanced");
        }}
      />
    </div>
  );
}

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function InstallPwaNavButton({ onInstall }: { onInstall: () => void }) {
  return (
    <button
      onClick={onInstall}
      className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold text-mint transition hover:bg-mint/10 hover:text-mint min-[360px]:text-[11px] sm:px-1 sm:text-xs"
      type="button"
    >
      <span className="text-lg leading-none" aria-hidden="true">📲</span>
      <span className="max-w-full truncate">Installer Acadéa</span>
    </button>
  );
}

export default function App() {
  const [data, setData] = useState<AppData>(() => loadInitialData());
  const [user, setUser] = useState<AppUser | null>(null);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [parentFormRequest, setParentFormRequest] = useState<{ parentId?: string; requestId: number } | null>(null);
  const [route, setRoute] = useState(() => getInitialRoute());
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [platformCounts, setPlatformCounts] = useState<SuperAdminGlobalCounts | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const logoutInProgressRef = useRef(false);
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(() => isStandaloneDisplayMode());
  const billingControls = useBillingControls(Boolean(user));

  useEffect(() => {
    void applyPlatformLogoAssets();
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      if (!isStandaloneDisplayMode()) {
        setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
        setPwaInstalled(false);
      }
    }

    function handleAppInstalled() {
      setDeferredInstallPrompt(null);
      setPwaInstalled(true);
    }

    const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
    function handleStandaloneChange(event: MediaQueryListEvent) {
      if (event.matches) {
        setDeferredInstallPrompt(null);
        setPwaInstalled(true);
      } else {
        setPwaInstalled(false);
      }
    }

    if (isStandaloneDisplayMode()) {
      setDeferredInstallPrompt(null);
      setPwaInstalled(true);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    standaloneQuery?.addEventListener("change", handleStandaloneChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      standaloneQuery?.removeEventListener("change", handleStandaloneChange);
    };
  }, []);

  useEffect(() => {
    if (!canUseFirestoreData()) return;
    let cancelled = false;
    loadPlatformSettings()
      .then((settings) => {
        if (cancelled || !settings) return;
        const officialLogoUrl = settings.loginLogoUrl ?? "";
        setPlatformLogoUrl(officialLogoUrl);
      })
      .catch((error) => {
        console.warn("Logo officiel Acadéa indisponible.", error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const school = data.schools.find((item) => item.id === user?.schoolId);
  const schoolYears = useMemo(() => (school ? data.schoolYears.filter((year) => year.schoolId === school.id) : []), [data.schoolYears, school]);
  const selectedYear = schoolYears.find((year) => year.id === selectedYearId);

  const navigate = useCallback((nextRoute: string) => {
    setNotificationsOpen(false);
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  }, []);

  const applyAuthenticatedUser = useCallback((nextUser: AppUser | null) => {
    setAuthError("");

    if (!nextUser) {
      setUser(null);
      setSelectedYearId("");
      setActiveTab("dashboard");
      setDataLoading(false);
      setPlatformCounts(null);
      setData(loadInitialData());
      navigate("/login");
      return;
    }

    setUser(nextUser);
    setSelectedYearId("");
    setActiveTab("dashboard");
    navigate(getDefaultRoute(nextUser.role));
  }, [navigate]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    subscribeToFirebaseUser(
      (nextUser) => {
        if (cancelled) return;
        setAuthReady(true);
        applyAuthenticatedUser(nextUser);
      },
      (error) => {
        if (cancelled) return;
        console.error("[Acadéa auth] Session Firebase invalide.", error);
        if (!logoutInProgressRef.current) {
          setAuthError(error instanceof Error ? error.message : "Session Firebase invalide.");
        }
        setUser(null);
        setSelectedYearId("");
        setActiveTab("dashboard");
        setPlatformCounts(null);
        setData(loadInitialData());
        setAuthReady(true);
        navigate("/login");
      },
    )
      .then((nextUnsubscribe) => {
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[Acadéa auth] Firebase indisponible.", error);
        setAuthError(error instanceof Error ? error.message : "Configuration Firebase indisponible.");
        setAuthReady(true);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [applyAuthenticatedUser, navigate]);

  useEffect(() => {
    if (!user || !canUseFirestoreData()) return;

    let cancelled = false;
    setDataLoading(true);

    const loadData =
      user.role === "super_admin"
        ? loadSuperAdminInitialData(user.id).then(({ data: firestoreData, counts }) => {
            if (!cancelled) {
              setPlatformCounts(counts);
            }
            return firestoreData;
          })
        : loadFirestoreData(user);

    loadData
      .then((firestoreData) => {
        if (!firestoreData || cancelled) return;
        setData(firestoreData);
        const nextSchool = firestoreData.schools.find((item) => item.id === user.schoolId);
        const nextSchoolYears = nextSchool ? firestoreData.schoolYears.filter((year) => year.schoolId === nextSchool.id) : [];
        setSelectedYearId(resolveDefaultSchoolYear(nextSchool, nextSchoolYears)?.id ?? "");
      })
      .catch((error) => {
        if (cancelled || logoutInProgressRef.current) return;
        console.warn("Chargement Firestore indisponible.", error);
        setAuthError(error instanceof Error ? error.message : "Chargement Firestore impossible après connexion.");
        if (user.role === "super_admin") {
          setPlatformCounts(null);
          setData({ ...loadInitialData(), users: [user] });
          navigate("/platform");
          return;
        }
        setUser(null);
        setSelectedYearId("");
        setActiveTab("dashboard");
        setPlatformCounts(null);
        setData(loadInitialData());
        navigate("/login");
        void signOutUser().catch((signOutError) => {
          console.warn("Déconnexion Firebase après erreur de chargement impossible.", signOutError);
        });
      })
      .finally(() => {
        if (!cancelled) {
          setDataLoading(false);
        }
      });

    return () => {
      cancelled = true;
      setDataLoading(false);
    };
  }, [navigate, user]);

  useEffect(() => {
    if (!user || !school || selectedYearId) return;
    setSelectedYearId(resolveDefaultSchoolYear(school, schoolYears)?.id ?? "");
  }, [school, schoolYears, selectedYearId, user]);

  function enterSchoolYear(yearId: string) {
    setSelectedYearId(yearId);
    setUser((currentUser) => (currentUser ? { ...currentUser, activeSchoolYearId: yearId } : currentUser));
    setData((prev) => {
      const updated = {
        ...prev,
        users: prev.users.map((item) => (item.id === user?.id ? { ...item, activeSchoolYearId: yearId } : item)),
      };
      return updated;
    });
    if (user && canUseFirestoreData()) {
      setDataLoading(true);
      loadFirestoreData(user, yearId)
        .then((firestoreData) => {
          if (!firestoreData) return;
          setData({
            ...firestoreData,
            users: firestoreData.users.map((item) => (item.id === user.id ? { ...item, activeSchoolYearId: yearId } : item)),
          });
        })
        .catch((error) => {
          console.warn("Chargement Firestore indisponible pour cette année scolaire.", error);
        })
        .finally(() => {
          setDataLoading(false);
        });
    }
  }

  async function loginWithCredentials(email: string, password: string) {
    await signIn(email, password);
  }

  async function logout() {
    logoutInProgressRef.current = true;
    setUser(null);
    setSelectedYearId("");
    setActiveTab("dashboard");
    setPlatformCounts(null);
    setData(loadInitialData());
    setDataLoading(false);
    setAuthError("");
    navigate("/login");
    try {
      await signOutUser();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Déconnexion Firebase impossible.");
    } finally {
      logoutInProgressRef.current = false;
    }
  }

  function updateData(next: Partial<AppData>, options: { persist?: boolean } = {}) {
    setData((prev) => {
      const updated = { ...prev, ...next };
      if (options.persist !== false) {
        void persistFirestorePatch(next).catch((error) => {
          console.warn("Sauvegarde Firestore indisponible.", error);
        });
      }
      return updated;
    });
  }

  async function refreshData() {
    if (user && canUseFirestoreData()) {
      try {
        const firestoreData = await loadFirestoreData(user, selectedYearId || undefined);
        if (firestoreData) {
          setData(firestoreData);
          return;
        }
      } catch (error) {
        console.warn("Actualisation Firestore indisponible.", error);
      }
    }
  }

  async function refreshCurrentYearData() {
    if (isRefreshing || !user || !selectedYearId || !canUseFirestoreData()) return;

    setIsRefreshing(true);
    setRefreshError("");
    try {
      const firestoreYearData = await loadFirestoreYearData(user, selectedYearId);
      if (!firestoreYearData) {
        throw new Error("Actualisation Firestore indisponible.");
      }
      setData((prev) => ({
        ...prev,
        ...firestoreYearData,
      }));
    } catch (error) {
      console.warn("Actualisation ciblée Firestore indisponible.", error);
      setRefreshError("Impossible d'actualiser les données. Veuillez réessayer.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function refreshDisciplineData() {
    if (isRefreshing || !user || !selectedYearId || !canUseFirestoreData()) return;

    setIsRefreshing(true);
    setRefreshError("");
    try {
      const disciplineYearData = await loadDisciplineYearData(user, selectedYearId);
      if (!disciplineYearData) {
        throw new Error("Actualisation Firestore indisponible.");
      }
      setData((prev) => ({
        ...prev,
        ...disciplineYearData,
      }));
    } catch (error) {
      console.warn("Actualisation discipline Firestore indisponible.", error);
      setRefreshError("Impossible d'actualiser les données. Veuillez réessayer.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function installPwa() {
    if (!deferredInstallPrompt || pwaInstalled) return;

    const promptEvent = deferredInstallPrompt;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setPwaInstalled(true);
      }
    } finally {
      setDeferredInstallPrompt(null);
    }
  }

  const showInstallPwaButton = Boolean(deferredInstallPrompt) && !pwaInstalled;

  if (!authReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F7FB] px-4 text-center">
        <div>
          <PlatformLogoSlot logoUrl={platformLogoUrl} compact />
          <p className="font-semibold text-ink">Vérification de la session Firebase...</p>
        </div>
      </main>
    );
  }

  if (!user || route === "/login") {
    return <LoginScreen onLogin={loginWithCredentials} initialError={authError} platformLogoUrl={platformLogoUrl} />;
  }

  if (route === "/platform") {
    if (!validatePlatformAdmin(user)) {
      return <AccessDenied onLogout={logout} />;
    }

    return (
      <PlatformModule
        user={user}
        data={data}
        updateData={updateData}
        platformCounts={platformCounts}
        platformLogoUrl={platformLogoUrl}
        onPlatformLogoSaved={setPlatformLogoUrl}
        onLogout={logout}
        showInstallButton={showInstallPwaButton}
        onInstallPwa={installPwa}
        billingControls={billingControls}
        uid={uid}
        schoolEducationLevelChoices={schoolEducationLevelChoices}
        schoolLevelChoices={schoolLevelChoices}
        defaultSchoolOptions={defaultSchoolOptions}
        isSessionAuditAction={isSessionAuditAction}
        getPlatformSchoolStats={getPlatformSchoolStats}
        applyPlatformLogoAssets={applyPlatformLogoAssets}
        EnvironmentBanner={EnvironmentBanner}
        InstallPwaNavButton={InstallPwaNavButton}
        showStagingBanner={showStagingBanner}
        roleLabels={roleLabels}
        schoolTabLabel={schoolTabLabel}
      />
    );
  }

  if (dataLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F7FB] px-4 text-center">
        <div>
          <PlatformLogoSlot logoUrl={platformLogoUrl} compact />
          <p className="font-semibold text-ink">Bienvenue, préparation de votre espace sécurisé...</p>
        </div>
      </main>
    );
  }

  if ((!validateSchoolStaff(user) && !validateParent(user) && !validateDisciplineDirector(user)) || !school) {
    return <AccessDenied onLogout={logout} />;
  }

  if (!selectedYear) {
    return (
      <YearScreen
        user={user}
        years={schoolYears}
        activeYearId={school.activeSchoolYearId}
        onSelect={enterSchoolYear}
        onLogout={logout}
        onCreate={(year) => setData((prev) => ({ ...prev, schoolYears: [...prev.schoolYears, year] }))}
      />
    );
  }

  const currentSchool = school;
  const currentYear = selectedYear;
  const yearData = scopeData(data, currentSchool.id, currentYear.id, user);
  const studentDetailMatch = route.match(/^\/admin\/eleves\/(.+)$/);
  const unreadNotifications = yearData.notifications.filter((notification) => !notification.read).length;

  function markNotificationsRead(notificationId?: string) {
    if (!user) return;
    updateData(
      {
        notifications: data.notifications.map((notification) =>
          notification.schoolId === currentSchool.id &&
          notification.schoolYearId === currentYear.id &&
          (notificationId ? notification.id === notificationId : true)
            ? { ...notification, read: true }
            : notification,
        ),
      },
      { persist: false },
    );
    void markNotificationsReadTargeted(user, currentSchool.id, currentYear.id, notificationId).catch((error) => {
      console.warn("Marquage ciblé des notifications impossible.", error);
    });
    if (user) {
      void markConversationUnreadCountRead(user, currentSchool.id, currentYear.id).catch((error) => {
        console.warn("Remise à zéro des compteurs de conversation impossible.", error);
      });
    }
  }

  function openNotifications() {
    if (notificationsOpen) {
      closeNotifications();
      return;
    }
    setNotificationsOpen(true);
  }

  function closeNotifications() {
    setNotificationsOpen(false);
    markNotificationsRead();
  }

  function openParentFormFromDirectory(parentId?: string) {
    setParentFormRequest({ parentId, requestId: Date.now() });
  }

  if (validateParent(user)) {
    return <ParentPortal user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} onRefresh={refreshData} onLogout={logout} showInstallButton={showInstallPwaButton} onInstallPwa={installPwa} />;
  }

  if (validateDisciplineDirector(user)) {
    return (
      <DisciplinePortal
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={selectedYear}
        updateData={updateData}
        onRefresh={refreshDisciplineData}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        onLogout={logout}
        showInstallButton={showInstallPwaButton}
        onInstallPwa={installPwa}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBanner />
      <Header
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={selectedYear}
        unreadNotifications={unreadNotifications}
        notificationsOpen={notificationsOpen}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        onRefresh={refreshCurrentYearData}
        onToggleNotifications={openNotifications}
        onCloseNotifications={closeNotifications}
        onRealtimeNotifications={(notifications) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        }}
        onRealtimeMessages={(messages) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        }}
      />

      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {studentDetailMatch ? (
          <StudentDetailPage
            studentId={studentDetailMatch[1]}
            user={user}
            data={data}
            yearData={yearData}
            year={selectedYear}
            school={school}
            updateData={updateData}
            onBack={() => {
              setActiveTab("students");
              navigate("/dashboard");
            }}
            createAuditLog={createAuditLog}
            formatArchiveDate={formatArchiveDate}
            resolvePaymentCashierName={resolvePaymentCashierName}
          />
        ) : route === "/admin/rapport-financier" ? (
          <FinancialReportPage
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            onBack={() => {
              setActiveTab("menu");
              navigate("/dashboard");
            }}
          />
        ) : activeTab === "dashboard" && <Dashboard data={yearData} school={school} year={selectedYear} />}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "students" && (
          <StudentsModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            onOpenStudent={(studentId) => navigate(`/admin/eleves/${studentId}`)}
            uid={uid}
            createAuditLog={createAuditLog}
            formatArchiveDate={formatArchiveDate}
            parentEmailExists={parentEmailExists}
            nextParentEmail={nextParentEmail}
            exportStudentsPdf={exportStudentsPdf}
            exportAgeHomogeneityPdf={exportAgeHomogeneityPdf}
            sortStudentsForPdfByClass={sortStudentsForPdfByClass}
            studentImportKey={studentImportKey}
          />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "parents" && (
          <ParentsModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
          />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "control" && (
          <ControlModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "reports" && (
          <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "menu" && (
          <MenuModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            years={schoolYears}
            selectedYear={selectedYear}
            onYearChange={enterSchoolYear}
            updateData={updateData}
            onLogout={logout}
            valvesUploadsEnabled={billingControls.controls.valvesUploadsEnabled}
            onCreateParentFromDirectory={() => openParentFormFromDirectory()}
            onEditParentFromDirectory={(parent) => openParentFormFromDirectory(parent.id)}
          />
        )}
      </main>
      {parentFormRequest && (
        <AdminDrawer
          title={parentFormRequest.parentId ? "Modifier le parent" : "Créer un parent"}
          onClose={() => setParentFormRequest(null)}
          closeLabel="Fermer le formulaire parent"
        >
          <ParentFormEditor
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            initialParentId={parentFormRequest.parentId}
            requestId={parentFormRequest.requestId}
            onBack={() => setParentFormRequest(null)}
            showBackButton
            createId={uid}
            emptyParent={emptyParent}
            nextParentEmail={nextParentEmail}
          />
        </AdminDrawer>
      )}
      <BottomNavigation
        user={user}
        activeTab={activeTab}
        showInstallButton={showInstallPwaButton}
        onInstallPwa={installPwa}
        onTab={(tab) => {
          closeNotifications();
          setActiveTab(tab);
          navigate("/dashboard");
        }}
      />
    </div>
  );
}

function scopeData(data: AppData, schoolId: string, schoolYearId: string, user: AppUser) {
  const students =
    user.role === "parent"
      ? data.students.filter((student) => student.parentId === user.parentId && student.schoolId === schoolId && student.schoolYearId === schoolYearId)
      : data.students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId);
  const studentIds = students.map((student) => student.id);
  const parentIds = new Set(students.map((student) => student.parentId).filter(Boolean));
  const canShowSchoolNotification = (notification: AppNotification) => {
    if (notification.parentId || notification.recipientRole !== "school") return !notification.parentId || notification.recipientRole === "school";
    if (notification.schoolRecipient) {
      if (user.role === "school_admin") return notification.schoolRecipient === "admin" || notification.schoolRecipient === "both";
      if (user.role === "cashier") return notification.schoolRecipient === "cashier" || notification.schoolRecipient === "both";
      if (user.role === "discipline_director") return notification.schoolRecipient === "discipline";
    }
    if (!notification.messageId) return true;
    const linkedMessage = data.messages.find((message) => message.id === notification.messageId);
    if (!linkedMessage?.schoolRecipient) return true;
    if (user.role === "school_admin") return linkedMessage.schoolRecipient === "admin" || linkedMessage.schoolRecipient === "both";
    if (user.role === "cashier") return linkedMessage.schoolRecipient === "cashier" || linkedMessage.schoolRecipient === "both";
    if (user.role === "discipline_director") return linkedMessage.schoolRecipient === "discipline";
    return true;
  };

  return {
    students,
    parents:
      user.role === "parent"
        ? data.parents.filter((parent) => parent.id === user.parentId && parent.schoolId === schoolId)
        : data.parents.filter(
            (parent) =>
              parent.schoolId === schoolId &&
              (parent.schoolYearId === schoolYearId || parentIds.has(parent.id) || parent.studentIds.some((studentId) => studentIds.includes(studentId))),
          ),
    users: data.users.filter((item) => item.schoolId === schoolId),
    feeTypes: data.feeTypes.filter((fee) => fee.schoolId === schoolId && fee.schoolYearId === schoolYearId),
    payments: data.payments.filter((payment) => payment.schoolId === schoolId && payment.schoolYearId === schoolYearId && studentIds.includes(payment.studentId)),
    expenses: data.expenses.filter((expense) => expense.schoolId === schoolId && expense.schoolYearId === schoolYearId),
    auditLogs: data.auditLogs.filter((log) => log.schoolId === schoolId && log.schoolYearId === schoolYearId && !isSessionAuditAction(log.action)),
    valves: data.valves.filter((publication) => publication.schoolId === schoolId && publication.schoolYearId === schoolYearId),
    disciplineSanctions: data.disciplineSanctions.filter((sanction) => sanction.schoolId === schoolId && sanction.schoolYearId === schoolYearId),
    attendance: data.attendance.filter((record) => record.schoolId === schoolId && record.schoolYearId === schoolYearId),
    attendanceSettings: data.attendanceSettings.filter((settings) => settings.schoolId === schoolId && settings.schoolYearId === schoolYearId),
    messages: data.messages.filter((message) => {
      const sameScope = message.schoolId === schoolId && message.schoolYearId === schoolYearId;
      if (!sameScope) return false;
      if (user.role !== "parent") return true;
      return message.threadParentId === user.parentId || message.recipientParentId === user.parentId || message.recipientParentId === "all";
    }),
    notifications:
      user.role === "parent"
        ? data.notifications.filter(
            (notification) =>
              notification.schoolId === schoolId &&
              notification.schoolYearId === schoolYearId &&
              notification.parentId === user.parentId,
          )
        : data.notifications.filter(
            (notification) =>
              notification.schoolId === schoolId &&
              notification.schoolYearId === schoolYearId &&
              canShowSchoolNotification(notification),
          ),
  };
}

function LoginScreen({
  onLogin,
  initialError,
  platformLogoUrl,
}: {
  onLogin: (email: string, password: string) => Promise<void>;
  initialError?: string;
  platformLogoUrl: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const previousContent = viewport.content;
    viewport.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no";
    return () => {
      viewport.content = previousContent;
    };
  }, []);

  useEffect(() => {
    setError(initialError ?? "");
  }, [initialError]);

  function formatLoginError(loginError: unknown) {
    const message = loginError instanceof Error ? loginError.message : String(loginError);
    if (message.includes("auth/invalid-credential") || message.includes("auth/user-not-found") || message.includes("auth/wrong-password")) {
      return "Email ou mot de passe incorrect.";
    }
    if (message.includes("auth/too-many-requests")) {
      return "Trop de tentatives de connexion. Réessayez plus tard.";
    }
    if (message.includes("auth/network-request-failed")) {
      return "Connexion impossible. Vérifiez votre connexion internet.";
    }
    return "Email ou mot de passe incorrect.";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(formatLoginError(loginError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex h-dvh w-full flex-col items-center justify-center overflow-hidden bg-[#F5F7FB] px-3 py-2 sm:px-6 sm:py-4">
      <EnvironmentBanner />
      <style>{`
        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <section className="w-full max-w-[460px] overflow-hidden rounded-[22px] border border-white/80 bg-white p-3 shadow-[0_24px_80px_rgba(15,23,42,0.10)] [animation:loginCardIn_520ms_ease-out] sm:rounded-[24px] sm:p-6">
        <PlatformLogoSlot logoUrl={platformLogoUrl} />

        <div className="mt-5 text-center sm:mt-7">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Connexion</h2>
          <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Accédez à votre espace sécurisé</p>
        </div>

        <form onSubmit={submit} className="mt-4 grid min-w-0 gap-3 sm:mt-6 sm:gap-4">
          <label className="group grid gap-2 text-sm font-semibold text-slate-700">
            Email
            <span className="flex h-12 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:h-14 sm:px-4">
              <Mail className="h-5 w-5 shrink-0 text-slate-400 transition group-focus-within:text-blue-600" />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-400"
                placeholder="email@ecole.com"
              />
            </span>
          </label>

          <label className="group grid gap-2 text-sm font-semibold text-slate-700">
            Mot de passe
            <span className="flex h-12 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:h-14 sm:px-4">
              <Lock className="h-5 w-5 shrink-0 text-slate-400 transition group-focus-within:text-blue-600" />
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                required
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-slate-400"
                placeholder="Votre mot de passe"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-ink"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>

          {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}

          <button
            disabled={loading}
            className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white shadow-[0_16px_34px_rgba(20,33,61,0.22)] transition duration-200 hover:bg-[#0f1a30] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:h-14"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 sm:mt-5">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>
      </section>
    </main>
  );
}
function YearScreen({
  user,
  years,
  activeYearId,
  onSelect,
  onLogout,
  onCreate,
}: {
  user: AppUser;
  years: SchoolYear[];
  activeYearId: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
  onCreate: (year: SchoolYear) => void;
}) {
  const [name, setName] = useState("2026-2027");
  const canEdit = user.role === "school_admin";

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4">
      <EnvironmentBanner />
      <section className="mx-auto max-w-4xl py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-mint">Acadéa</p>
            <h1 className="text-3xl font-bold text-ink">Sélection de l'année scolaire</h1>
          </div>
          <button onClick={onLogout} className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {years.map((year) => (
            <button key={year.id} onClick={() => onSelect(year.id)} className="rounded border border-slate-200 bg-white p-5 text-left shadow-sm hover:border-mint">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-ink">{year.name}</h2>
                {year.id === activeYearId && <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">Active</span>}
              </div>
              <p className="mt-2 text-sm text-slate-500">{year.startsAt} au {year.endsAt}</p>
              <p className="mt-4 text-sm font-medium capitalize text-slate-700">{year.status}</p>
            </button>
          ))}
        </div>
        {canEdit && (
          <div className="mt-5 flex flex-col gap-2 rounded border border-slate-200 bg-white p-4 sm:flex-row">
            <input value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-2" />
            <button
              onClick={() =>
                onCreate({
                  id: uid("year"),
                  schoolId: user.schoolId ?? "",
                  name,
                  startsAt: `${name.slice(0, 4)}-09-01`,
                  endsAt: `${name.slice(5)}-07-15`,
                  status: "draft",
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded bg-ink px-4 py-2 font-semibold text-white"
            >
              <Plus className="h-4 w-4" /> Créer
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function Header({
  user,
  data,
  yearData,
  school,
  year,
  unreadNotifications,
  notificationsOpen,
  isRefreshing,
  refreshError,
  onRefresh,
  onToggleNotifications,
  onCloseNotifications,
  onRealtimeNotifications,
  onRealtimeMessages,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  unreadNotifications: number;
  notificationsOpen: boolean;
  isRefreshing?: boolean;
  refreshError?: string;
  onRefresh: () => void;
  onToggleNotifications: () => void;
  onCloseNotifications?: () => void;
  onRealtimeNotifications?: (notifications: AppNotification[]) => void;
  onRealtimeMessages?: (messages: Message[]) => void;
}) {
  const schoolLogoUrl = school.logoUrl?.trim();
  const userDisplayName = user.name.trim();
  const schoolMotto = school.motto?.trim();
  const refreshStatus = isRefreshing ? "Actualisation..." : refreshError;
  const notificationHistory = usePaginatedNotifications({
    user,
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: notificationsOpen,
    messages: data.messages,
  });
  const realtimeMessages = useRealtimeMessageFeed({
    user,
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: notificationsOpen,
  });
  const realtimeHandlersRef = useRef({ onRealtimeNotifications, onRealtimeMessages });
  useEffect(() => {
    realtimeHandlersRef.current = { onRealtimeNotifications, onRealtimeMessages };
  }, [onRealtimeMessages, onRealtimeNotifications]);
  const pushedRealtimeSignatureRef = useRef("");
  const realtimeSignature = useMemo(() => {
    const notificationSignature = notificationHistory.items
      .map((notification) => `${notification.id}:${notification.read ? "1" : "0"}:${notification.createdAt ?? ""}`)
      .join("|");
    const messageSignature = realtimeMessages.messages
      .map((message) => `${message.id}:${message.createdAt ?? ""}`)
      .join("|");
    return `${notificationSignature}::${messageSignature}`;
  }, [notificationHistory.items, realtimeMessages.messages]);

  useEffect(() => {
    if (!realtimeSignature || pushedRealtimeSignatureRef.current === realtimeSignature) return;
    pushedRealtimeSignatureRef.current = realtimeSignature;
    realtimeHandlersRef.current.onRealtimeNotifications?.(notificationHistory.items);
    realtimeHandlersRef.current.onRealtimeMessages?.(realtimeMessages.messages);
  }, [notificationHistory.items, realtimeMessages.messages, realtimeSignature]);
  const displayedUnreadNotifications = user.role === "discipline_director" ? (notificationHistory.unreadCount ?? 0) : (notificationHistory.unreadCount ?? unreadNotifications);
  const markPaginatedNotificationsRead = notificationHistory.markAllRead;

  useEffect(() => {
    if (user.role !== "discipline_director" && notificationsOpen && unreadNotifications === 0 && notificationHistory.unreadCount === 0) {
      markPaginatedNotificationsRead();
    }
  }, [markPaginatedNotificationsRead, notificationHistory.unreadCount, notificationsOpen, unreadNotifications, user.role]);

  const notificationPagination = (
    <div className="grid gap-2">
      <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
        Notifications chargées par pages de 30 éléments, du plus récent au plus ancien.
      </p>
      {notificationHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement des notifications...</p>}
      {notificationHistory.loadError && (
        <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">{notificationHistory.loadError}</p>
          <button onClick={() => void notificationHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
        </div>
      )}
      {realtimeMessages.error && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-700">{realtimeMessages.error}</p>}
      {notificationHistory.hasMore && (
        <button
          onClick={() => void notificationHistory.loadMore()}
          disabled={notificationHistory.isLoadingMore}
          className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
        >
          {notificationHistory.isLoadingMore ? "Chargement..." : "Charger plus de notifications"}
        </button>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-ink font-bold text-white">
              {schoolLogoUrl ? <img src={schoolLogoUrl} alt="" className="h-full w-full object-cover" /> : "A"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{userDisplayName ? `Bonjour, ${userDisplayName}` : "Bonjour !"}</p>
              <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{school.name}</p>
              {schoolMotto && <p className="truncate text-xs italic text-slate-500">{schoolMotto}</p>}
              <div className="mt-1 flex max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium leading-4 text-slate-500">
                {school.address && <span className="max-w-full truncate">{school.address}</span>}
                {school.phone && <span className="shrink-0">{school.phone}</span>}
                {school.email && <span className="max-w-full break-all">{school.email}</span>}
              </div>
            </div>
          </div>
          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center justify-end gap-3">
            <span className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Année scolaire : {year.name}</span>
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              title="Actualiser"
              aria-label="Actualiser"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            {refreshStatus && (
              <span className={`text-xs font-semibold ${refreshError ? "text-red-600" : "text-slate-500"}`}>
                {refreshStatus}
              </span>
            )}
            <button onClick={onToggleNotifications} className="relative inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink" title="Boîte à Messagerie" aria-label="Boîte à Messagerie">
              <Bell className="h-4 w-4" />
              {displayedUnreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">
                  {displayedUnreadNotifications}
                </span>
              )}
            </button>
            </div>
          </div>
        </div>
      </div>
      {notificationsOpen && (
        <AdminDrawer title="Boîte à Messagerie" onClose={onCloseNotifications ?? onToggleNotifications} closeLabel="Fermer la boîte à messagerie" notificationPanel>
          <MessageDrawerContent
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            notifications={notificationHistory.items}
            realtimeMessages={realtimeMessages.messages}
            notificationPagination={notificationPagination}
            roleLabels={roleLabels}
          />
        </AdminDrawer>
      )}
    </header>
  );
}

function BottomNavigation({
  user,
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  user: AppUser;
  activeTab: Tab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: Tab) => void;
}) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "students", label: "Élèves", icon: GraduationCap },
    { id: "control", label: "Contrôle", icon: Banknote },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ].filter((tab) => (user.role === "cashier" ? ["dashboard", "control", "messages", "menu"].includes(tab.id) : true)) as { id: Tab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
      <div className={user.role === "cashier" ? `mx-auto grid w-full max-w-lg ${showInstallButton ? "grid-cols-5" : "grid-cols-4"} gap-1` : `mx-auto grid max-w-4xl ${showInstallButton ? "grid-cols-6" : "grid-cols-5"} gap-1`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTab(tab.id)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-0.5 py-2 text-[10px] font-semibold transition min-[360px]:text-[11px] sm:px-1 sm:text-xs ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-700" : "text-slate-400"}`} />
              <span className="max-w-full truncate">{tab.label}</span>
            </button>
          );
        })}
        {showInstallButton && <InstallPwaNavButton onInstall={onInstallPwa} />}
      </div>
    </nav>
  );
}

type TransactionPeriod = "today" | "last5" | "week";
type TransactionChartItem = {
  id: string;
  kind: "payment" | "expense";
  type: string;
  label: string;
  amount: number;
  date: string;
  occurredAt?: string;
  status?: string;
  studentName?: string;
  className?: string;
  feeName?: string;
  agentName?: string;
};
type TransactionChartRow = { date: string; label: string; payments: number; expenses: number; transactions: TransactionChartItem[] };
const transactionAxisStep = 1500;

const transactionPeriodLabels: Record<TransactionPeriod, string> = {
  today: "Aujourd'hui",
  last5: "5 derniers jours",
  week: "Semaine en cours",
};

function toDateKey(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getTransactionPeriodDates(period: TransactionPeriod, now = new Date()) {
  if (period === "today") return [toDateKey(now)];
  if (period === "last5") {
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (4 - index));
      return toDateKey(date);
    });
  }
  const monday = new Date(now);
  const day = monday.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  monday.setDate(now.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toDateKey(date);
  });
}

function formatChartDate(dateKey: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit" }).format(new Date(`${dateKey}T12:00:00`));
}

function formatChartTooltipDate(dateKey: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
}

function formatAxisAmount(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function getChartMaxAmount(rows: TransactionChartRow[]) {
  const maxAmount = Math.max(1, ...rows.map((row) => Math.max(row.payments, row.expenses)));
  return Math.max(transactionAxisStep, Math.ceil(maxAmount / transactionAxisStep) * transactionAxisStep);
}

function TransactionComboChart({
  rows,
  period,
  onPeriodChange,
}: {
  rows: TransactionChartRow[];
  period: TransactionPeriod;
  onPeriodChange: (period: TransactionPeriod) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const chartWidth = Math.max(560, rows.length * 96);
  const chartHeight = 180;
  const margin = { top: 16, right: 24, bottom: 34, left: 54 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const chartMax = getChartMaxAmount(rows);
  const baseline = margin.top + plotHeight;
  const groupWidth = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barWidth = Math.min(18, groupWidth * 0.22);
  const barGap = 6;
  const yFor = (value: number) => baseline - (value / chartMax) * plotHeight;
  const paymentPoints = rows.map((row, index) => {
    const centerX = margin.left + groupWidth * index + groupWidth / 2;
    return { x: centerX - barWidth / 2 - barGap / 2, y: yFor(row.payments) };
  });
  const expensePoints = rows.map((row, index) => {
    const centerX = margin.left + groupWidth * index + groupWidth / 2;
    return { x: centerX + barWidth / 2 + barGap / 2, y: yFor(row.expenses) };
  });
  const pathFromPoints = (points: { x: number; y: number }[]) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const ticks = Array.from({ length: chartMax / transactionAxisStep + 1 }, (_, index) => index * transactionAxisStep);
  const selectedRow = selectedDate ? rows.find((row) => row.date === selectedDate) : null;
  const selectedTransactions = selectedRow ? [...selectedRow.transactions].sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date)) : [];

  function formatTransactionDateTime(value?: string) {
    if (!value) return "-";
    const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  return (
    <section className="min-w-0 max-w-full rounded border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-ink">Mouvement des transactions par jour</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-mint" /> Paiements</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Dépenses</span>
          </div>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600">
          {(Object.keys(transactionPeriodLabels) as TransactionPeriod[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setSelectedDate(null);
                onPeriodChange(item);
              }}
              className={`px-2 py-2 transition ${period === item ? "bg-ink text-white" : "hover:bg-slate-50"}`}
            >
              {transactionPeriodLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 max-w-full overflow-hidden pb-1 sm:overflow-x-auto">
        <svg
          className="block h-auto w-full max-w-full sm:min-w-[var(--transaction-chart-width)]"
          style={{ "--transaction-chart-width": `${chartWidth}px` } as CSSProperties}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Mouvement des paiements et dépenses par jour"
        >
          <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="10" fill="white" />
          {ticks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={margin.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold">
                  {formatAxisAmount(tick)}
                </text>
              </g>
            );
          })}
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={baseline} stroke="#cbd5e1" strokeWidth="1" />
          <line x1={margin.left} x2={chartWidth - margin.right} y1={baseline} y2={baseline} stroke="#cbd5e1" strokeWidth="1" />
          {rows.map((row, index) => {
            const centerX = margin.left + groupWidth * index + groupWidth / 2;
            const paymentX = centerX - barWidth - barGap / 2;
            const expenseX = centerX + barGap / 2;
            const paymentY = yFor(row.payments);
            const expenseY = yFor(row.expenses);
            const paymentHeight = Math.max(0, baseline - paymentY);
            const expenseHeight = Math.max(0, baseline - expenseY);
            return (
              <g
                key={row.date}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none"
                onClick={() => setSelectedDate(row.date)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDate(row.date);
                  }
                }}
                aria-label={`Afficher les transactions du ${formatChartTooltipDate(row.date)}`}
              >
                <title>{`${formatChartTooltipDate(row.date)}\nPaiements : ${money(row.payments)}\nDépenses : ${money(row.expenses)}\nTotal : ${money(row.payments + row.expenses)}`}</title>
                <rect x={paymentX} y={paymentY} width={barWidth} height={paymentHeight} rx="5" fill="#2a9d8f" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.45s" begin={`${index * 0.04}s`} fill="freeze" />
                </rect>
                <rect x={expenseX} y={expenseY} width={barWidth} height={expenseHeight} rx="5" fill="#dc2626" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.45s" begin={`${index * 0.04 + 0.04}s`} fill="freeze" />
                </rect>
                <text x={centerX} y={chartHeight - 13} textAnchor="middle" className="fill-slate-600 text-[11px] font-semibold">
                  {row.label}
                </text>
              </g>
            );
          })}
          <path d={pathFromPoints(paymentPoints)} fill="none" stroke="#2a9d8f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.35s" begin="0.2s" fill="freeze" />
          </path>
          <path d={pathFromPoints(expensePoints)} fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.35s" begin="0.25s" fill="freeze" />
          </path>
          {paymentPoints.map((point, index) => (
            <circle key={`payment-${rows[index].date}`} cx={point.x} cy={point.y} r="4.5" fill="white" stroke="#2a9d8f" strokeWidth="3">
              <title>{`${formatChartTooltipDate(rows[index].date)}\nPaiements : ${money(rows[index].payments)}`}</title>
            </circle>
          ))}
          {expensePoints.map((point, index) => (
            <circle key={`expense-${rows[index].date}`} cx={point.x} cy={point.y} r="4.5" fill="white" stroke="#dc2626" strokeWidth="3">
              <title>{`${formatChartTooltipDate(rows[index].date)}\nDépenses : ${money(rows[index].expenses)}`}</title>
            </circle>
          ))}
          {rows.map((row, index) => {
            const centerX = margin.left + groupWidth * index + groupWidth / 2;
            const hitWidth = Math.max(barWidth * 2 + barGap + 16, Math.min(groupWidth - 4, 54));
            const hitX = centerX - hitWidth / 2;
            return (
              <rect
                key={`hit-${row.date}`}
                x={hitX}
                y={margin.top}
                width={hitWidth}
                height={plotHeight}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => setSelectedDate(row.date)}
                onTouchStart={() => setSelectedDate(row.date)}
                aria-label={`Afficher les transactions du ${formatChartTooltipDate(row.date)}`}
              >
                <title>{`${formatChartTooltipDate(row.date)}\nPaiements : ${money(row.payments)}\nDépenses : ${money(row.expenses)}\nTotal : ${money(row.payments + row.expenses)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      {selectedRow && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="grid max-h-[min(520px,calc(100vh-3rem))] w-full max-w-xl min-w-0 animate-[fadeIn_0.18s_ease-out] grid-rows-[auto_auto_minmax(0,1fr)] rounded border border-slate-200 bg-white p-4 text-sm shadow-2xl">
            <div className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="break-words font-bold text-ink">{formatChartTooltipDate(selectedRow.date)}</p>
                <p className="text-xs text-slate-500">{selectedTransactions.length} transaction(s)</p>
              </div>
              <button onClick={() => setSelectedDate(null)} type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink" aria-label="Fermer le détail des transactions">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="my-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2">
              <span className="rounded bg-mint/10 px-3 py-2">Encaissé : <strong className="text-mint">{money(selectedRow.payments)}</strong></span>
              <span className="rounded bg-red-50 px-3 py-2">Dépenses : <strong className="text-red-600">{money(selectedRow.expenses)}</strong></span>
            </div>
            <div className="min-h-0 max-h-56 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              {selectedTransactions.length > 0 ? (
                selectedTransactions.map((transaction) => (
                  <div key={transaction.id} className="grid min-w-0 gap-2 rounded bg-slate-50 px-3 py-2">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-semibold ${transaction.kind === "payment" ? "text-mint" : "text-red-600"}`}>{transaction.type}</p>
                        <p className="break-words text-xs text-slate-700">{transaction.label || "Sans libellé"}</p>
                      </div>
                      <span className={transaction.kind === "payment" ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>
                        {(transaction.kind === "payment" ? "+" : "-") + "$" + Math.abs(transaction.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="grid gap-1 text-[11px] font-semibold text-slate-500">
                      {transaction.kind === "payment" ? (
                        <>
                          <span>Élève : {transaction.studentName ?? "Élève non renseigné"}</span>
                          <span>Classe : {transaction.className ?? "—"} · Frais : {transaction.feeName ?? "—"}</span>
                        </>
                      ) : (
                        <>
                          <span>Dépense : {transaction.label || "Sans motif"}</span>
                          <span>Agent : {transaction.agentName ?? "—"}</span>
                        </>
                      )}
                      <span>Date et heure : {formatTransactionDateTime(transaction.occurredAt ?? transaction.date)}</span>
                      {transaction.status && <span>Statut : {transaction.status}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">Aucune transaction enregistrée pour ce jour.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function DisciplineBottomNavigation({
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  activeTab: DisciplineTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: DisciplineTab) => void;
}) {
  const tabs = [
    { id: "status", label: "Statut", icon: CheckCircle2 },
    { id: "attendance", label: "Présence", icon: CalendarDays },
    { id: "messages", label: "Messages", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] satisfies { id: DisciplineTab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
      <div className={`mx-auto grid w-full max-w-2xl ${showInstallButton ? "grid-cols-5" : "grid-cols-4"} gap-1`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTab(tab.id)}
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
  );
}

function Dashboard({ data, school, year }: { data: ReturnType<typeof scopeData>; school: School; year: SchoolYear }) {
  const today = new Date().toISOString().slice(0, 10);
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [transactionPeriod, setTransactionPeriod] = useState<TransactionPeriod>("last5");
  const dashboardClassChoices = useMemo(() => getSchoolClassChoices(school), [school]);
  const dashboardSectionChoices = useMemo(
    () =>
      getSchoolEducationLevels(school)
        .map((level) => (level === "Maternelle" ? "maternelle" : level === "Primaire" ? "primaire" : level === "Secondaire" ? "secondaire" : ""))
        .filter(Boolean) as SchoolSection[],
    [school],
  );
  useEffect(() => {
    if (sectionFilter !== "all" && !dashboardSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [dashboardSectionChoices, sectionFilter]);
  const yearIndexes = useMemo(() => buildSchoolYearDataIndexes(data.students, data.feeTypes, data.payments), [data.students, data.feeTypes, data.payments]);
  const activeStudents = useMemo(() => data.students.filter((student) => (student.status ?? "ACTIVE") === "ACTIVE"), [data.students]);
  const filteredStudents = useMemo(() => activeStudents.filter((student) => sectionFilter === "all" || getClassSection(student.className) === sectionFilter), [activeStudents, sectionFilter]);
  const filteredStudentIds = useMemo(() => new Set(filteredStudents.map((student) => student.id)), [filteredStudents]);
  const filteredParents = useMemo(() => {
    const filteredParentIds = new Set(filteredStudents.map((student) => student.parentId).filter(Boolean));
    return data.parents.filter((parent) => filteredParentIds.has(parent.id) || parent.studentIds.some((studentId) => filteredStudentIds.has(studentId)));
  }, [data.parents, filteredStudentIds, filteredStudents]);
  const filteredPayments = useMemo(
    () =>
      data.payments.filter((payment) => {
        const normalized = payment.paidAt.slice(0, 10);
        return filteredStudentIds.has(payment.studentId) && (!startDate || normalized >= startDate) && (!endDate || normalized <= endDate);
      }),
    [data.payments, endDate, filteredStudentIds, startDate],
  );
  const filteredExpenses = useMemo(
    () =>
      data.expenses.filter((expense) => {
        const normalized = expense.spentAt.slice(0, 10);
        return sectionFilter === "all" && (!startDate || normalized >= startDate) && (!endDate || normalized <= endDate);
      }),
    [data.expenses, endDate, sectionFilter, startDate],
  );
  const filteredPaymentIndexes = useMemo(() => buildSchoolYearDataIndexes(filteredStudents, data.feeTypes, filteredPayments), [filteredStudents, data.feeTypes, filteredPayments]);
  const stats = useMemo(() => buildStats(filteredStudents, filteredParents, data.feeTypes, filteredPayments), [data.feeTypes, filteredParents, filteredPayments, filteredStudents]);
  const dashboardFinancialAggregates = useMemo(
    () => buildDashboardFinancialAggregates(filteredStudents, data.feeTypes, filteredPayments, filteredPaymentIndexes),
    [data.feeTypes, filteredPaymentIndexes, filteredPayments, filteredStudents],
  );
  const dashboardFinancialStats = dashboardFinancialAggregates.financialStats;
  const annualFinancialAggregates = useMemo(
    () => buildDashboardFinancialAggregates(filteredStudents, data.feeTypes, data.payments, yearIndexes),
    [data.feeTypes, data.payments, filteredStudents, yearIndexes],
  );
  const annualFinancialStats = annualFinancialAggregates.financialStats;
  const annualFinancialPaid = annualFinancialStats.paid;
  const annualFinancialExpenses = useMemo(() => data.expenses.reduce((sum, expense) => sum + expense.amount, 0), [data.expenses]);
  const annualFinancialRemaining = annualFinancialStats.remaining;
  const annualFinancialRecoveryRate = annualFinancialStats.expected > 0 ? Math.round((annualFinancialPaid / annualFinancialStats.expected) * 100) : 0;
  const totalPayments = dashboardFinancialStats.paid;
  const totalExpenses = useMemo(() => filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0), [filteredExpenses]);
  const remaining = dashboardFinancialStats.remaining;
  const recoveryRate = dashboardFinancialStats.expected > 0 ? Math.round((totalPayments / dashboardFinancialStats.expected) * 100) : 0;
  const recoveryTone = annualFinancialRecoveryRate >= 80 ? "text-mint bg-mint/10" : annualFinancialRecoveryRate >= 50 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-50";
  const feeProgressRows = annualFinancialAggregates.feeProgressRows;
  const totalActiveStudents = useMemo(() => data.students.filter((student) => student.schoolId === school.id && student.schoolYearId === year.id && !isArchivedStudent(student)).length, [data.students, school.id, year.id]);
  const totalUniqueParents = useMemo(() => new Set(data.parents.filter((parent) => parent.schoolId === school.id).map((parent) => parent.id)).size, [data.parents, school.id]);
  const admins = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "school_admin").length, [data.users, school.id]);
  const cashiers = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "cashier").length, [data.users, school.id]);
  const disciplineDirectors = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "discipline_director").length, [data.users, school.id]);
  const classRows = useMemo(
    () =>
      dashboardClassChoices.map((className) => {
        const students = filteredStudents.filter((student) => student.className === className);
        return {
          className,
          girls: students.filter((student) => student.sexe === "F").length,
          boys: students.filter((student) => student.sexe === "M").length,
          total: students.length,
        };
      }).filter((row) => row.total > 0),
    [dashboardClassChoices, filteredStudents],
  );
  const classDisplayRows = useMemo(
    () =>
      Array.from(
        filteredStudents.reduce<Map<string, { className: string; classOrder: number; optionLabel: string; girls: number; boys: number; total: number }>>((items, student) => {
          const isSecondary = getClassSection(student.className) === "secondaire";
          const className = isSecondary ? formatStudentClassName(student) : student.className;
          const current = items.get(className) ?? {
            className,
            classOrder: CLASSES.indexOf(student.className),
            optionLabel: isSecondary ? student.option?.trim() ?? "" : "",
            girls: 0,
            boys: 0,
            total: 0,
          };
          items.set(className, {
            ...current,
            girls: current.girls + (student.sexe === "F" ? 1 : 0),
            boys: current.boys + (student.sexe === "M" ? 1 : 0),
            total: current.total + 1,
          });
          return items;
        }, new Map()).values(),
      ).sort((a, b) => {
        const classOrder = a.classOrder - b.classOrder;
        if (classOrder !== 0) return classOrder;
        return a.optionLabel.localeCompare(b.optionLabel, "fr");
      }),
    [filteredStudents],
  );
  const totalGirls = useMemo(() => classRows.reduce((sum, row) => sum + row.girls, 0), [classRows]);
  const totalBoys = useMemo(() => classRows.reduce((sum, row) => sum + row.boys, 0), [classRows]);
  const totalStudents = totalGirls + totalBoys;
  const studentsById = yearIndexes.studentsById;
  const feeTypesById = yearIndexes.feeTypesById;
  const transactions = useMemo(
    () =>
      [
        ...filteredPayments.map((payment) => ({ id: payment.id, type: "Paiement", label: payment.cashierName, amount: payment.amount, date: payment.paidAt, occurredAt: payment.createdAt ?? payment.paidAt })),
        ...filteredExpenses.map((expense) => ({ id: expense.id, type: "D\u00e9pense", label: expense.category, amount: -expense.amount, date: expense.spentAt, occurredAt: expense.createdAt ?? expense.spentAt })),
      ].sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date)),
    [filteredExpenses, filteredPayments],
  );
  const chartDates = useMemo(() => getTransactionPeriodDates(transactionPeriod), [transactionPeriod]);
  const transactionDayRows = useMemo(
    () =>
      buildDashboardTransactionDayRows({
        dates: chartDates,
        payments: data.payments,
        expenses: data.expenses,
        studentIds: filteredStudentIds,
        includeExpenses: sectionFilter === "all",
      }),
    [chartDates, data.expenses, data.payments, filteredStudentIds, sectionFilter],
  );
  const transactionChartRows = useMemo(
    () =>
      transactionDayRows.map((row) => ({
        date: row.date,
        label: formatChartDate(row.date),
        payments: row.payments,
        expenses: row.expenses,
        transactions: [
          ...row.paymentsForDate.map((payment): TransactionChartItem => {
            const student = studentsById.get(payment.studentId);
            const fee = feeTypesById.get(payment.feeTypeId);
            return {
              id: payment.id,
              kind: "payment",
              type: "Paiement",
              label: student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : "Élève non renseigné",
              amount: payment.amount,
              date: payment.paidAt,
              occurredAt: payment.createdAt ?? payment.paidAt,
              status: payment.receiptNumber ? `Reçu ${payment.receiptNumber}` : undefined,
              studentName: student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : undefined,
              className: student ? formatStudentClassName(student) : undefined,
              feeName: fee?.name,
              agentName: payment.cashierName,
            };
          }),
          ...row.expensesForDate.map((expense): TransactionChartItem => ({
            id: expense.id,
            kind: "expense",
            type: "Dépense",
            label: expense.description || expense.category,
            amount: expense.amount,
            date: expense.spentAt,
            occurredAt: expense.createdAt ?? expense.spentAt,
            agentName: expense.cashierName,
          })),
        ],
      })),
    [feeTypesById, studentsById, transactionDayRows],
  );
  const sectionLabel = sectionFilter === "all" ? "Toutes les sections" : sectionFilter.charAt(0).toUpperCase() + sectionFilter.slice(1);
  const dateLabel = (startDate || "D\u00e9but") + " au " + (endDate || "Fin");
  const cards = [
    { label: "Nombre total d'\u00e9l\u00e8ves", value: totalActiveStudents, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre de classes", value: stats.classes, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
    { label: "Nombre total de parents", value: totalUniqueParents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Administrateurs", value: admins, icon: ShieldCheck, tone: "bg-blue-100 text-blue-700" },
    { label: "Caissiers", value: cashiers, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Directeurs de Discipline", value: disciplineDirectors, icon: ShieldCheck, tone: "bg-violet-100 text-violet-700" },
    { label: "Montant attendu", value: "$" + annualFinancialStats.expected.toFixed(2), icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
    { label: "Montant total encaiss\u00e9", value: "$" + annualFinancialPaid.toFixed(2), icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant restant \u00e0 payer", value: "$" + annualFinancialRemaining.toFixed(2), icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
  ];

  function progressBarTone(rate: number) {
    if (rate >= 100) return "bg-emerald-700";
    if (rate >= 80) return "bg-emerald-400";
    if (rate >= 50) return "bg-orange-400";
    return "bg-red-500";
  }

  function exportDashboardPdf() {
    exportDashboardReportPdf({
      school,
      year,
      sectionLabel,
      dateLabel,
      recoveryRate,
      totalPayments,
      totalExpenses,
      expected: stats.expected,
      remaining,
      transactions,
      classRows,
      totalGirls,
      totalBoys,
      totalStudents,
    });
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-slate-500">{"Statistiques limit\u00e9es \u00e0 l'ann\u00e9e scolaire s\u00e9lectionn\u00e9e."}</p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[180px_150px_150px_auto]">
          <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as typeof sectionFilter)} className="input">
            <option value="all">Toutes les sections</option>
            {dashboardSectionChoices.includes("maternelle") && <option value="maternelle">Maternelle</option>}
            {dashboardSectionChoices.includes("primaire") && <option value="primaire">Primaire</option>}
            {dashboardSectionChoices.includes("secondaire") && <option value="secondaire">Secondaire</option>}
          </select>
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" className="input" />
          <input value={endDate} onChange={(event) => setEndDate(event.target.value)} type="date" className="input" />
          <button onClick={exportDashboardPdf} type="button" className="primary-button w-full justify-center sm:w-auto">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-1 break-words text-2xl font-bold text-ink">{card.value}</p>
            </article>
          );
        })}
      </div>

      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-ink">KPI financier</h2>
            <p className="text-sm text-slate-500">{"Recouvrement annuel de l'ann\u00e9e scolaire s\u00e9lectionn\u00e9e."}</p>
          </div>
          <span className={"rounded px-3 py-2 text-sm font-bold " + recoveryTone}>{annualFinancialRecoveryRate}{"% recouvr\u00e9"}</span>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
          <div className={`h-full rounded ${progressBarTone(annualFinancialRecoveryRate)}`} style={{ width: Math.min(100, annualFinancialRecoveryRate) + "%" }} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Metric label={"Encaiss\u00e9"} value={"$" + annualFinancialPaid.toFixed(2)} />
          <Metric label={"D\u00e9penses"} value={"$" + annualFinancialExpenses.toFixed(2)} />
          <Metric label="Attendu" value={"$" + annualFinancialStats.expected.toFixed(2)} />
          <Metric label="Reste" value={"$" + annualFinancialRemaining.toFixed(2)} />
        </div>
        <div className="mt-5 grid gap-3">
          {feeProgressRows.map((row) => (
            <div key={row.name} className="rounded border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-ink">{row.name}</p>
                  <p className="break-words text-xs text-slate-500">Toutes les classes confondues</p>
                </div>
                <span className="shrink-0 rounded bg-white px-2.5 py-1 text-xs font-bold text-mint">{row.rate}%</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded bg-white">
                <div className={`h-full rounded ${progressBarTone(row.rate)}`} style={{ width: Math.min(100, row.rate) + "%" }} />
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <span className="rounded bg-white px-2 py-1 text-slate-600">Attendu : <strong className="text-ink">${row.expected.toFixed(2)}</strong></span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">Payé : <strong className="text-ink">${row.paid.toFixed(2)}</strong></span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">Solde : <strong className="text-ink">${row.remaining.toFixed(2)}</strong></span>
              </div>
            </div>
          ))}
          {feeProgressRows.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun frais applicable pour les filtres sélectionnés.</p>}
        </div>
      </div>

      <FormPanel title="Transactions du jour">
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {transactions.map((transaction) => (
            <div key={transaction.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-slate-50 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{transaction.type}</p>
                <p className="break-words text-xs text-slate-500">{transaction.label} | {transaction.date.slice(0, 10)}</p>
              </div>
              <span className={transaction.amount >= 0 ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>
                {(transaction.amount >= 0 ? "+" : "-") + "$" + Math.abs(transaction.amount).toFixed(2)}
              </span>
            </div>
          ))}
          {transactions.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{"Aucune transaction pour cette p\u00e9riode."}</p>}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <TransactionComboChart rows={transactionChartRows} period={transactionPeriod} onPeriodChange={setTransactionPeriod} />
        </div>
      </FormPanel>

      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-bold text-ink">{"\u00c9l\u00e8ves par classe"}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Classe</th>
                <th className="py-2">Filles</th>
                <th className="py-2">{"Gar\u00e7ons"}</th>
                <th className="py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {classDisplayRows.map((row) => (
                <tr key={row.className} className="border-t border-slate-100">
                  <td className="py-2 font-semibold text-ink">{row.className}</td>
                  <td className="py-2">{row.girls}</td>
                  <td className="py-2">{row.boys}</td>
                  <td className="py-2">{row.total}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-bold text-ink">
                <td className="py-2">Totaux</td>
                <td className="py-2">{totalGirls}</td>
                <td className="py-2">{totalBoys}</td>
                <td className="py-2">{totalStudents}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

async function exportDashboardReportPdf({
  school,
  year,
  sectionLabel,
  dateLabel,
  recoveryRate,
  totalPayments,
  totalExpenses,
  expected,
  remaining,
  transactions,
  classRows,
  totalGirls,
  totalBoys,
  totalStudents,
}: {
  school: School;
  year: SchoolYear;
  sectionLabel: string;
  dateLabel: string;
  recoveryRate: number;
  totalPayments: number;
  totalExpenses: number;
  expected: number;
  remaining: number;
  transactions: { id: string; type: string; label: string; amount: number; date: string }[];
  classRows: { className: SchoolClass; girls: number; boys: number; total: number }[];
  totalGirls: number;
  totalBoys: number;
  totalStudents: number;
}) {
  await renderAcadPdfPreview({
    filename: `dashboard-${year.name}.pdf`,
    title: "Dashboard",
    school,
    year,
    subtitle: `Section : ${sectionLabel} | Tranche de date : ${dateLabel}`,
    sections: [
      pdfSection(
        "KPI financier",
        pdfInfoGrid([
          { label: "Recouvrement", value: `${recoveryRate}%` },
          { label: "Encaissé", value: money(totalPayments) },
          { label: "Dépenses", value: money(totalExpenses) },
          { label: "Attendu", value: money(expected) },
          { label: "Reste", value: money(remaining) },
        ]),
      ),
      pdfSection(
        "Transactions du jour",
        pdfTable(
          [
            { header: "Date", render: (transaction) => transaction.date.slice(0, 10) },
            { header: "Type", render: (transaction) => transaction.type },
            { header: "Libellé", render: (transaction) => transaction.label },
            { header: "Montant", render: (transaction) => money(transaction.amount), align: "right" },
          ],
          transactions,
          "Aucune transaction pour cette période.",
        ),
      ),
      pdfSection(
        "Élèves par classe",
        pdfTable(
          [
            { header: "Classe", render: (row) => row.className },
            { header: "Filles", render: (row) => row.girls, align: "center" },
            { header: "Garçons", render: (row) => row.boys, align: "center" },
            { header: "Total", render: (row) => row.total, align: "center" },
          ],
          classRows,
          "Aucune classe à afficher.",
          {
            footerHtml: `
              <tr>
                <td>Totaux</td>
                <td class="align-center">${totalGirls}</td>
                <td class="align-center">${totalBoys}</td>
                <td class="align-center">${totalStudents}</td>
              </tr>
            `,
          },
        ),
      ),
    ],
  });
}

type ActivityHistoryItem = {
  id: string;
  type: "activity" | "message" | "warning" | "payment" | "expense" | "discipline";
  title: string;
  actorName: string;
  details: string;
  createdAt: string;
};

function ActivityHistoryContent({
  user,
  data,
  yearData,
  role,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  role: "admin" | "cashier" | "parent";
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ActivityHistoryItem["type"]>("all");
  const items = useMemo(() => buildActivityHistoryItems(user, data, yearData, role), [data, role, user, yearData]);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    const text = `${item.title} ${item.actorName} ${item.details}`.toLowerCase();
    return matchesType && (!normalizedQuery || text.includes(normalizedQuery));
  });
  const historyTypeLabels: Record<ActivityHistoryItem["type"], string> = {
    activity: "Activité",
    message: "Message",
    warning: "Avertissement",
    payment: "Paiement",
    expense: "Dépense",
    discipline: "Sanction",
  };

  function historyIconTone(type: ActivityHistoryItem["type"]) {
    if (type === "message") return "bg-blue-50 text-blue-700";
    if (type === "warning") return "bg-amber-100 text-amber-700";
    if (type === "payment") return "bg-mint/10 text-mint";
    if (type === "expense") return "bg-red-50 text-red-700";
    if (type === "discipline") return "bg-purple-50 text-purple-700";
    return "bg-slate-100 text-slate-600";
  }

  function historyIcon(type: ActivityHistoryItem["type"]) {
    if (type === "message") return <MessageSquare className="h-4 w-4" />;
    if (type === "warning") return <Bell className="h-4 w-4" />;
    if (type === "payment") return <Banknote className="h-4 w-4" />;
    if (type === "expense") return <ArrowUpDown className="h-4 w-4" />;
    if (type === "discipline") return <ShieldCheck className="h-4 w-4" />;
    return <Clock3 className="h-4 w-4" />;
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
        <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 outline-none"
            placeholder="Rechercher dans l'historique"
          />
        </label>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="input">
          <option value="all">Tout</option>
          <option value="activity">Activités</option>
          <option value="message">Messages</option>
          {role !== "parent" && <option value="warning">Avertissements</option>}
          {role === "admin" && <option value="payment">Paiements</option>}
          {role === "admin" && <option value="expense">Dépenses</option>}
          {role === "admin" && <option value="discipline">Sanctions</option>}
        </select>
      </div>

      <div className="space-y-2">
        {filteredItems.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucun historique trouvé.</p>
        )}
        {filteredItems.map((item) => (
          <article key={item.id} className="min-w-0 rounded border border-slate-200 bg-white p-3 text-sm">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded ${historyIconTone(item.type)}`}>
                {historyIcon(item.type)}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold text-ink">{item.title}</p>
                  <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                    {historyTypeLabels[item.type]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {item.actorName} · {new Date(item.createdAt).toLocaleString("fr-FR")}
                </p>
                {item.details && <p className="mt-2 break-words leading-6 text-slate-700">{item.details}</p>}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const MAX_VALVE_DOCUMENT_BYTES = 900 * 1024;

type ValveAttachmentDraft = {
  name: string;
  type: string;
  dataUrl?: string;
  url?: string;
  path?: string;
  size: number;
};

function getApproximateValveDocumentSize(publication: ValvePublication) {
  return new TextEncoder().encode(JSON.stringify(publication)).length;
}

function getValvePublicationErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("upload_inactivity_timeout") || normalized.includes("upload_timeout")) {
    return "L'envoi est interrompu faute de progression. Vérifiez votre connexion et réessayez.";
  }
  if (normalized.includes("too large") || normalized.includes("taille") || normalized.includes("quota") || normalized.includes("payload") || normalized.includes("bytes")) {
    return "Le fichier joint est trop volumineux pour être publié.";
  }
  if (normalized.includes("permission") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("denied")) {
    return "Permissions Firebase insuffisantes pour publier cette Valve.";
  }
  if (normalized.includes("network") || normalized.includes("offline") || normalized.includes("unavailable") || normalized.includes("failed to fetch")) {
    return "Erreur réseau pendant la publication. Vérifiez la connexion puis réessayez.";
  }
  if (normalized.includes("storage") || normalized.includes("bucket") || normalized.includes("object")) {
    return "Erreur Storage pendant l'envoi du fichier joint. Veuillez réessayer.";
  }
  if (normalized.includes("firestore") || normalized.includes("document") || normalized.includes("setdoc")) {
    return "Erreur Firestore pendant l'enregistrement de la publication. Veuillez réessayer.";
  }
  return fallback;
}

function getPublicationAttachmentDrafts(publication: ValvePublication): ValveAttachmentDraft[] {
  if (publication.attachments?.length) {
    return publication.attachments.map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      url: attachment.url,
      path: attachment.path,
      size: attachment.size,
    }));
  }

  if (publication.attachmentUrl || publication.attachmentPath) {
    return [
      {
        name: publication.attachmentName ?? "document",
        type: publication.attachmentType ?? "application/octet-stream",
        url: publication.attachmentUrl,
        path: publication.attachmentPath,
        size: publication.attachmentSize ?? 0,
      },
    ];
  }

  if (publication.attachmentDataUrl) {
    return [
      {
        name: publication.attachmentName ?? "document",
        type: publication.attachmentType ?? "application/octet-stream",
        dataUrl: publication.attachmentDataUrl,
        size: publication.attachmentSize ?? 0,
      },
    ];
  }

  return [];
}

function getPublicationDownloadAttachments(publication: ValvePublication) {
  const attachments = publication.attachments?.length
    ? publication.attachments.map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, url: attachment.url }))
    : getPublicationAttachmentDrafts(publication).map((attachment) => ({ name: attachment.name, type: attachment.type, size: attachment.size, url: attachment.url ?? attachment.dataUrl }));
  return attachments.filter((attachment) => Boolean(attachment.url));
}

function getValveAttachmentKey(attachment: Pick<ValveAttachmentDraft, "name" | "size" | "path" | "url">) {
  return `${attachment.path ?? attachment.url ?? ""}|${attachment.name.trim().toLowerCase()}|${attachment.size ?? 0}`;
}

function validateValveAttachmentDrafts(attachments: ValveAttachmentDraft[]) {
  if (attachments.length > MAX_VALVE_ATTACHMENTS) {
    return `Vous pouvez joindre au maximum ${MAX_VALVE_ATTACHMENTS} fichiers par publication.`;
  }
  const totalSize = attachments.reduce((sum, attachment) => sum + (attachment.size ?? 0), 0);
  if (totalSize > MAX_VALVE_ATTACHMENTS_TOTAL_SIZE) {
    return `La taille totale des pièces jointes dépasse ${formatValveAttachmentSize(MAX_VALVE_ATTACHMENTS_TOTAL_SIZE)}.`;
  }
  return validateValveAttachments(attachments.filter((attachment) => attachment.dataUrl));
}

function buildActivityHistoryItems(user: AppUser, data: AppData, yearData: ReturnType<typeof scopeData>, role: "admin" | "cashier" | "parent") {
  const usersById = new Map(data.users.map((item) => [item.id, item]));
  const parentsById = new Map(yearData.parents.map((item) => [item.id, item]));
  const indexes = buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments);
  const auditActionsRepresentedByBusinessData = new Set(["Création paiement", "Création dépense", "Création sanction disciplinaire"]);
  const parseWarningDetails = (details?: string) => {
    if (!details) return null;
    try {
      const parsed = JSON.parse(details) as {
        kind?: string;
        campaignId?: string;
        feeName?: string;
        requiredAmount?: number;
        deadline?: string;
        affectedStudents?: number;
        notifiedParents?: number;
        sentMessages?: number;
        status?: string;
      };
      return parsed.kind === "payment_warning_campaign" ? parsed : null;
    } catch {
      return null;
    }
  };
  const auditItems = yearData.auditLogs
    .filter((log) => {
      if (isSessionAuditAction(log.action)) return false;
      if (role === "admin" && auditActionsRepresentedByBusinessData.has(log.action)) return false;
      const actor = usersById.get(log.actorId);
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails && role === "parent") return false;
      if (role === "admin") return log.actorId === user.id || actor?.role === "cashier";
      if (role === "cashier") return log.actorId === user.id;
      return log.actorId === user.id;
    })
    .map<ActivityHistoryItem>((log) => {
      const warningDetails = parseWarningDetails(log.details);
      if (warningDetails) {
        return {
          id: `audit-${log.id}`,
          type: "warning",
          title: "Campagne d'avertissement paiement",
          actorName: log.actorName,
          details:
            `Frais : ${warningDetails.feeName ?? "-"} · Montant requis : $${Number(warningDetails.requiredAmount ?? 0).toFixed(2)} · Date limite : ${warningDetails.deadline ?? "-"} · Élèves concernés : ${warningDetails.affectedStudents ?? 0} · Parents notifiés : ${warningDetails.notifiedParents ?? 0} · Avertissements envoyés : ${warningDetails.sentMessages ?? 0} · Statut : ${warningDetails.status ?? "Succès"}`,
          createdAt: log.createdAt,
        };
      }
      return {
        id: `audit-${log.id}`,
        type: "activity",
        title: log.action,
        actorName: log.actorName,
        details: log.details ?? "",
        createdAt: log.createdAt,
      };
    });

  const paymentItems =
    role === "admin"
      ? yearData.payments.map<ActivityHistoryItem>((payment) => {
          const student = indexes.studentsById.get(payment.studentId);
          const fee = indexes.feeTypesById.get(payment.feeTypeId);
          const studentName = student ? `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim() : "Élève non renseigné";
          return {
            id: `payment-${payment.id}`,
            type: "payment",
            title: "Paiement",
            actorName: payment.cashierName || "Caissier",
            details:
              `Élève : ${studentName} · Classe : ${student ? formatStudentClassName(student) : "-"} · Frais : ${fee?.name ?? "Frais"} · Montant : ${money(payment.amount)} · Date : ${payment.paidAt} · Heure : ${payment.createdAt ? new Date(payment.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"} · Enregistré par : ${payment.cashierName || "-"} · Référence : ${payment.receiptNumber ?? payment.id}`,
            createdAt: payment.createdAt ?? payment.paidAt,
          };
        })
      : [];

  const expenseItems =
    role === "admin"
      ? yearData.expenses.map<ActivityHistoryItem>((expense) => ({
          id: `expense-${expense.id}`,
          type: "expense",
          title: "Dépense",
          actorName: expense.cashierName || "Caissier",
          details:
            `Motif : ${expense.category} · Description : ${expense.description || "-"} · Montant : ${money(expense.amount)} · Date : ${expense.spentAt} · Heure : ${expense.createdAt ? new Date(expense.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "-"} · Enregistrée par : ${expense.cashierName || "-"} · Référence : ${expense.reference ?? expense.id}`,
          createdAt: expense.createdAt ?? expense.spentAt,
        }))
      : [];

  const disciplineItems =
    role === "admin"
      ? yearData.disciplineSanctions.map<ActivityHistoryItem>((sanction) => ({
          id: `discipline-${sanction.id}`,
          type: "discipline",
          title: "Sanction disciplinaire",
          actorName: sanction.createdByName || "Directeur de Discipline",
          details:
            `Élève : ${sanction.studentName} · Classe : ${sanction.className} · Motif : ${sanction.reason} · Type : ${sanction.sanctionType} · Début : ${sanction.startDate} · Fin prévue : ${sanction.expectedEndDate} · Fin réelle : ${sanction.actualEndDate ?? "-"} · Statut : ${sanction.status === "completed" ? "Purgée" : "Sanction en cours"} · Récidive : ${sanction.recurrenceNumber} · Créée par : ${sanction.createdByName || "-"} · Clôturée par : ${sanction.completedByName ?? "-"}`,
          createdAt: sanction.createdAt ?? sanction.startDate,
        }))
      : [];

  const messageItems = yearData.messages
    .filter((message) => {
      if (role === "admin") return message.recipientParentId === "school";
      if (role === "parent") return message.threadParentId === user.parentId || message.recipientParentId === user.parentId;
      return false;
    })
    .map<ActivityHistoryItem>((message) => {
      const sender = usersById.get(message.senderId);
      const senderParent = sender?.parentId ? parentsById.get(sender.parentId) : message.threadParentId ? parentsById.get(message.threadParentId) : undefined;
      const senderName = sender?.role === "parent" ? senderParent?.fullName ?? sender.name : sender?.name ?? (senderParent?.fullName ?? "École");
      const recipientName =
        message.recipientParentId === "school"
          ? formatSchoolRecipientLabel(message.schoolRecipient)
          : message.recipientParentId === "all"
            ? "Tous les parents"
            : parentsById.get(message.recipientParentId)?.fullName ?? "Parent";
      const isSentByCurrentUser = message.senderId === user.id;
      return {
        id: `message-${message.id}`,
        type: "message",
        title: isSentByCurrentUser ? "Message envoyé" : "Message reçu",
        actorName: senderName,
        details: `Expéditeur : ${senderName} · Destinataire : ${recipientName} · Statut : ${isSentByCurrentUser ? "envoyé" : "reçu"}`,
        createdAt: message.createdAt,
      };
    });

  function itemTimestamp(item: ActivityHistoryItem) {
    const timestamp = new Date(item.createdAt).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  return [...auditItems, ...messageItems, ...paymentItems, ...expenseItems, ...disciplineItems].sort(
    (a, b) => itemTimestamp(b) - itemTimestamp(a) || b.createdAt.localeCompare(a.createdAt),
  );
}

function getPlatformSchoolStats(schoolId: string, data: AppData) {
  const students = data.students.filter((student) => student.schoolId === schoolId).length;
  const parents = data.parents.filter((parent) => parent.schoolId === schoolId).length;
  const admins = data.users.filter((item) => item.role === "school_admin" && item.schoolId === schoolId).length;
  const users = data.users.filter((item) => item.schoolId === schoolId).length;
  return { students, parents, admins, users };
}

function schoolTabLabel(tab: "overview" | "info" | "admins" | "history") {
  const labels = {
    overview: "Overview",
    info: "Informations",
    admins: "Administrateurs",
    history: "Historique",
  };
  return labels[tab];
}

function messageConversationScope(message: Pick<Message, "recipientParentId" | "threadParentId">) {
  if (message.recipientParentId === "all") return "all";
  const parentId = message.threadParentId ?? (message.recipientParentId !== "school" ? message.recipientParentId : undefined);
  return parentId ? `parent:${parentId}` : "school";
}

function targetConversationScope(recipientParentId: Message["recipientParentId"], threadParentId?: string) {
  return messageConversationScope({ recipientParentId, threadParentId });
}

function nextMessageThreadId(messages: Message[], senderId: string, recipientParentId: Message["recipientParentId"], threadParentId?: string, preferredThreadId?: string) {
  const scope = targetConversationScope(recipientParentId, threadParentId);
  const scopedMessages = messages.filter((message) => messageConversationScope(message) === scope);
  const threadGroups = scopedMessages.reduce<Record<string, Message[]>>((groups, message) => {
    const key = message.threadId ?? "legacy";
    return { ...groups, [key]: [...(groups[key] ?? []), message] };
  }, {});
  const selectedMessages = preferredThreadId ? threadGroups[preferredThreadId] ?? [] : [];
  const activeMessages = selectedMessages.length
    ? selectedMessages
    : Object.values(threadGroups).sort((a, b) => {
        const lastA = [...a].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? "";
        const lastB = [...b].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.createdAt ?? "";
        return lastB.localeCompare(lastA);
      })[0] ?? [];
  const lastMessages = [...activeMessages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-2);
  if (lastMessages.length >= 2 && lastMessages.every((message) => message.senderId === senderId)) {
    return uid("thread");
  }
  if (preferredThreadId) return preferredThreadId;
  return activeMessages[0]?.threadId;
}

function AccessDenied({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#f6f8fb] p-4">
      <EnvironmentBanner />
      <section className="w-full max-w-md rounded border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-red-600" />
        <h1 className="text-2xl font-bold text-ink">Accès refusé</h1>
        <p className="mt-2 text-sm text-slate-500">Votre rôle ou votre école ne permet pas d'ouvrir cet espace.</p>
        <button onClick={onLogout} className="primary-button mt-5">
          <LogOut className="h-4 w-4" /> Retour à la connexion
        </button>
      </section>
    </main>
  );
}

function ParentPortal({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onRefresh,
  showInstallButton,
  onInstallPwa,
  onLogout,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onRefresh: () => void;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onLogout: () => void;
}) {
  const [activeParentTab, setActiveParentTab] = useState<ParentTab>("children");
  const [parentAccountOpen, setParentAccountOpen] = useState(false);
  const [parentHistoryOpen, setParentHistoryOpen] = useState(false);
  const [parentValvesOpen, setParentValvesOpen] = useState(false);
  const [parentMessageDrawerOpen, setParentMessageDrawerOpen] = useState(false);
  const [messageRecipient, setMessageRecipient] = useState<"admin" | "cashier" | "both" | "discipline">("admin");
  const [messageSubject, setMessageSubject] = useState("");
  const [messageBody, setMessageBody] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");
  const [selectedParentChildId, setSelectedParentChildId] = useState<string | null>(null);
  const [parentMessageQuota, setParentMessageQuota] = useState<ParentMessageQuota | null>(null);
  const [isParentMessageQuotaLoading, setIsParentMessageQuotaLoading] = useState(false);
  const [isSendingParentMessage, setIsSendingParentMessage] = useState(false);
  const parent = yearData.parents.find((item) => item.id === user.parentId);
  const unread = yearData.notifications.filter((notification) => !notification.read).length;
  const isParentMessageFormComplete = messageSubject.trim().length > 0 && messageBody.trim().length > 0;
  const parentMessageQuotaReached = parentMessageQuota ? parentMessageQuota.messageCount >= parentMessageQuota.limit : false;
  const parentIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const selectedParentChild = yearData.students.find((student) => student.id === selectedParentChildId);
  const recipientLabels = {
    admin: "Administrateur uniquement",
    cashier: "Caissier uniquement",
    both: "Administrateur et Caissier",
    discipline: "Directeur de Discipline",
  } as const;

  function progressBarTone(percent: number) {
    if (percent >= 100) return "bg-mint";
    if (percent >= 75) return "bg-lime-400";
    if (percent >= 50) return "bg-amber-400";
    return "bg-red-500";
  }

  useEffect(() => {
    if (!canUseFirestoreData() || !user.parentId || !year.id) {
      setParentMessageQuota(null);
      return undefined;
    }
    let cancelled = false;
    setIsParentMessageQuotaLoading(true);
    fetchParentMessageQuota(year.id)
      .then((quota) => {
        if (!cancelled) setParentMessageQuota(quota);
      })
      .catch((error) => {
        console.warn("Chargement du quota messages parent impossible.", error);
      })
      .finally(() => {
        if (!cancelled) setIsParentMessageQuotaLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.parentId, year.id]);

  useEffect(() => {
    if (activeParentTab !== "children") {
      setSelectedParentChildId(null);
    }
  }, [activeParentTab]);

  useEffect(() => {
    if (selectedParentChildId && !yearData.students.some((student) => student.id === selectedParentChildId)) {
      setSelectedParentChildId(null);
    }
  }, [selectedParentChildId, yearData.students]);

  useEffect(() => {
    if (messageFeedback !== "Message envoyé avec succès.") return undefined;
    const timer = window.setTimeout(() => setMessageFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [messageFeedback]);

  useEffect(() => {
    if (!parentMessageQuota?.windowExpiresAt || !user.parentId || !year.id) return undefined;
    const expiresAt = new Date(parentMessageQuota.windowExpiresAt).getTime();
    const delay = expiresAt - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
    }, delay + 1000);
    return () => window.clearTimeout(timer);
  }, [parentMessageQuota?.windowExpiresAt, user.parentId, year.id]);

  function markNotificationsRead() {
    updateData(
      {
        notifications: data.notifications.map((notification) =>
          notification.parentId === user.parentId && notification.schoolYearId === year.id ? { ...notification, read: true } : notification,
        ),
      },
      { persist: false },
    );
    void markNotificationsReadTargeted(user, school.id, year.id).catch((error) => {
      console.warn("Marquage ciblé des notifications parent impossible.", error);
    });
    void markConversationUnreadCountRead(user, school.id, year.id).catch((error) => {
      console.warn("Remise à zéro des compteurs de conversation impossible.", error);
    });
  }

  function openParentMessagesDrawer() {
    setParentMessageDrawerOpen(true);
  }

  function closeParentMessagesDrawer() {
    setParentMessageDrawerOpen(false);
    markNotificationsRead();
  }

  function toggleParentMessagesDrawer() {
    if (parentMessageDrawerOpen) {
      closeParentMessagesDrawer();
      return;
    }
    openParentMessagesDrawer();
  }

  async function sendParentMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSendingParentMessage) return;
    setMessageFeedback("");
    const subject = messageSubject.trim();
    const body = messageBody.trim();

    if (!user.parentId) {
      setMessageFeedback("Veuillez renseigner le destinataire, l'objet et le message.");
      return;
    }
    if (!subject) {
      setMessageFeedback("L'objet du message est obligatoire. Veuillez le renseigner avant l'envoi.");
      return;
    }
    if (!body) {
      setMessageFeedback("Veuillez renseigner le contenu du message.");
      return;
    }
    if (parentMessageQuotaReached) {
      setMessageFeedback("Vous avez atteint la limite de 3 messages pour 12 heures.");
      return;
    }

    const recipientLabel = recipientLabels[messageRecipient];
    const createdAt = new Date().toISOString();
    const threadId = nextMessageThreadId(yearData.messages, user.id, "school", user.parentId) ?? uid("thread");
    const message: Message = {
      id: uid("msg"),
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId: "school",
      schoolRecipient: messageRecipient,
      threadParentId: user.parentId,
      threadId,
      subject: `${recipientLabel} - ${subject}`,
      body,
      createdAt,
    };
    const notification: AppNotification = {
      id: uid("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "school",
      schoolRecipient: messageRecipient,
      messageId: message.id,
      type: "message",
      title: `Nouveau message parent - ${recipientLabel}`,
      body: `${parent?.fullName ?? user.name} : ${subject}`,
      createdAt,
      read: false,
    };

    if (canUseFirestoreData()) {
      if (!db) {
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
      setIsSendingParentMessage(true);
      try {
        const result = await sendParentMessageWithQuota({
          schoolYearId: year.id,
          recipient: messageRecipient,
          subject,
          body,
        });

        updateData(
          { messages: [result.message, ...data.messages], notifications: [result.notification, ...data.notifications] },
          { persist: false },
        );
        setParentMessageQuota(result.quota);
      } catch (error) {
        console.warn("Envoi du message parent impossible.", error);
        const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "quota-exceeded") {
          setMessageFeedback("Vous avez atteint la limite de 3 messages pour 12 heures.");
          void fetchParentMessageQuota(year.id).then(setParentMessageQuota).catch(() => undefined);
        } else if (code === "api-unavailable") {
          setMessageFeedback("Service d'envoi indisponible dans cet environnement. Lancez Acadéa avec npx vercel dev.");
        } else if (code === "not-authorized") {
          setMessageFeedback("Votre session ou vos permissions ne permettent pas cet envoi. Reconnectez-vous.");
        } else if (code === "server-error") {
          setMessageFeedback("Une erreur serveur empêche l'envoi. Veuillez réessayer.");
        } else if (code === "network-error") {
          setMessageFeedback("Connexion indisponible. Veuillez réessayer.");
        } else {
          setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        }
        return;
      } finally {
        setIsSendingParentMessage(false);
      }
    } else {
      updateData({ messages: [message, ...data.messages], notifications: [notification, ...data.notifications] });
    }
    setMessageSubject("");
    setMessageBody("");
    setMessageRecipient("admin");
    setMessageFeedback("Message envoyé avec succès.");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBanner />
      <Header
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={year}
        unreadNotifications={unread}
        notificationsOpen={parentMessageDrawerOpen}
        onRefresh={onRefresh}
        onToggleNotifications={toggleParentMessagesDrawer}
        onCloseNotifications={closeParentMessagesDrawer}
        onRealtimeNotifications={(notifications) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        }}
        onRealtimeMessages={(messages) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        }}
      />
      <main className="mx-auto grid w-full max-w-7xl min-w-0 flex-1 gap-4 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {activeParentTab === "children" && !selectedParentChild && (
          <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-ink">Mes enfants</h1>
                <p className="break-words text-sm text-slate-500">Consultation limitée aux élèves rattachés à ce parent.</p>
              </div>
            </div>
          </section>
        )}

        <section className="grid min-w-0 gap-4">
          {activeParentTab === "children" && (
          <div className="grid min-w-0 gap-4">
            {selectedParentChild && (
              <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
                <button
                  onClick={() => setSelectedParentChildId(null)}
                  className="inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                  type="button"
                >
                  <ArrowLeft className="h-4 w-4" /> Retour aux enfants
                </button>
                <div className="mt-4 min-w-0">
                  <h2 className="break-words text-xl font-bold text-ink">
                    {selectedParentChild.nom} {selectedParentChild.postnom} {selectedParentChild.prenom}
                  </h2>
                  <p className="break-words text-sm text-slate-500">Fiche détaillée et historique des paiements.</p>
                </div>
              </section>
            )}
            {(selectedParentChild ? [selectedParentChild] : yearData.students).map((student) => {
              const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, parentIndexes);
              const feeTotals = feeSummaries.reduce(
                (totals, summary) => ({
                  expected: totals.expected + summary.expected,
                  paid: totals.paid + summary.paid,
                  remaining: totals.remaining + summary.remaining,
                }),
                { expected: 0, paid: 0, remaining: 0 },
              );
              const progress = feeTotals.expected > 0 ? Math.min(100, Math.round((feeTotals.paid / feeTotals.expected) * 100)) : 0;
              const progressTone = progressBarTone(progress);
              const payments = [...(parentIndexes.paymentsByStudentId.get(student.id) ?? [])].sort((first, second) => {
                const firstTime = new Date(first.createdAt ?? first.paidAt).getTime();
                const secondTime = new Date(second.createdAt ?? second.paidAt).getTime();
                return (Number.isNaN(secondTime) ? 0 : secondTime) - (Number.isNaN(firstTime) ? 0 : firstTime);
              });
              if (selectedParentChild) {
                return (
                  <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                    <p className="mb-2 text-sm font-semibold text-ink">Historique des paiements</p>
                    <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                      {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
                      {payments.map((payment) => {
                        const fee = parentIndexes.feeTypesById.get(payment.feeTypeId);
                        return (
                          <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <span className="font-semibold text-ink">${payment.amount}</span>
                                <span className="break-words text-slate-500"> | {fee?.name ?? "Frais"} | {payment.paidAt}</span>
                              </div>
                              <button
                                onClick={() => fee && generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))}
                                disabled={!fee}
                                className="inline-flex w-full items-center justify-center gap-2 rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                                title="Télécharger le reçu PDF"
                                type="button"
                              >
                                <Download className="h-4 w-4" /> PDF
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              }
              return (
                <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                  <div className="flex min-w-0 flex-col gap-4 md:flex-row">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-xl font-bold text-ink">
                      {student.photoUrl ? <img src={student.photoUrl} alt="" className="h-full w-full object-cover" /> : student.prenom.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <button
                            onClick={() => setSelectedParentChildId(student.id)}
                            className="break-words text-left text-xl font-bold text-ink transition hover:text-mint"
                            type="button"
                          >
                            {student.nom} {student.postnom} {student.prenom}
                          </button>
                          <p className="break-words text-sm text-slate-500">{formatStudentClassName(student)} | {year.name}</p>
                        </div>
                        <span className="shrink-0 rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">{progress}% payé</span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
                        <div className={`h-full rounded transition-colors ${progressTone}`} style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <Metric label="Total frais" value={money(feeTotals.expected)} />
                        <Metric label="Total payé" value={money(feeTotals.paid)} />
                        <Metric label="Solde" value={money(feeTotals.remaining)} />
                      </div>
                      <div className="mt-4 rounded border border-slate-100 bg-slate-50 p-3">
                        <p className="mb-3 text-sm font-semibold text-ink">Progression par type de frais</p>
                        <div className="grid gap-3">
                          {feeSummaries.length === 0 && <p className="text-sm text-slate-500">Aucun frais défini pour cette classe.</p>}
                          {feeSummaries.map((summary) => {
                            const summaryProgress = summary.expected > 0 ? Math.min(100, Math.round((summary.paid / summary.expected) * 100)) : 0;
                            const summaryProgressTone = progressBarTone(summaryProgress);
                            return (
                              <div key={summary.feeTypeId} className="min-w-0 rounded bg-white p-3 shadow-sm">
                                <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <p className="break-words text-sm font-bold text-ink">{summary.feeName}</p>
                                  <p className="break-words text-xs font-semibold text-slate-500">
                                    {money(summary.paid)} / {money(summary.expected)}
                                  </p>
                                </div>
                                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                                  <div className={`h-full rounded transition-colors ${summaryProgressTone}`} style={{ width: `${summaryProgress}%` }} />
                                </div>
                                <div className="mt-2 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                                  <span>Attendu : <strong>{money(summary.expected)}</strong></span>
                                  <span>Payé : <strong>{money(summary.paid)}</strong></span>
                                  <span>Solde : <strong>{money(summary.remaining)}</strong></span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          )}

          {activeParentTab === "messages" && (
            <FormPanel title="Message">
              <form onSubmit={sendParentMessage} className="grid min-w-0 gap-4">
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Destinataire
                  <select
                    value={messageRecipient}
                    onChange={(event) => setMessageRecipient(event.target.value as "admin" | "cashier" | "both" | "discipline")}
                    className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="admin">Administrateur uniquement</option>
                    <option value="cashier">Caissier uniquement</option>
                    <option value="both">Administrateur et Caissier</option>
                    <option value="discipline">Directeur de Discipline</option>
                  </select>
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Objet
                  <input
                    value={messageSubject}
                    onChange={(event) => setMessageSubject(event.target.value)}
                    className="min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Objet du message"
                  />
                </label>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Message
                  <textarea
                    value={messageBody}
                    onChange={(event) => setMessageBody(event.target.value)}
                    className="min-h-36 min-w-0 rounded border border-slate-200 px-3 py-2 text-sm"
                    placeholder="Rédigez votre message"
                  />
                </label>
                {messageFeedback && (
                  <p
                    className={`rounded px-3 py-2 text-sm font-semibold ${
                      messageFeedback === "Message envoyé avec succès." ? "bg-mint/10 text-mint" : "border border-red-200 bg-red-50 text-red-700"
                    }`}
                  >
                    {messageFeedback}
                  </p>
                )}
                <div className="grid gap-1 rounded bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-semibold">
                    Messages envoyés sur 12 heures : {parentMessageQuota ? parentMessageQuota.messageCount : 0}/3
                    {isParentMessageQuotaLoading ? " · Chargement..." : ""}
                  </p>
                  {parentMessageQuotaReached && (
                    <p className="text-red-600">Vous avez atteint la limite de 3 messages pour 12 heures. L'envoi sera de nouveau possible à la fin de cette période.</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!isParentMessageFormComplete || parentMessageQuotaReached || isSendingParentMessage}
                  className="primary-button transition disabled:cursor-not-allowed disabled:opacity-50 disabled:blur-[0.2px]"
                >
                  <MessageSquare className="h-4 w-4" /> {isSendingParentMessage ? "Envoi..." : "Envoyer"}
                </button>
              </form>
            </FormPanel>
          )}
        </section>

        {activeParentTab === "menu" && (
          <section className="grid min-w-0 gap-4">
            <div className="mt-2 grid gap-3">
              <button
                onClick={() => setParentValvesOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Valves</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Consulter les communiqués et documents publiés par l'école.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setParentAccountOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <UserRound className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Compte parent</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Consulter les informations du compte parent.</p>
                  </div>
                </div>
              </button>
              <button
                onClick={() => setParentHistoryOpen(true)}
                className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint"
                type="button"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-ink">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-ink">Historique</h2>
                    <p className="mt-1 break-words text-sm text-slate-500">Activités et messages liés à ce compte parent.</p>
                  </div>
                </div>
              </button>
              <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </section>
        )}
      </main>

      {parentAccountOpen && (
        <AdminDrawer title="Compte parent" onClose={() => setParentAccountOpen(false)} closeLabel="Fermer le compte parent">
          <div className="rounded border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Parent" value={parent?.fullName ?? user.name} />
              <Metric label="Email" value={user.email} />
              <Metric label="École" value={school.name} />
              <Metric label="Année scolaire" value={year.name} />
              <Metric label="Enfant(s)" value={String(yearData.students.length)} />
              <Metric label="Notification(s)" value={String(unread)} />
            </div>
          </div>
        </AdminDrawer>
      )}
      {parentHistoryOpen && (
        <AdminDrawer title="Historique" onClose={() => setParentHistoryOpen(false)} closeLabel="Fermer l'historique">
          <ActivityHistoryContent user={user} data={data} yearData={yearData} role="parent" />
        </AdminDrawer>
      )}
      {parentValvesOpen && (
        <AdminDrawer title="Valves" onClose={() => setParentValvesOpen(false)} closeLabel="Fermer les valves">
          <ValvesDrawerContent
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={year}
            updateData={updateData}
            canManage={false}
            createId={uid}
            createAuditLog={createAuditLog}
            getPublicationAttachmentDrafts={getPublicationAttachmentDrafts}
            getPublicationDownloadAttachments={getPublicationDownloadAttachments}
            getValveAttachmentKey={getValveAttachmentKey}
            validateValveAttachmentDrafts={validateValveAttachmentDrafts}
            getValvePublicationErrorMessage={getValvePublicationErrorMessage}
            getApproximateValveDocumentSize={getApproximateValveDocumentSize}
            maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES}
          />
        </AdminDrawer>
      )}

      <ParentBottomNavigation
        activeTab={activeParentTab}
        showInstallButton={showInstallButton}
        onInstallPwa={onInstallPwa}
        onTab={(tab) => {
          closeParentMessagesDrawer();
          setActiveParentTab(tab);
        }}
      />
    </div>
  );
}

function disciplineStudentName(student: Student) {
  return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
}

function normalizeDisciplineReason(value: string) {
  return value.trim().toLocaleLowerCase("fr");
}

function disciplineClassName(student: Pick<Student, "className" | "option">) {
  const option = student.option?.trim();
  return option ? `${student.className} ${option}` : student.className;
}

function disciplineSignalBody(sanction: DisciplineSanction) {
  const lines = [
    `Élève : ${sanction.studentName}`,
    `Classe : ${sanction.className}`,
    `Motif : ${sanction.reason || "Non renseigné"}`,
    `Type de sanction : ${sanction.sanctionType || "Non renseigné"}`,
    `Description : ${sanction.description || "Non renseigné"}`,
    `Date de début : ${sanction.startDate}`,
    `Durée : ${sanction.duration} jour(s)`,
    `Date prévue de fin : ${sanction.expectedEndDate}`,
    `Observation : ${sanction.observation || "Non renseigné"}`,
    `Récidive : ${sanction.recurrenceNumber}`,
    `Enregistré par : ${sanction.createdByName}`,
  ];
  return lines.join("\n");
}

function DisciplinePortal({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onRefresh,
  isRefreshing,
  refreshError,
  showInstallButton,
  onInstallPwa,
  onLogout,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  refreshError: string;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onLogout: () => void;
}) {
  const [activeDisciplineTab, setActiveDisciplineTab] = useState<DisciplineTab>("status");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [newSanctionOpen, setNewSanctionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [attendanceSettingsOpen, setAttendanceSettingsOpen] = useState(false);
  const [selectedDisciplineStudentId, setSelectedDisciplineStudentId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const unread = yearData.notifications.filter((notification) => !notification.read).length;
  const stats = useMemo(() => buildDisciplineStats(yearData.disciplineSanctions), [yearData.disciplineSanctions]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  function createDisciplineAudit(action: string, details: string) {
    return createAuditLog(user, school.id, year.id, action, details);
  }

  function findDisciplineSignalParent(student: Student) {
    const parents = yearData.parents.filter(
      (parent) =>
        parent.schoolId === school.id &&
        (parent.id === student.parentId || parent.studentIds.includes(student.id)),
    );
    const dedupedParents = Array.from(new Map(parents.map((parent) => [parent.id, parent])).values());
    if (dedupedParents.length > 1) {
      console.warn("Plusieurs parents liés à l'élève pour le signalement disciplinaire.", {
        studentId: student.id,
        parentIds: dedupedParents.map((parent) => parent.id),
      });
    }
    const directParent = dedupedParents.find((parent) => parent.id === student.parentId);
    return directParent ?? dedupedParents[0];
  }

  async function persistDisciplineAudit(auditLog: AuditLog) {
    await saveDisciplineAuditLog(auditLog);
    return auditLog;
  }

  async function sendDisciplineSignalToParent(sanction: DisciplineSanction, student: Student, persistWithFirestore: boolean) {
    const parent = findDisciplineSignalParent(student);
    if (!parent) {
      const missingParentAudit = createDisciplineAudit("Parent introuvable pour signalement disciplinaire", `${sanction.studentName} - ${sanction.id}`);
      if (!persistWithFirestore) {
        return { status: "missing-parent" as const, auditLog: missingParentAudit };
      }
      try {
        const persistedAudit = await persistDisciplineAudit(missingParentAudit);
        return { status: "missing-parent" as const, auditLog: persistedAudit };
      } catch (error) {
        console.warn("Audit parent introuvable discipline impossible.", error);
        return { status: "missing-parent" as const };
      }
    }

    const createdAt = sanction.createdAt;
    const message: Message = {
      id: `msg-discipline-${sanction.id}`,
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId: parent.id,
      schoolRecipient: "discipline",
      threadParentId: parent.id,
      threadId: nextMessageThreadId(yearData.messages, user.id, parent.id, parent.id) ?? uid("thread"),
      disciplineSanctionId: sanction.id,
      subject: `Signalement disciplinaire — ${sanction.studentName}`,
      body: disciplineSignalBody(sanction),
      createdAt,
    };
    const notification: AppNotification = {
      id: `notif-discipline-${sanction.id}`,
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "parent",
      parentId: parent.id,
      messageId: message.id,
      disciplineSanctionId: sanction.id,
      type: "message",
      title: "Signalement disciplinaire",
      body: `${sanction.studentName} : ${sanction.reason || sanction.sanctionType}`,
      createdAt,
      read: false,
    };
    const alreadyExists = data.messages.some((item) => item.id === message.id || item.disciplineSanctionId === sanction.id) ||
      data.notifications.some((item) => item.id === notification.id || item.disciplineSanctionId === sanction.id);
    if (alreadyExists) {
      return { status: "already-exists" as const };
    }

    if (!persistWithFirestore) {
      const notifiedAudit = createDisciplineAudit("Parent notifié pour sanction disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      return { status: "sent" as const, message, notification, auditLog: notifiedAudit };
    }

    try {
      const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName: parent.fullName });
      if (savedMessage.alreadyExisted) {
        return { status: "already-exists" as const };
      }
      const notifiedAudit = createDisciplineAudit("Parent notifié pour sanction disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      try {
        const persistedAudit = await persistDisciplineAudit(notifiedAudit);
        return { status: "sent" as const, message: savedMessage, notification, auditLog: persistedAudit };
      } catch (auditError) {
        console.warn("Audit parent notifié discipline impossible.", auditError);
        return { status: "sent" as const, message: savedMessage, notification };
      }
    } catch (error) {
      console.warn("Signalement disciplinaire au parent impossible.", error);
      const failedAudit = createDisciplineAudit("Échec signalement disciplinaire", `${sanction.studentName} - ${parent.fullName}`);
      if (!persistWithFirestore) {
        return { status: "send-failed" as const, auditLog: failedAudit };
      }
      try {
        const persistedAudit = await persistDisciplineAudit(failedAudit);
        return { status: "send-failed" as const, auditLog: persistedAudit };
      } catch (auditError) {
        console.warn("Audit échec signalement discipline impossible.", auditError);
        return { status: "send-failed" as const };
      }
    }
  }

  async function markNotificationsRead(notificationId?: string) {
    updateData(
      {
        notifications: data.notifications.map((notification) =>
          notification.schoolId === school.id &&
          notification.schoolYearId === year.id &&
          (notificationId ? notification.id === notificationId : true)
            ? { ...notification, read: true }
            : notification,
        ),
      },
      { persist: false },
    );
    await markNotificationsReadTargeted(user, school.id, year.id, notificationId).catch((error) => {
      console.warn("Marquage ciblé des notifications discipline impossible.", error);
    });
    await markConversationUnreadCountRead(user, school.id, year.id).catch((error) => {
      console.warn("Remise à zéro des compteurs de conversation discipline impossible.", error);
    });
  }

  function closeNotifications() {
    setNotificationsOpen(false);
    void markNotificationsRead();
  }

  function toggleNotifications() {
    if (notificationsOpen) {
      closeNotifications();
      return;
    }
    setNotificationsOpen(true);
  }

  async function saveNewSanction(input: NewDisciplineSanctionFormInput) {
    const persistWithFirestore = canUseFirestoreData();
    const createdSanctions: DisciplineSanction[] = [];
    const createdMessages: Message[] = [];
    const createdNotifications: AppNotification[] = [];
    const createdAuditLogs: AuditLog[] = [];
    const failedStudentIds: string[] = [];
    let notifiedParents = 0;
    let missingParents = 0;
    let failedSignals = 0;
    let existingSignals = 0;

    for (const student of input.students) {
      const now = new Date().toISOString();
      const sanctionBase: Omit<DisciplineSanction, "recurrenceNumber"> = {
        id: uid("discipline"),
        schoolId: school.id,
        schoolYearId: year.id,
        studentId: student.id,
        studentName: disciplineStudentName(student),
        className: disciplineClassName(student),
        reason: input.reason,
        description: input.description,
        sanctionType: input.sanctionType,
        duration: input.duration,
        startDate: input.startDate,
        expectedEndDate: input.expectedEndDate,
        status: "active",
        createdBy: user.id,
        createdByName: user.name,
        createdAt: now,
        ...(input.observation ? { observation: input.observation } : {}),
      };
      const auditLog = createDisciplineAudit("Création sanction disciplinaire", `${sanctionBase.studentName} - ${sanctionBase.sanctionType}`);

      try {
        const savedSanction = persistWithFirestore
          ? await createDisciplineSanction({ sanction: sanctionBase, auditLog })
          : {
              ...sanctionBase,
              recurrenceNumber: [...data.disciplineSanctions, ...createdSanctions].filter(
                (sanction) =>
                  sanction.schoolId === school.id &&
                  sanction.schoolYearId === year.id &&
                  sanction.studentId === student.id &&
                  normalizeDisciplineReason(sanction.reason) === normalizeDisciplineReason(sanctionBase.reason),
              ).length,
            };
        const signalResult = await sendDisciplineSignalToParent(savedSanction, student, persistWithFirestore);
        createdSanctions.push(savedSanction);
        createdAuditLogs.push(auditLog);
        if (signalResult.auditLog) createdAuditLogs.push(signalResult.auditLog);
        if (signalResult.status === "sent") {
          notifiedParents += 1;
          if (signalResult.message) createdMessages.push(signalResult.message);
          if (signalResult.notification) createdNotifications.push(signalResult.notification);
        } else if (signalResult.status === "missing-parent") {
          missingParents += 1;
        } else if (signalResult.status === "already-exists") {
          existingSignals += 1;
        } else {
          failedSignals += 1;
        }
      } catch (error) {
        console.warn("Création de sanction impossible pour un élève.", { studentId: student.id, error });
        failedStudentIds.push(student.id);
      }
    }

    if (createdSanctions.length > 0 || createdMessages.length > 0 || createdNotifications.length > 0 || createdAuditLogs.length > 0) {
      updateData(
        {
          disciplineSanctions: [...createdSanctions, ...data.disciplineSanctions],
          messages: [...createdMessages, ...data.messages],
          notifications: [...createdNotifications, ...data.notifications],
          auditLogs: [...createdAuditLogs, ...data.auditLogs],
        },
        persistWithFirestore ? { persist: false } : undefined,
      );
    }

    const summaryParts = [];
    if (createdSanctions.length > 0) summaryParts.push(`${createdSanctions.length} sanction(s) enregistrée(s)`);
    if (notifiedParents > 0) summaryParts.push(`${notifiedParents} parent(s) notifié(s)`);
    if (existingSignals > 0) summaryParts.push(`${existingSignals} signalement(s) déjà existant(s)`);
    if (missingParents > 0) summaryParts.push(`${missingParents} parent(s) introuvable(s)`);
    if (failedSignals > 0) summaryParts.push(`${failedSignals} signalement(s) en échec`);
    if (failedStudentIds.length > 0) summaryParts.push(`${failedStudentIds.length} échec(s) de création`);
    setFeedback(summaryParts.length > 0 ? `${summaryParts.join(", ")}.` : "Sanction non enregistrée. Veuillez réessayer.");

    if (failedStudentIds.length === 0) {
      setNewSanctionOpen(false);
      return [];
    }
    return failedStudentIds;
  }

  async function completeSanction(sanction: DisciplineSanction) {
    if (sanction.status !== "active") {
      setFeedback("Cette sanction est déjà purgée.");
      return;
    }
    if (!confirm(`Marquer comme purgée la sanction de ${sanction.studentName} ?`)) return;
    const completedAt = new Date().toISOString();
    const auditLog = createDisciplineAudit("Clôture sanction disciplinaire", `${sanction.studentName} - ${sanction.sanctionType}`);
    try {
      let completedSanction: DisciplineSanction;
      if (canUseFirestoreData()) {
        completedSanction = await completeDisciplineSanction({
          sanction,
          completedAt,
          completedBy: user.id,
          completedByName: user.name,
          auditLog,
        });
        updateData(
          {
            disciplineSanctions: data.disciplineSanctions.map((item) => (item.id === completedSanction.id ? completedSanction : item)),
            auditLogs: [auditLog, ...data.auditLogs],
          },
          { persist: false },
        );
      } else {
        completedSanction = {
          ...sanction,
          status: "completed",
          actualEndDate: completedAt.slice(0, 10),
          completedAt,
          completedBy: user.id,
          completedByName: user.name,
        };
        updateData({
          disciplineSanctions: data.disciplineSanctions.map((item) => (item.id === completedSanction.id ? completedSanction : item)),
          auditLogs: [auditLog, ...data.auditLogs],
        });
      }
      setFeedback("Sanction marquée comme purgée.");
    } catch (error) {
      console.warn("Clôture de sanction impossible.", error);
      setFeedback("Impossible de clôturer la sanction. Veuillez réessayer.");
    }
  }

  async function saveManualAttendance(inputs: { studentId: string; attendanceDate: string; status: AttendanceStatus; manualReason: string }[]) {
    const now = new Date().toISOString();
    const recordedAt = new Date(now);
    const attendanceSettings = yearData.attendanceSettings.find((settings) => settings.schoolId === school.id && settings.schoolYearId === year.id);
    const existingAttendanceIds = new Set(data.attendance.map((item) => item.id));
    const existingNotificationIds = new Set(data.notifications.map((item) => item.id));
    const records: AttendanceRecord[] = [];
    const notifications: AppNotification[] = [];
    const auditLogs: AuditLog[] = [];
    let existing = 0;
    let failed = 0;

    for (const input of inputs) {
      const student = yearData.students.find((item) => item.id === input.studentId && item.schoolId === school.id && item.schoolYearId === year.id);
      if (!student || !input.manualReason.trim()) {
        failed += 1;
        continue;
      }

      const recordId = attendanceRecordId(school.id, year.id, student.id, input.attendanceDate);
      if (existingAttendanceIds.has(recordId)) {
        existing += 1;
        continue;
      }
      const resolvedStatus = resolveAttendanceStatusForArrival(student, input.status, attendanceSettings, recordedAt);

      const record: AttendanceRecord = {
        id: recordId,
        schoolId: school.id,
        schoolYearId: year.id,
        studentId: student.id,
        attendanceDate: input.attendanceDate,
        status: resolvedStatus,
        recordedAt: now,
        recordedBy: user.id,
        source: "manual",
        manualReason: input.manualReason,
      };
      records.push(record);
      existingAttendanceIds.add(recordId);
      auditLogs.push(createDisciplineAudit("Présence manuelle élève", `${disciplineStudentName(student)} - ${input.attendanceDate} - ${input.manualReason}`));

      const parent = findDisciplineSignalParent(student);
      const notificationId = `notif-${recordId}`;
      if (parent && !existingNotificationIds.has(notificationId)) {
        const attendanceDate = new Date(`${input.attendanceDate}T00:00:00`);
        const statusText = attendanceStatusText(resolvedStatus);
        notifications.push({
          id: notificationId,
          schoolId: school.id,
          schoolYearId: year.id,
          recipientRole: "parent",
          parentId: parent.id,
          studentId: student.id,
          studentName: disciplineStudentName(student),
          type: "attendance",
          title: "Présence enregistrée",
          body: `Votre enfant ${disciplineStudentName(student)} a été enregistré ${statusText} le ${attendanceDate.toLocaleDateString("fr-FR")} à ${recordedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.`,
          createdAt: now,
          read: false,
        });
        existingNotificationIds.add(notificationId);
      }
    }

    if (records.length > 0 || auditLogs.length > 0 || notifications.length > 0) {
      if (canUseFirestoreData()) {
        await persistFirestorePatch({ attendance: records, auditLogs, notifications }, { throwOnError: true });
        updateData(
          {
            attendance: [...records, ...data.attendance.filter((item) => !records.some((record) => record.id === item.id))],
            notifications: [...notifications, ...data.notifications.filter((item) => !notifications.some((notification) => notification.id === item.id))],
            auditLogs: [...auditLogs, ...data.auditLogs],
          },
          { persist: false },
        );
      } else {
        updateData({
          attendance: [...records, ...data.attendance.filter((item) => !records.some((record) => record.id === item.id))],
          notifications: [...notifications, ...data.notifications.filter((item) => !notifications.some((notification) => notification.id === item.id))],
          auditLogs: [...auditLogs, ...data.auditLogs],
        });
      }
    }

    return { created: records.length, existing, failed };
  }

  async function saveAttendanceSettings(settings: AttendanceSettings) {
    if (canUseFirestoreData()) {
      await persistFirestorePatch({ attendanceSettings: [settings] }, { throwOnError: true });
      updateData(
        {
          attendanceSettings: [settings, ...data.attendanceSettings.filter((item) => item.id !== settings.id)],
        },
        { persist: false },
      );
      return;
    }
    updateData({
      attendanceSettings: [settings, ...data.attendanceSettings.filter((item) => item.id !== settings.id)],
    });
  }

  async function exportDisciplinePdf(filteredSanctions: DisciplineSanction[]) {
    const studentsById = new Map(yearData.students.map((student) => [student.id, student]));
    const sortedSanctions = [...filteredSanctions].sort(
      (first, second) => (second.createdAt || second.startDate).localeCompare(first.createdAt || first.startDate),
    );
    const filteredStats = buildDisciplineStats(sortedSanctions);
    await renderAcadPdfPreview({
      filename: `discipline-${year.name}.pdf`,
      title: "Rapport disciplinaire",
      school,
      year,
      subtitle: `Export du ${new Date().toLocaleString("fr-FR")}`,
      sections: [
        pdfSection(
          "Synthèse",
          pdfInfoGrid([
            { label: "Total sanctions", value: filteredStats.total },
            { label: "Sanctions en cours", value: filteredStats.active },
            { label: "Sanctions purgées", value: filteredStats.completed },
            { label: "Élèves sanctionnés", value: filteredStats.sanctionedStudents },
            { label: "Récidives", value: filteredStats.recurrences },
          ]),
        ),
        pdfSection(
          "Sanctions",
          pdfTable(
            [
              { header: "Élève", render: (sanction) => sanction.studentName },
              { header: "Matricule", render: (sanction) => studentsById.get(sanction.studentId)?.matricule ?? "—" },
              { header: "Classe", render: (sanction) => sanction.className },
              { header: "Motif", render: (sanction) => sanction.reason },
              { header: "Type", render: (sanction) => sanction.sanctionType },
              { header: "Description", render: (sanction) => sanction.description || "—" },
              { header: "Début", render: (sanction) => sanction.startDate },
              { header: "Fin prévue", render: (sanction) => sanction.expectedEndDate },
              { header: "Fin réelle", render: (sanction) => sanction.actualEndDate ?? "—" },
              { header: "Durée", render: (sanction) => `${sanction.duration} jour(s)`, align: "center" },
              { header: "Statut", render: (sanction) => (sanction.status === "completed" ? "Purgée" : "Sanction en cours") },
              { header: "Récidive", render: (sanction) => sanction.recurrenceNumber, align: "center" },
              { header: "Auteur", render: (sanction) => sanction.createdByName },
              { header: "Clôture", render: (sanction) => sanction.completedByName ?? "—" },
            ],
            sortedSanctions,
            "Aucune sanction enregistrée.",
          ),
        ),
      ],
    });
    if (canUseFirestoreData()) {
      const auditLog = createDisciplineAudit("Export PDF discipline", `${sortedSanctions.length} sanction(s) exportée(s)`);
      try {
        await saveDisciplineAuditLog(auditLog);
        updateData({ auditLogs: [auditLog, ...data.auditLogs] }, { persist: false });
      } catch (error) {
        console.warn("Audit export discipline impossible.", error);
      }
    }
  }

  const feedbackTone =
    feedback.includes("Impossible") || feedback.includes("n'a pas pu")
      ? "border-red-200 bg-red-50 text-red-700"
      : feedback.includes("aucun parent") || feedback.includes("déjà")
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-mint/30 bg-mint/10 text-mint";
  const disciplineMenuSections = [
    {
      id: "history",
      title: "Historique",
      description: "Sanctions en cours et purgées.",
      icon: Clock3,
      onClick: () => setHistoryOpen(true),
    },
    {
      id: "stats",
      title: "Statistiques",
      description: "Synthèse locale des sanctions chargées.",
      icon: BarChart3,
      onClick: () => setStatsOpen(true),
    },
    {
      id: "attendance-settings",
      title: "Paramètres présence",
      description: "Heures limites de retard par section ou classe.",
      icon: Settings,
      onClick: () => setAttendanceSettingsOpen(true),
    },
  ];
  const selectedDisciplineStudentSanctions = selectedDisciplineStudentId
    ? yearData.disciplineSanctions
        .filter((sanction) => sanction.studentId === selectedDisciplineStudentId)
        .sort((first, second) => (second.createdAt || second.startDate).localeCompare(first.createdAt || first.startDate))
    : [];
  const selectedDisciplineStudentName = selectedDisciplineStudentSanctions[0]?.studentName ?? "Élève";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBanner />
      <Header
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={year}
        unreadNotifications={unread}
        notificationsOpen={notificationsOpen}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        onRefresh={onRefresh}
        onToggleNotifications={toggleNotifications}
        onCloseNotifications={closeNotifications}
        onRealtimeNotifications={(notifications) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        }}
        onRealtimeMessages={(messages) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        }}
      />
      <main className="mx-auto grid w-full max-w-7xl min-w-0 flex-1 gap-4 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {feedback && <p className={`rounded border p-3 text-sm font-semibold ${feedbackTone}`}>{feedback}</p>}
        {activeDisciplineTab === "status" && (
          <DisciplineStatus students={yearData.students} sanctions={yearData.disciplineSanctions} onNewSanction={() => setNewSanctionOpen(true)} onOpenStudent={setSelectedDisciplineStudentId} onExportPdf={exportDisciplinePdf} />
        )}
        {activeDisciplineTab === "attendance" && (
          <DisciplineAttendanceDrawer
            students={yearData.students}
            attendance={yearData.attendance}
            school={school}
            year={year}
            onSaveManualAttendance={saveManualAttendance}
          />
        )}
        {activeDisciplineTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={year} updateData={updateData} />
        )}
        {activeDisciplineTab === "menu" && (
          <section className="grid min-w-0 gap-3">
            {disciplineMenuSections.map((section) => {
              const Icon = section.icon;
              return (
                <button key={section.id} onClick={section.onClick} className="min-w-0 rounded border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-mint" type="button">
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
            <div className="mt-2 border-t border-slate-200 pt-4">
              <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </section>
        )}
      </main>
      <DisciplineBottomNavigation
        activeTab={activeDisciplineTab}
        showInstallButton={showInstallButton}
        onInstallPwa={onInstallPwa}
        onTab={(tab) => {
          setNotificationsOpen(false);
          setActiveDisciplineTab(tab);
        }}
      />
      {newSanctionOpen && (
        <AdminDrawer title="Nouvelle sanction" onClose={() => setNewSanctionOpen(false)} closeLabel="Fermer la nouvelle sanction">
          <NewSanctionDrawer students={yearData.students} sanctions={yearData.disciplineSanctions} onCancel={() => setNewSanctionOpen(false)} onSave={saveNewSanction} />
        </AdminDrawer>
      )}
      {selectedDisciplineStudentId && (
        <AdminDrawer title={`Dossier disciplinaire - ${selectedDisciplineStudentName}`} onClose={() => setSelectedDisciplineStudentId(null)} closeLabel="Fermer le dossier disciplinaire">
          <div className="grid min-w-0 gap-3">
            {selectedDisciplineStudentSanctions.length === 0 && (
              <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucune sanction enregistrée pour cet élève.</p>
            )}
            {selectedDisciplineStudentSanctions.map((sanction) => (
              <article key={sanction.id} className="min-w-0 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="break-words font-bold text-ink">{sanction.sanctionType}</h2>
                      <span className={`rounded px-2 py-1 text-xs font-bold ${sanction.status === "completed" ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                        {sanction.status === "completed" ? "Purgée" : "Sanction en cours"}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-sm font-semibold text-slate-500">{sanction.className}</p>
                  </div>
                  {sanction.status === "active" && (
                    <button onClick={() => completeSanction(sanction)} className="primary-button w-full justify-center lg:w-auto" type="button">
                      <CheckCircle2 className="h-4 w-4" /> Marquer comme purgée
                    </button>
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date</span><p className="mt-1 break-words text-ink">{(sanction.createdAt || sanction.startDate).slice(0, 10)}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Motif</span><p className="mt-1 break-words text-ink">{sanction.reason}</p></div>
                  <div className="rounded bg-slate-50 p-3 sm:col-span-2"><span className="font-semibold text-slate-600">Description</span><p className="mt-1 whitespace-pre-wrap break-words text-ink">{sanction.description || "Non renseigné"}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Type</span><p className="mt-1 break-words text-ink">{sanction.sanctionType}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Durée</span><p className="mt-1 break-words text-ink">{sanction.duration} jour(s)</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date de début</span><p className="mt-1 break-words text-ink">{sanction.startDate}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date prévue de fin</span><p className="mt-1 break-words text-ink">{sanction.expectedEndDate}</p></div>
                  {sanction.actualEndDate && <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Date réelle de fin</span><p className="mt-1 break-words text-ink">{sanction.actualEndDate}</p></div>}
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Statut</span><p className="mt-1 break-words text-ink">{sanction.status === "completed" ? "Purgée" : "Sanction en cours"}</p></div>
                  <div className="rounded bg-slate-50 p-3"><span className="font-semibold text-slate-600">Récidive</span><p className="mt-1 break-words text-ink">{sanction.recurrenceNumber}</p></div>
                  <div className="rounded bg-slate-50 p-3 sm:col-span-2"><span className="font-semibold text-slate-600">Observation</span><p className="mt-1 whitespace-pre-wrap break-words text-ink">{sanction.observation || "Non renseigné"}</p></div>
                </div>
              </article>
            ))}
          </div>
        </AdminDrawer>
      )}
      {historyOpen && (
        <AdminDrawer title="Historique disciplinaire" onClose={() => setHistoryOpen(false)} closeLabel="Fermer l'historique disciplinaire">
          <DisciplineHistoryDrawer sanctions={yearData.disciplineSanctions} />
        </AdminDrawer>
      )}
      {statsOpen && (
        <AdminDrawer title="Statistiques disciplinaires" onClose={() => setStatsOpen(false)} closeLabel="Fermer les statistiques disciplinaires">
          <DisciplineStatistics stats={stats} />
        </AdminDrawer>
      )}
      {attendanceSettingsOpen && (
        <AdminDrawer title="Paramètres présence" onClose={() => setAttendanceSettingsOpen(false)} closeLabel="Fermer les paramètres de présence">
          <AttendanceSettingsDrawer
            school={school}
            year={year}
            user={user}
            students={yearData.students}
            settings={yearData.attendanceSettings.find((item) => item.schoolId === school.id && item.schoolYearId === year.id)}
            onSave={saveAttendanceSettings}
          />
        </AdminDrawer>
      )}
    </div>
  );
}

function ParentBottomNavigation({
  activeTab,
  showInstallButton,
  onInstallPwa,
  onTab,
}: {
  activeTab: ParentTab;
  showInstallButton: boolean;
  onInstallPwa: () => void;
  onTab: (tab: ParentTab) => void;
}) {
  const tabs = [
    { id: "children", label: "Enfants", icon: GraduationCap },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] satisfies { id: ParentTab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className={`mx-auto grid w-full max-w-md ${showInstallButton ? "grid-cols-4" : "grid-cols-3"} gap-1`}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTab(tab.id)}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 py-2 text-[11px] font-semibold transition sm:text-xs ${
                active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={`h-5 w-5 shrink-0 ${active ? "text-blue-700" : "text-slate-400"}`} />
              <span className="max-w-full truncate">{tab.label}</span>
            </button>
          );
        })}
        {showInstallButton && <InstallPwaNavButton onInstall={onInstallPwa} />}
      </div>
    </nav>
  );
}

function FinancialReportPage({
  user,
  data,
  yearData,
  school,
  year,
  onBack,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  onBack: () => void;
}) {
  return (
    <section className="grid min-w-0 gap-4">
      <div className="mb-4 min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button onClick={onBack} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-slate-600 transition hover:bg-slate-50 hover:text-ink" aria-label="Retour au menu" title="Retour au menu">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="break-words text-2xl font-bold text-ink">Rapport financier</h1>
        </div>
        <p className="mt-1 break-words text-sm text-slate-500">Rapports financiers dédiés à l'année scolaire sélectionnée.</p>
      </div>
      <ReportsModule user={user} data={data} yearData={yearData} school={school} year={year} />
    </section>
  );
}

function ParentsModule({
  data,
  yearData,
  school,
  year,
  updateData,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
}) {
  const [parentEditorRequest, setParentEditorRequest] = useState<{ parentId?: string; requestId: number }>(() => ({ requestId: Date.now() }));
  const [query, setQuery] = useState("");
  const filteredParents = yearData.parents.filter((parent) => {
    const text = `${parent.fullName} ${parent.email} ${parent.phone}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const canEdit = year.status !== "archived";

  function toggleParent(parent: ParentProfile) {
    const status = parent.status === "active" ? "inactive" : "active";
    updateData({
      parents: data.parents.map((item) => (item.id === parent.id ? { ...item, status } : item)),
      users: data.users.map((item) => (item.parentId === parent.id ? { ...item, status } : item)),
    });
  }

  function editParent(parent: ParentProfile) {
    setParentEditorRequest({ parentId: parent.id, requestId: Date.now() });
  }

  function deleteParent(parent: ParentProfile) {
    if (!confirm(`Supprimer le parent ${parent.fullName} et détacher ses élèves ?`)) return;
    updateData({
      parents: data.parents.filter((item) => item.id !== parent.id),
      users: data.users.filter((item) => item.parentId !== parent.id && item.id !== parent.userId),
      students: data.students.map((student) => (student.parentId === parent.id ? { ...student, parentId: undefined } : student)),
    });
    setParentEditorRequest({ requestId: Date.now() });
  }


  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <SectionTitle title="Parents" subtitle="Comptes parents, statut et liaison unique avec les élèves." />
        <label className="mb-3 flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un parent" className="min-w-0 flex-1 outline-none" />
        </label>
        <div className="grid gap-3">
          {filteredParents.map((parent) => {
            const children = yearData.students.filter((student) => student.parentId === parent.id);
            return (
              <article key={parent.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-bold text-ink">{parent.fullName}</h2>
                      <span className={`rounded px-2 py-1 text-xs font-semibold ${parent.status === "active" ? "bg-mint/10 text-mint" : "bg-slate-100 text-slate-500"}`}>
                        {parent.status === "active" ? "Actif" : "Inactif"}
                      </span>
                    </div>
                    <p className="break-words text-sm text-slate-500">{parent.phone} | {parent.email}</p>
                    <p className="break-words text-sm text-slate-500">{children.length} enfant(s): {children.map((student) => `${student.nom} ${student.prenom}`).join(", ") || "aucun"}</p>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <IconButton label="Modifier" onClick={() => editParent(parent)} icon={Edit3} />
                      <IconButton label="Supprimer" onClick={() => deleteParent(parent)} icon={Trash2} danger />
                      <button onClick={() => toggleParent(parent)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                        {parent.status === "active" ? "Désactiver" : "Réactiver"}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {canEdit ? (
        <ParentFormEditor
          data={data}
          yearData={yearData}
          school={school}
          year={year}
          updateData={updateData}
          initialParentId={parentEditorRequest.parentId}
          requestId={parentEditorRequest.requestId}
          createId={uid}
          emptyParent={emptyParent}
          nextParentEmail={nextParentEmail}
        />
      ) : (
        <FormPanel title="Archive en lecture seule">
          <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">Les parents de cette année archivée sont consultables, mais aucune modification n'est autorisée.</p>
        </FormPanel>
      )}
    </section>
  );
}

function ControlModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [paymentStudentQuery, setPaymentStudentQuery] = useState("");
  const [feeTypeId, setFeeTypeId] = useState(yearData.feeTypes[0]?.id ?? "");
  const [amount, setAmount] = useState("100");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Fournitures");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseBeneficiary, setExpenseBeneficiary] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [amountComparator, setAmountComparator] = useState("all");
  const [amountThreshold, setAmountThreshold] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expenseHistoryOpen, setExpenseHistoryOpen] = useState(false);
  const [expenseEditTarget, setExpenseEditTarget] = useState<Expense | null>(null);
  const [expenseEditAmount, setExpenseEditAmount] = useState("");
  const [expenseEditCategory, setExpenseEditCategory] = useState("Fournitures");
  const [expenseEditDescription, setExpenseEditDescription] = useState("");
  const [expenseEditError, setExpenseEditError] = useState("");
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState<Expense | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [cashierControlDrawer, setCashierControlDrawer] = useState<"payment" | "expense" | "history" | "warning" | null>(null);
  const [cashierControlFeedback, setCashierControlFeedback] = useState("");
  const [cashierControlFeedbackDrawer, setCashierControlFeedbackDrawer] = useState<"payment" | "expense" | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState("");
  const controlIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const paymentHistory = usePaginatedControlHistory<Payment>({
    kind: "payments",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: historyOpen || cashierControlDrawer === "history",
  });
  const expenseHistory = usePaginatedControlHistory<Expense>({
    kind: "expenses",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: expenseHistoryOpen,
  });
  const feeNameChoices = Array.from(new Set(yearData.feeTypes.map((fee) => fee.name)));
  const amountFeeGroups = Array.from(
    yearData.feeTypes.reduce<Map<string, { key: string; name: string; ids: string[] }>>((items, fee) => {
      const name = fee.name.trim();
      const key = name.toLowerCase();
      if (!key) return items;
      const existing = items.get(key);
      items.set(key, existing ? { ...existing, ids: [...existing.ids, fee.id] } : { key, name, ids: [fee.id] });
      return items;
    }, new Map()).values(),
  );
  const amountFeeOptions = amountFeeGroups.flatMap((fee) => [
    { value: `fee:${fee.key}:gte`, label: `${fee.name} >=` },
    { value: `fee:${fee.key}:lt`, label: `${fee.name} <` },
  ]);
  const [warningFeeName, setWarningFeeName] = useState(feeNameChoices[0] ?? "");
  const [warningRequiredAmount, setWarningRequiredAmount] = useState("");
  const [warningDeadline, setWarningDeadline] = useState("");
  const [warningFeedback, setWarningFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  useEffect(() => {
    if (!warningFeeName && feeNameChoices[0]) setWarningFeeName(feeNameChoices[0]);
  }, [feeNameChoices, warningFeeName]);
  useEffect(() => {
    const match = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    if (match && !amountFeeGroups.some((fee) => fee.key === match[1])) {
      setAmountComparator("all");
    }
  }, [amountComparator, amountFeeGroups]);
  useEffect(() => {
    if (!cashierControlFeedback || !cashierControlFeedbackDrawer) return;
    const feedbackDrawer = cashierControlFeedbackDrawer;
    const timer = window.setTimeout(() => {
      setCashierControlFeedback("");
      setCashierControlFeedbackDrawer(null);
      setCashierControlDrawer((current) => (current === feedbackDrawer ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [cashierControlFeedback, cashierControlFeedbackDrawer]);
  const isArchivedContext = year.status === "archived";
  const canPay = user.role === "cashier" && !isArchivedContext;
  const canCorrectPayments = user.role === "school_admin" && !isArchivedContext;
  const canManageExpenses = user.role === "school_admin" && !isArchivedContext;
  const selectedPaymentStudent = controlIndexes.studentsById.get(studentId);
  const selectedPaymentBalance = selectedPaymentStudent
    ? getStudentBalance(selectedPaymentStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const payableFeeTypes = selectedPaymentStudent ? controlIndexes.applicableFeeTypesByStudentId.get(selectedPaymentStudent.id) ?? [] : [];
  const selectedFeeTypeValue = payableFeeTypes.some((fee) => fee.id === feeTypeId) ? feeTypeId : payableFeeTypes[0]?.id ?? "";
  const selectedPaymentFee = payableFeeTypes.find((fee) => fee.id === selectedFeeTypeValue);
  const selectedPaymentFeePaid = selectedPaymentStudent && selectedPaymentFee
    ? sumPaymentsForStudentFee(controlIndexes, selectedPaymentStudent.id, selectedPaymentFee.id)
    : 0;
  const selectedPaymentFeeRemaining = selectedPaymentFee ? Math.max(selectedPaymentFee.amount - selectedPaymentFeePaid, 0) : 0;
  const isPaymentEntryDisabled = !selectedPaymentFee || selectedPaymentFeeRemaining <= 0;
  const selectedHistoryStudent = controlIndexes.studentsById.get(selectedHistoryStudentId);
  const paymentStudentSearch = paymentStudentQuery.trim().toLowerCase();
  const paymentStudentResults = paymentStudentSearch
    ? yearData.students.filter((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`.toLowerCase().includes(paymentStudentSearch)).slice(0, 8)
    : [];

  const rows = yearData.students
    .map((student) => {
      const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, controlIndexes);
      const balance = feeSummaries.reduce(
        (totals, summary) => ({
          expected: totals.expected + summary.expected,
          paid: totals.paid + summary.paid,
          remaining: totals.remaining + summary.remaining,
        }),
        { expected: 0, paid: 0, remaining: 0 },
      );
      const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
      return { student, balance, progress, hasApplicableFees: feeSummaries.length > 0 };
    })
    .filter((row) => {
      if (amountComparator === "all" || !amountThreshold) return true;
      const feeFilter = amountComparator.match(/^fee:(.+):(gte|lt)$/);
      const feeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
      const paidAmount = feeFilter
        ? (feeGroup?.ids ?? []).reduce((sum, feeId) => sum + sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId), 0)
        : row.balance.paid;
      const isGreaterOrEqual = feeFilter ? feeFilter[2] === "gte" : amountComparator === ">=";
      return isGreaterOrEqual ? paidAmount >= Number(amountThreshold) : paidAmount < Number(amountThreshold);
    });
  const historyPayments = paymentHistory.items
    .map((payment) => {
      const student = controlIndexes.studentsById.get(payment.studentId);
      const fee = controlIndexes.feeTypesById.get(payment.feeTypeId);
      return student && fee ? { payment, student, fee } : null;
    })
    .filter((item): item is { payment: Payment; student: Student; fee: FeeType } => Boolean(item));
  function historyTimestamp(dateValue?: string, fallbackDateValue?: string) {
    const primaryDate = dateValue ? new Date(dateValue) : null;
    if (primaryDate && !Number.isNaN(primaryDate.getTime())) return primaryDate.getTime();
    const fallbackDate = fallbackDateValue ? new Date(fallbackDateValue) : null;
    if (fallbackDate && !Number.isNaN(fallbackDate.getTime())) return fallbackDate.getTime();
    return 0;
  }

  const filteredHistoryPayments = historyPayments
    .filter(({ payment, student, fee }) => {
      const query = historyQuery.trim().toLowerCase();
      if (!query) return true;
      const searchableText = [
        student.nom,
        student.postnom,
        student.prenom,
        student.matricule,
        formatStudentClassName(student),
        fee.name,
        String(payment.amount),
        payment.paidAt,
        payment.createdAt ?? "",
        payment.receiptNumber ?? "",
      ].join(" ");
      return searchableText.toLowerCase().includes(query);
    })
    .sort((first, second) => historyTimestamp(second.payment.createdAt, second.payment.paidAt) - historyTimestamp(first.payment.createdAt, first.payment.paidAt));
  const selectedHistoryBalance = selectedHistoryStudent
    ? getStudentBalance(selectedHistoryStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const selectedHistoryFeeSummaries = selectedHistoryStudent
    ? getStudentFeeSummaries(selectedHistoryStudent, yearData.feeTypes, yearData.payments, controlIndexes)
    : [];
  const selectedHistoryFeeTotals = selectedHistoryFeeSummaries.reduce(
    (totals, summary) => ({
      expected: totals.expected + summary.expected,
      paid: totals.paid + summary.paid,
      remaining: totals.remaining + summary.remaining,
    }),
    { expected: 0, paid: 0, remaining: 0 },
  );
  const selectedHistoryPayments = selectedHistoryStudent
    ? (controlIndexes.paymentsByStudentId.get(selectedHistoryStudent.id) ?? [])
        .map((payment) => ({
          payment,
          fee: controlIndexes.feeTypesById.get(payment.feeTypeId),
        }))
        .sort((a, b) => `${a.payment.paidAt}${a.payment.createdAt ?? ""}`.localeCompare(`${b.payment.paidAt}${b.payment.createdAt ?? ""}`))
    : [];
  let selectedHistoryRunningPaid = 0;
  const selectedHistoryRows = selectedHistoryPayments.map(({ payment, fee }) => {
    selectedHistoryRunningPaid += payment.amount;
    return {
      payment,
      feeName: fee?.name ?? "Frais",
      remaining: Math.max(selectedHistoryBalance.expected - selectedHistoryRunningPaid, 0),
    };
  });
  const sortedExpenses = [...expenseHistory.items].sort((first, second) => historyTimestamp(second.createdAt, second.spentAt) - historyTimestamp(first.createdAt, first.spentAt));
  const isOtherExpenseEditCategory = expenseEditCategory === "Autre" || expenseEditCategory === "Autres";
  const cashierDrawerTitle =
    cashierControlDrawer === "payment"
      ? "Enregistrer un paiement"
      : cashierControlDrawer === "expense"
        ? "Enregistrer une dépense"
        : cashierControlDrawer === "warning"
          ? "Avertissement"
          : "Historique des paiements";

  function studentFullName(student: Student) {
    return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
  }

  function formatMoney(value: number) {
    return `$${value.toFixed(2)}`;
  }

  function formatPaymentDate(value: string) {
    return new Date(value).toLocaleDateString("fr-FR");
  }

  function formatExpenseDateTime(expense: Expense) {
    const value = expense.createdAt || expense.spentAt;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return expense.spentAt;
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function getExpenseField(expense: Expense, keys: string[]) {
    const record = expense as Expense & Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function progressBarTone(percent: number) {
    if (percent >= 100) return "bg-mint";
    if (percent >= 75) return "bg-lime-400";
    if (percent >= 50) return "bg-amber-400";
    return "bg-red-500";
  }

  function isStudentPaymentComplete(balance: { expected: number; paid: number }) {
    return balance.expected > 0 && balance.paid >= balance.expected;
  }

  function selectPaymentStudent(student: Student) {
    setStudentId(student.id);
    setPaymentStudentQuery(`${student.nom} ${student.postnom} ${student.prenom} | ${student.matricule}`.replace(/\s+/g, " ").trim());
  }

  function updatePaymentStudentQuery(value: string) {
    setPaymentStudentQuery(value);
    setStudentId("");
  }

  function savePayment() {
    setCashierControlFeedback("");
    setCashierControlFeedbackDrawer(null);
    if (isArchivedContext) {
      setPaymentError("Cette année scolaire est archivée en lecture seule.");
      return;
    }
    if (!studentId || !selectedFeeTypeValue) return;
    setPaymentError("");
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setPaymentError("Montant de paiement invalide.");
      return;
    }
    if (!selectedPaymentStudent || !selectedPaymentFee) {
      setPaymentError("Type de frais indisponible pour cet élève.");
      return;
    }
    const alreadyPaidForFee = yearData.payments
      .filter(
        (payment) =>
          payment.schoolId === school.id &&
          payment.schoolYearId === year.id &&
          payment.studentId === selectedPaymentStudent.id &&
          payment.feeTypeId === selectedPaymentFee.id,
      )
      .reduce((sum, payment) => sum + payment.amount, 0);
    const totalPaidAfterPayment = alreadyPaidForFee + paymentAmount;
    const remainingAfterPayment = Math.max(selectedPaymentFee.amount - totalPaidAfterPayment, 0);
    const isFeePaidOff = remainingAfterPayment === 0;
    if (totalPaidAfterPayment > selectedPaymentFee.amount) {
      setPaymentError("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const student = data.students.find((item) => item.id === studentId);
    const payment: Payment = {
      id: uid("pay"),
      schoolId: school.id,
      schoolYearId: year.id,
      studentId,
      parentId: student?.parentId,
      feeTypeId: selectedFeeTypeValue,
      amount: paymentAmount,
      paidAt: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      receiptNumber: generateReceiptNumber(data.payments, year.name),
      cashierName: user.name,
    };
    const notification: AppNotification | undefined = student?.parentId
      ? {
          id: uid("notif"),
          schoolId: school.id,
          schoolYearId: year.id,
          parentId: student.parentId,
          studentId,
          type: "payment",
          title: "Paiement enregistré",
          body: [
            `Élève : ${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim(),
            `Type de frais : ${selectedPaymentFee.name}`,
            `Montant payé : ${money(paymentAmount)}`,
            ...(isFeePaidOff ? ["Statut : Soldé"] : []),
            `Reste à payer : ${money(remainingAfterPayment)}`,
          ].join("\n"),
          createdAt: new Date().toISOString(),
          read: false,
        }
      : undefined;
    updateData({
      payments: [...data.payments, payment],
      notifications: notification ? [notification, ...data.notifications] : data.notifications,
      auditLogs: [createAuditLog(user, school.id, year.id, "Création paiement", `${payment.receiptNumber} - $${payment.amount}`), ...data.auditLogs],
    });
    paymentHistory.prependItem(payment);
    setAmount("");
    if (user.role === "cashier") {
      setCashierControlFeedback("Paiement enregistré avec succès.");
      setCashierControlFeedbackDrawer("payment");
    }
  }

  function saveExpense() {
    setCashierControlFeedback("");
    setCashierControlFeedbackDrawer(null);
    setExpenseError("");
    if (isArchivedContext) return;
    const trimmedCategory = expenseCategory.trim();
    const trimmedDescription = expenseDescription.trim();
    const trimmedBeneficiary = expenseBeneficiary.trim();
    const trimmedPaymentMethod = expensePaymentMethod.trim();
    const trimmedReference = expenseReference.trim();
    const nextAmount = Number(expenseAmount);
    if (!trimmedCategory) {
      setExpenseError("Le type de dépense est obligatoire.");
      return;
    }
    if (!expenseAmount.trim() || !Number.isFinite(nextAmount) || nextAmount <= 0) {
      setExpenseError("Le montant de la dépense est obligatoire.");
      return;
    }
    if (!trimmedDescription) {
      setExpenseError("La description de la dépense est obligatoire.");
      return;
    }
    if (!trimmedBeneficiary) {
      setExpenseError("Le bénéficiaire ou fournisseur est obligatoire.");
      return;
    }
    if (!trimmedPaymentMethod) {
      setExpenseError("Le mode de paiement est obligatoire.");
      return;
    }
    const expense: Expense = {
      id: uid("expense"),
      schoolId: school.id,
      schoolYearId: year.id,
      amount: nextAmount,
      category: trimmedCategory,
      description: trimmedDescription,
      beneficiary: trimmedBeneficiary,
      paymentMethod: trimmedPaymentMethod,
      reference: trimmedReference,
      spentAt: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      cashierName: user.name,
    };
    updateData({
      expenses: [expense, ...data.expenses],
      auditLogs: [createAuditLog(user, school.id, year.id, "Création dépense", `${expense.category} - $${expense.amount}`), ...data.auditLogs],
    });
    expenseHistory.prependItem(expense);
    setExpenseAmount("");
    setExpenseDescription("");
    setExpenseBeneficiary("");
    setExpensePaymentMethod("");
    setExpenseReference("");
    if (user.role === "cashier") {
      setCashierControlFeedback("Dépense enregistrée avec succès.");
      setCashierControlFeedbackDrawer("expense");
    }
  }

  function openEditExpense(expense: Expense) {
    if (!canManageExpenses) return;
    setExpenseEditTarget(expense);
    setExpenseEditAmount(String(expense.amount));
    setExpenseEditCategory(expense.category || "Fournitures");
    setExpenseEditDescription(expense.description || "");
    setExpenseEditError("");
  }

  function closeEditExpense() {
    setExpenseEditTarget(null);
    setExpenseEditAmount("");
    setExpenseEditCategory("Fournitures");
    setExpenseEditDescription("");
    setExpenseEditError("");
  }

  function updateExpense() {
    if (!expenseEditTarget || !canManageExpenses) return;
    setExpenseEditError("");
    const nextAmount = Number(expenseEditAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setExpenseEditError("Montant de dépense invalide.");
      return;
    }
    if (isOtherExpenseEditCategory && !expenseEditDescription.trim()) {
      setExpenseEditError("Veuillez préciser la nature de cette dépense.");
      return;
    }
    const nextDescription = expenseEditDescription.trim() || expenseEditCategory;
    const updatedExpense: Expense = { ...expenseEditTarget, amount: nextAmount, category: expenseEditCategory, description: nextDescription };
    updateData({
      expenses: data.expenses.map((item) =>
        item.id === expenseEditTarget.id
          ? updatedExpense
          : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Modification dépense", `${expenseEditTarget.category} - ${formatMoney(expenseEditTarget.amount)} → ${expenseEditCategory} - ${formatMoney(nextAmount)}`),
        ...data.auditLogs,
      ],
    });
    expenseHistory.updateItem(updatedExpense);
    closeEditExpense();
  }

  function deleteExpense(expense: Expense) {
    if (!canManageExpenses) return;
    updateData({
      expenses: data.expenses.filter((item) => item.id !== expense.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression dépense", `${expense.category} - ${formatMoney(expense.amount)}`), ...data.auditLogs],
    });
    expenseHistory.removeItem(expense.id);
    setExpenseDeleteTarget(null);
  }

  async function generateExpensePdf(expense: Expense) {
    const beneficiary = getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]);
    const paymentMethod = getExpenseField(expense, ["paymentMethod", "modePaiement", "paymentMode", "mode"]);
    const reference = getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"]);
    await renderAcadPdfPreview({
      filename: `depense-${expense.spentAt}-${expense.id}.pdf`,
      title: "Justificatif de dépense",
      school,
      year,
      sections: [
        pdfSection(
          "Dépense",
          pdfInfoGrid([
            { label: "Date", value: formatExpenseDateTime(expense) },
            { label: "Libellé / motif", value: expense.description || expense.category },
            { label: "Catégorie", value: expense.category },
            { label: "Montant", value: formatMoney(expense.amount) },
            { label: "Bénéficiaire / fournisseur", value: beneficiary || "-" },
            { label: "Caissier", value: resolveExpenseCashierName(expense, yearData.auditLogs) },
            { label: "Mode de paiement", value: paymentMethod || "-" },
            { label: "Référence / pièce", value: reference || "-" },
          ]),
        ),
      ],
    });
  }

  function sendPaymentWarnings() {
    setWarningFeedback(null);
    if (isArchivedContext) {
      setWarningFeedback({ type: "error", message: "Cette année scolaire est archivée en lecture seule." });
      return;
    }
    const requiredAmount = Number(warningRequiredAmount);
    if (!warningFeeName || !Number.isFinite(requiredAmount) || requiredAmount <= 0 || !warningDeadline) {
      setWarningFeedback({ type: "error", message: "Veuillez renseigner le type de frais, le montant requis et la date limite." });
      return;
    }

    const matchingFees = yearData.feeTypes.filter((fee) => fee.name === warningFeeName);
    const matchingFeeIds = new Set(matchingFees.map((fee) => fee.id));
    const warningFeeLabels = Array.from(new Set(matchingFees.map((fee) => String(fee.name).trim()).filter(Boolean)));
    const warningFeeSummary = warningFeeLabels.length ? warningFeeLabels.join(", ") : warningFeeName;
    const parentById = new Map(yearData.parents.map((parent) => [parent.id, parent]));
    const now = new Date().toISOString();
    const sentAtLabel = new Date(now).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const affectedStudents = yearData.students.filter((student) => {
      const paid = yearData.payments
        .filter((payment) => payment.studentId === student.id && matchingFeeIds.has(payment.feeTypeId))
        .reduce((sum, payment) => sum + payment.amount, 0);
      return paid < requiredAmount;
    });
    const warnings = affectedStudents
      .map((student) => {
        const parent = student.parentId ? parentById.get(student.parentId) : undefined;
        if (!parent) return null;
        const studentName = studentFullName(student);
        const body = [
          "Cher Parent,",
          "",
          `Nous vous informons que le paiement de ${warningFeeSummary} relatif à votre enfant ${studentName} n'a pas encore atteint le montant requis par l'établissement.`,
          "",
          `Détails Type de frais : ${warningFeeSummary}.`,
          `Montant requis : $${requiredAmount.toFixed(2)}`,
          `Date limite de régularisation : ${warningDeadline}.`,
          "",
          "Nous vous invitons à régulariser votre situation avant cette échéance afin d'éviter tout désagrément et de permettre à votre enfant de poursuivre sa scolarité dans les meilleures conditions.",
          "",
          `Cordialement, L'Administration de ${school.name}.`,
          "",
          sentAtLabel,
        ].join("\n");
        return {
          parent,
          notification: {
            id: uid("notif"),
            schoolId: school.id,
            schoolYearId: year.id,
            recipientRole: "parent" as const,
            parentId: parent.id,
            studentId: student.id,
            type: "payment" as const,
            title: "Avertissement de paiement",
            body,
            createdAt: now,
            read: false,
          },
        };
      })
      .filter(Boolean) as { parent: ParentProfile; notification: AppNotification }[];

    if (warnings.length === 0) {
      setWarningFeedback({ type: "info", message: "Aucun parent ne correspond aux critères sélectionnés." });
      return;
    }

    const campaignId = uid("warn");
    const notifiedParents = new Set(warnings.map((item) => item.parent.id));
    const status = warnings.length === affectedStudents.length ? "Succès" : "Partiel";
    const auditLog = createAuditLog(
      user,
      school.id,
      year.id,
      "Avertissement paiement",
      JSON.stringify({
        kind: "payment_warning_campaign",
        campaignId,
        schoolName: school.name,
        actorRole: user.role === "cashier" ? "Caissier" : "Administrateur",
        feeName: warningFeeName,
        requiredAmount,
        deadline: warningDeadline,
        affectedStudents: affectedStudents.length,
        notifiedParents: notifiedParents.size,
        sentMessages: warnings.length,
        status,
      }),
    );
    updateData({
      notifications: [...warnings.map((item) => item.notification), ...data.notifications],
      auditLogs: [auditLog, ...data.auditLogs],
    });
    setWarningFeedback({
      type: "success",
      message: `${affectedStudents.length} élève(s) concerné(s), ${notifiedParents.size} parent(s) notifié(s), ${warnings.length} avertissement(s) envoyé(s).`,
    });
  }

  function correctPayment(payment: Payment) {
    if (!canCorrectPayments) return;
    const nextAmount = prompt("Nouveau montant du paiement", String(payment.amount));
    if (!nextAmount) return;
    const correctedAmount = Number(nextAmount);
    if (!Number.isFinite(correctedAmount) || correctedAmount <= 0) {
      alert("Montant de paiement invalide.");
      return;
    }
    const paymentStudent = controlIndexes.studentsById.get(payment.studentId);
    const paymentFee = paymentStudent
      ? (() => {
          const fee = controlIndexes.feeTypesById.get(payment.feeTypeId);
          return fee && feeAppliesToStudent(fee, paymentStudent) ? fee : undefined;
        })()
      : undefined;
    const paidForFee = paymentStudent && paymentFee
      ? Math.max(0, sumPaymentsForStudentFee(controlIndexes, paymentStudent.id, paymentFee.id) - payment.amount)
      : 0;
    if (!paymentFee || paidForFee + correctedAmount > paymentFee.amount) {
      alert("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const reason = prompt("Motif obligatoire de correction");
    if (!reason) return;
    const correctedPayment: Payment = { ...payment, amount: correctedAmount, updatedAt: new Date().toISOString(), correctionReason: reason };
    updateData({
      payments: data.payments.map((item) =>
        item.id === payment.id ? correctedPayment : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Correction paiement", `${payment.receiptNumber ?? payment.id}: ancien $${payment.amount}, nouveau $${correctedAmount}. Motif: ${reason}`),
        ...data.auditLogs,
      ],
    });
    paymentHistory.updateItem(correctedPayment);
  }

  function deletePayment(payment: Payment) {
    if (!canCorrectPayments) return;
    const reason = prompt("Motif obligatoire de suppression du paiement");
    if (!reason) return;
    updateData({
      payments: data.payments.filter((item) => item.id !== payment.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression paiement", `${payment.receiptNumber ?? payment.id}: $${payment.amount}. Motif: ${reason}`), ...data.auditLogs],
    });
    paymentHistory.removeItem(payment.id);
  }

  function renderPaymentWarningForm() {
    return (
      <div className="grid min-w-0 gap-4">
        {warningFeedback && (
          <p
            className={`rounded border p-3 text-sm font-semibold ${
              warningFeedback.type === "success"
                ? "border-mint/30 bg-mint/10 text-mint"
                : warningFeedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            {warningFeedback.message}
          </p>
        )}
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Type de frais
          <select value={warningFeeName} onChange={(event) => setWarningFeeName(event.target.value)} className="input">
            {feeNameChoices.map((feeName) => (
              <option key={feeName} value={feeName}>{feeName}</option>
            ))}
          </select>
        </label>
        <Field label="Montant requis" value={warningRequiredAmount} onChange={setWarningRequiredAmount} type="number" />
        <Field label="Date limite de régularisation" value={warningDeadline} onChange={setWarningDeadline} type="date" />
        <button onClick={sendPaymentWarnings} disabled={!feeNameChoices.length} className="primary-button justify-center disabled:opacity-50" type="button">
          <Bell className="h-4 w-4" /> Envoyer
        </button>
        {!feeNameChoices.length && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun type de frais n'est encore défini.</p>}
      </div>
    );
  }

  async function printFilteredStudents() {
    const feeFilter = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    const selectedPdfFeeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
    const filterLabel =
      amountComparator === "all" || !amountThreshold
        ? "Montant payé : tous"
        : selectedPdfFeeGroup && feeFilter
          ? `${selectedPdfFeeGroup.name} ${feeFilter[2] === "gte" ? ">=" : "<"} ${amountThreshold}`
          : `Montant payé ${amountComparator} ${amountThreshold}`;
    const pdfBalanceForRow = (row: (typeof rows)[number]) => {
      if (!selectedPdfFeeGroup) return row.balance;
      const expected = yearData.feeTypes
        .filter((fee) => selectedPdfFeeGroup.ids.includes(fee.id) && feeAppliesToStudent(fee, row.student))
        .reduce((sum, fee) => sum + fee.amount, 0);
      const paid = selectedPdfFeeGroup.ids.reduce((sum, feeId) => sum + sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId), 0);
      return { expected, paid, remaining: Math.max(expected - paid, 0) };
    };
    const showOptionColumn = rows.some(({ student }) => Boolean(student.option));
    const studentPaymentColumns: PdfTableColumn<(typeof rows)[number]>[] = [
      { header: "Nom de l'élève", render: ({ student }) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() },
      { header: "Matricule", render: ({ student }) => student.matricule },
      { header: "Classe", render: ({ student }) => formatStudentPdfClassName(student) },
      { header: "Montant prévu", render: (row) => formatMoney(pdfBalanceForRow(row).expected), align: "right" },
      { header: "Montant payé", render: (row) => formatMoney(pdfBalanceForRow(row).paid), align: "right" },
      { header: "Solde restant", render: (row) => formatMoney(pdfBalanceForRow(row).remaining), align: "right" },
    ];
    if (showOptionColumn) {
      studentPaymentColumns.splice(3, 0, { header: "Option", render: ({ student }) => student.option || "-" });
    }
    await renderAcadPdfPreview({
      filename: `controle-paiements-${year.name}.pdf`,
      title: "Contrôle des paiements",
      school,
      year,
      subtitle: `Critère : ${filterLabel}`,
      sections: [
        pdfSection(
          "Élèves filtrés",
          pdfTable(
            studentPaymentColumns,
            [...rows].sort((first, second) => compareStudentsForPdfByClass(first.student, second.student)),
            "Aucun élève ne correspond aux filtres appliqués.",
          ),
        ),
      ],
    });
  }

  async function createStudentHistoryPdf(action: "view" | "print") {
    if (!selectedHistoryStudent) return;

    await renderAcadPdfPreview({
      filename: `historique-${selectedHistoryStudent.matricule}.pdf`,
      title: action === "print" ? "Historique individuel des paiements" : "Historique individuel des paiements",
      school,
      year,
      sections: [
        pdfSection(
          "Identité de l'élève",
          pdfInfoGrid([
            { label: "Nom complet", value: studentFullName(selectedHistoryStudent) },
            { label: "Matricule", value: selectedHistoryStudent.matricule },
            { label: "Classe", value: formatStudentClassName(selectedHistoryStudent) },
            { label: "Total attendu", value: formatMoney(selectedHistoryFeeTotals.expected) },
            { label: "Total payé", value: formatMoney(selectedHistoryFeeTotals.paid) },
            { label: "Total restant", value: formatMoney(selectedHistoryFeeTotals.remaining) },
          ]),
        ),
        pdfSection(
          "Résumé par type de frais",
          pdfTable(
            [
              { header: "Type de frais", render: (row) => row.feeName },
              { header: "Total attendu", render: (row) => formatMoney(row.expected), align: "right" },
              { header: "Total payé", render: (row) => formatMoney(row.paid), align: "right" },
              { header: "Total restant", render: (row) => formatMoney(row.remaining), align: "right" },
            ],
            selectedHistoryFeeSummaries,
            "Aucun type de frais applicable pour cet élève.",
            {
              footerHtml: `
                <tr>
                  <td>Totaux généraux</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.expected))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.paid))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.remaining))}</td>
                </tr>
              `,
            },
          ),
        ),
        pdfSection(
          "Paiements",
          pdfTable(
            [
              { header: "Date", render: (row) => formatPaymentDate(row.payment.paidAt) },
              { header: "Type de frais", render: (row) => row.feeName },
              { header: "Montant payé", render: (row) => formatMoney(row.payment.amount), align: "right" },
              { header: "Solde restant", render: (row) => formatMoney(row.remaining), align: "right" },
            ],
            selectedHistoryRows,
            "Aucun paiement enregistré pour cet élève.",
            {
              footerHtml: `
                <tr>
                  <td colspan="2">Totaux</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryBalance.paid))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryBalance.remaining))}</td>
                </tr>
              `,
            },
          ),
        ),
      ],
    });
  }

  function renderPaymentHistoryPagination() {
    return (
      <>
        <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
          Recherche appliquée aux paiements déjà chargés. Utilisez Charger plus pour afficher les pages suivantes.
        </p>
        {paymentHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement de l'historique...</p>}
        {paymentHistory.loadError && (
          <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">{paymentHistory.loadError}</p>
            <button onClick={() => void paymentHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
          </div>
        )}
        {paymentHistory.hasMore && (
          <button
            onClick={() => void paymentHistory.loadMore()}
            disabled={paymentHistory.isLoadingMore}
            className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            {paymentHistory.isLoadingMore ? "Chargement..." : "Charger plus"}
          </button>
        )}
      </>
    );
  }

  function renderExpenseHistoryContent() {
    return (
      <div className="space-y-2">
        <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
          Historique chargé par pages de 50 éléments, du plus récent au plus ancien.
        </p>
        {expenseHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement de l'historique...</p>}
        {expenseHistory.loadError && (
          <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">{expenseHistory.loadError}</p>
            <button onClick={() => void expenseHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
          </div>
        )}
        {sortedExpenses.length === 0 && !expenseHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucune dépense enregistrée.</p>}
        {sortedExpenses.map((expense) => {
          const beneficiary = getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]);
          const paymentMethod = getExpenseField(expense, ["paymentMethod", "modePaiement", "paymentMode", "mode"]);
          const reference = getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"]);
          return (
            <div key={expense.id} className="rounded border border-slate-100 p-3 text-sm">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">{expense.description || expense.category}</p>
                  <p className="break-words text-slate-500">{formatExpenseDateTime(expense)} | {expense.category} | {formatMoney(expense.amount)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button onClick={() => generateExpensePdf(expense)} className="rounded bg-slate-100 p-2" title="Télécharger le justificatif PDF" type="button">
                    <Download className="h-4 w-4" />
                  </button>
                  {user.role !== "cashier" && canManageExpenses && <button onClick={() => openEditExpense(expense)} className="rounded bg-slate-100 p-2" title="Modifier" type="button">
                    <Edit3 className="h-4 w-4" />
                  </button>}
                  {user.role !== "cashier" && canManageExpenses && <button onClick={() => setExpenseDeleteTarget(expense)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer" type="button">
                    <Trash2 className="h-4 w-4" />
                  </button>}
                </div>
              </div>
              <dl className="mt-3 grid min-w-0 gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <div><dt className="font-semibold text-slate-600">Bénéficiaire / fournisseur</dt><dd className="break-words">{beneficiary || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Enregistré par</dt><dd className="break-words">{expense.cashierName || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Mode de paiement</dt><dd className="break-words">{paymentMethod || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Référence / pièce</dt><dd className="break-words">{reference || "-"}</dd></div>
              </dl>
            </div>
          );
        })}
        {expenseHistory.hasMore && (
          <button
            onClick={() => void expenseHistory.loadMore()}
            disabled={expenseHistory.isLoadingMore}
            className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            {expenseHistory.isLoadingMore ? "Chargement..." : "Charger plus"}
          </button>
        )}
      </div>
    );
  }

  if (selectedHistoryStudent) {
    return (
      <section className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              onClick={() => setSelectedHistoryStudentId("")}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-700 transition hover:bg-slate-200 hover:text-ink"
              aria-label="Retour au controle"
              title="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase text-mint">Historique individuel</p>
              <h1 className="break-words text-2xl font-bold text-ink">{studentFullName(selectedHistoryStudent)}</h1>
              <p className="break-words text-sm text-slate-500">
                {selectedHistoryStudent.matricule} | {formatStudentClassName(selectedHistoryStudent)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:justify-start">
            <button onClick={() => createStudentHistoryPdf("print")} className="primary-button justify-center" type="button">
              <Download className="h-4 w-4" /> Imprimer PDF
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <Metric label="Total attendu" value={formatMoney(selectedHistoryFeeTotals.expected)} />
          <Metric label="Total payé" value={formatMoney(selectedHistoryFeeTotals.paid)} />
          <Metric label="Total restant" value={formatMoney(selectedHistoryFeeTotals.remaining)} />
        </div>

        <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 min-w-0">
            <h2 className="break-words text-lg font-bold text-ink">Résumé par type de frais</h2>
            <p className="text-sm text-slate-500">Montants attendus, payés et restants pour les frais applicables à cet élève.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Type de frais</th>
                  <th className="px-3 py-2 text-right">Total attendu</th>
                  <th className="px-3 py-2 text-right">Total payé</th>
                  <th className="px-3 py-2 text-right">Total restant</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistoryFeeSummaries.map((summary) => (
                  <tr key={summary.feeTypeId} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-ink">{summary.feeName}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatMoney(summary.expected)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-mint">{formatMoney(summary.paid)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-ink">{formatMoney(summary.remaining)}</td>
                  </tr>
                ))}
                {selectedHistoryFeeSummaries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Aucun type de frais applicable pour cet élève.
                    </td>
                  </tr>
                )}
              </tbody>
              {selectedHistoryFeeSummaries.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-ink">
                  <tr>
                    <td className="px-3 py-3">Totaux généraux</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.expected)}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.paid)}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.remaining)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 min-w-0">
            <h2 className="break-words text-lg font-bold text-ink">Paiements de l'eleve</h2>
            <p className="text-sm text-slate-500">Liste chronologique limitee a cet eleve.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type de frais</th>
                  <th className="px-3 py-2">Montant paye</th>
                  <th className="px-3 py-2">Solde restant</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistoryRows.map((row) => (
                  <tr key={row.payment.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-ink">{formatPaymentDate(row.payment.paidAt)}</td>
                    <td className="px-3 py-3 text-slate-700">{row.feeName}</td>
                    <td className="px-3 py-3 font-semibold text-mint">{formatMoney(row.payment.amount)}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{formatMoney(row.remaining)}</td>
                  </tr>
                ))}
                {selectedHistoryRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Aucun paiement enregistre pour cet eleve.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0">
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en dollar américain." />
        {user.role === "cashier" ? (
          <div className={`mb-3 grid min-w-0 max-w-full gap-2 lg:w-full lg:gap-2 ${canPay ? "lg:grid-cols-[minmax(105px,0.8fr)_minmax(70px,0.6fr)_repeat(5,minmax(0,1fr))]" : "lg:grid-cols-[minmax(120px,1fr)_minmax(90px,0.8fr)_repeat(3,minmax(0,1fr))]"}`}>
            <div className="flex min-w-0 flex-nowrap items-stretch gap-1.5 lg:contents">
              <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)} className="h-10 min-w-0 flex-[1.1] rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full">
                <option value="all">Montant payé</option>
                {amountFeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="h-10 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full" placeholder="Filtre" />
              <button onClick={printFilteredStudents} className="primary-button h-10 min-w-0 flex-1 justify-center px-2 text-xs sm:text-sm lg:w-full">
                <Download className="h-4 w-4" /> Imprimer
              </button>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:contents">
              <button onClick={() => setCashierControlDrawer("history")} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique des paiements
              </button>
              <button onClick={() => setExpenseHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique de dépenses
              </button>
              {canPay && (
                <>
                  <button onClick={() => { setCashierControlFeedback(""); setCashierControlFeedbackDrawer(null); setCashierControlDrawer("payment"); }} className="primary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                    Enregistrer un paiement
                  </button>
                  <button onClick={() => { setCashierControlFeedback(""); setCashierControlFeedbackDrawer(null); setCashierControlDrawer("expense"); }} className="primary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                    Enregistrer une dépense
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-3 grid min-w-0 max-w-full gap-2 lg:w-full lg:grid-cols-[minmax(120px,1fr)_minmax(90px,0.8fr)_repeat(4,minmax(0,1fr))] lg:gap-2">
            <div className="flex min-w-0 flex-nowrap items-stretch gap-1.5 lg:contents">
              <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)} className="h-10 min-w-0 flex-[1.1] rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full">
                <option value="all">Montant payé</option>
                {amountFeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="h-10 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full" placeholder="Filtre" />
              <button onClick={printFilteredStudents} className="primary-button h-10 min-w-0 flex-1 justify-center px-2 text-xs sm:text-sm lg:w-full">
                <Download className="h-4 w-4" /> Imprimer
              </button>
            </div>
            <div className="grid min-w-0 gap-2 lg:contents">
              <button onClick={() => setHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique des paiements
              </button>
              <button onClick={() => setExpenseHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique de dépenses
              </button>
              <button onClick={() => setWarningOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Avertissement
              </button>
            </div>
          </div>
        )}
        <div className="grid min-w-0 gap-3">
          {rows.map(({ student, balance, progress, hasApplicableFees }) => (
            <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <button
                    onClick={() => setSelectedHistoryStudentId(student.id)}
                    className="break-words text-left font-bold text-ink underline-offset-4 transition hover:text-blue-700 hover:underline"
                    type="button"
                  >
                    {student.nom} {student.prenom}
                  </button>
                  <p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${isStudentPaymentComplete(balance) ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                  {isStudentPaymentComplete(balance) ? "En ordre" : "Non en ordre"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Prévu" value={formatMoney(balance.expected)} />
                <Metric label="Payé" value={formatMoney(balance.paid)} />
                <Metric label="Solde" value={formatMoney(balance.remaining)} />
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
                <div className={`h-full rounded transition-colors ${progressBarTone(progress)}`} style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-2 flex min-w-0 flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>{progress}% payé</span>
                {!hasApplicableFees && <span className="font-semibold text-slate-500">Aucun frais défini pour cette classe.</span>}
              </div>
            </article>
          ))}
        </div>
      </div>
      {user.role !== "cashier" && (
      <div className="min-w-0 space-y-4">
        {canPay && (
          <FormPanel title="Enregistrer un paiement">
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="input">
              {yearData.students.map((student) => (
                <option key={student.id} value={student.id}>{student.nom} {student.prenom}</option>
              ))}
            </select>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <Metric label="Attendu" value={`$${selectedPaymentBalance.expected}`} />
              <Metric label="Payé" value={`$${selectedPaymentBalance.paid}`} />
              <Metric label="Solde" value={`$${selectedPaymentBalance.remaining}`} />
            </div>
            {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
            <select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60">
              {payableFeeTypes.map((fee) => (
                <option key={fee.id} value={fee.id}>{fee.name} - ${fee.amount}</option>
              ))}
            </select>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" placeholder="Montant" />
            <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button justify-center disabled:opacity-50"><Plus className="h-4 w-4" /> Enregistrer</button>
          </FormPanel>
        )}
        {canPay && (
          <FormPanel title="Enregistrer une dépense">
            <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} className="input">
              <option>Fournitures</option>
              <option>Transport</option>
              <option>Salaire</option>
              <option>Maintenance</option>
              <option>Autres</option>
            </select>
            <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
            <textarea value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} className="input min-h-24" placeholder="Description" />
            <button onClick={saveExpense} className="primary-button justify-center"><Plus className="h-4 w-4" /> Enregistrer</button>
          </FormPanel>
        )}
      </div>
      )}
      {user.role === "cashier" && cashierControlDrawer && (
        <AdminDrawer title={cashierDrawerTitle} onClose={() => setCashierControlDrawer(null)} closeLabel={`Fermer ${cashierDrawerTitle}`}>
          {cashierControlFeedback && cashierControlFeedbackDrawer === cashierControlDrawer && (
            <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{cashierControlFeedback}</p>
          )}
          {cashierControlDrawer === "payment" && (
            <>
              <div className="grid min-w-0 gap-2">
                <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={paymentStudentQuery}
                    onChange={(event) => updatePaymentStudentQuery(event.target.value)}
                    className="min-w-0 flex-1 outline-none"
                    placeholder="Rechercher par nom, postnom, prénom ou matricule"
                  />
                </label>
                {paymentStudentQuery.trim() === "" && (
                  <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez un nom ou un matricule pour afficher les élèves.</p>
                )}
                {paymentStudentQuery.trim() !== "" && paymentStudentResults.length === 0 && (
                  <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève trouvé.</p>
                )}
                {!selectedPaymentStudent && paymentStudentResults.length > 0 && (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {paymentStudentResults.map((student) => (
                      <button
                        key={student.id}
                        onClick={() => selectPaymentStudent(student)}
                        className={`w-full rounded border p-3 text-left text-sm transition ${
                          student.id === studentId ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"
                        }`}
                        type="button"
                      >
                        <p className="break-words font-semibold text-ink">{student.nom} {student.postnom} {student.prenom}</p>
                        <p className="text-xs text-slate-500">{student.matricule} | {formatStudentClassName(student)}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedPaymentStudent && (
                  <p className="rounded bg-mint/10 p-3 text-sm font-semibold text-mint">
                    Élève sélectionné : {selectedPaymentStudent.nom} {selectedPaymentStudent.postnom} {selectedPaymentStudent.prenom}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Attendu" value={`$${selectedPaymentBalance.expected}`} />
                <Metric label="Payé" value={`$${selectedPaymentBalance.paid}`} />
                <Metric label="Solde" value={`$${selectedPaymentBalance.remaining}`} />
              </div>
              {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
              <select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60">
                {payableFeeTypes.map((fee) => (
                  <option key={fee.id} value={fee.id}>{fee.name} - ${fee.amount}</option>
                ))}
              </select>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" placeholder="Montant" />
              <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button justify-center disabled:opacity-50" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
            </>
          )}
          {cashierControlDrawer === "expense" && (
            <>
              <select
                value={expenseCategory}
                onChange={(event) => {
                  const nextCategory = event.target.value;
                  setExpenseCategory(nextCategory);
                  setExpenseError("");
                }}
                className="input"
              >
                <option>Fournitures</option>
                <option>Transport</option>
                <option>Salaire</option>
                <option>Maintenance</option>
                <option>Autre</option>
              </select>
              <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                Description
                <textarea
                  value={expenseDescription}
                  onChange={(event) => {
                    setExpenseDescription(event.target.value);
                    setExpenseError("");
                  }}
                  className="input min-h-24"
                  placeholder="Écrivez la description"
                />
              </label>
              <input
                value={expenseBeneficiary}
                onChange={(event) => {
                  setExpenseBeneficiary(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Bénéficiaire / fournisseur"
              />
              <input
                value={expensePaymentMethod}
                onChange={(event) => {
                  setExpensePaymentMethod(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Mode de paiement"
              />
              <input
                value={expenseReference}
                onChange={(event) => {
                  setExpenseReference(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Référence / pièce (facultatif)"
              />
              {expenseError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseError}</p>}
              <button onClick={saveExpense} className="primary-button justify-center" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
            </>
          )}
          {cashierControlDrawer === "history" && (
            <>
              <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  className="min-w-0 flex-1 outline-none"
                  placeholder="Rechercher par nom ou matricule"
                />
              </label>
              <div className="space-y-2">
                {filteredHistoryPayments.length === 0 && !paymentHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
                {filteredHistoryPayments.map(({ payment, student, fee }) => {
                  return (
                    <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <button onClick={() => generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF" type="button">
                            <Download className="h-4 w-4" />
                          </button>
                          {canCorrectPayments && <button onClick={() => correctPayment(payment)} className="rounded bg-slate-100 p-2" title="Corriger" type="button"><Edit3 className="h-4 w-4" /></button>}
                          {canCorrectPayments && <button onClick={() => deletePayment(payment)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer" type="button"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </div>
                      <p className="break-words text-slate-500">{fee.name} | ${payment.amount} | {payment.paidAt}</p>
                    </div>
                  );
                })}
              </div>
              {renderPaymentHistoryPagination()}
            </>
          )}
          {cashierControlDrawer === "warning" && renderPaymentWarningForm()}
        </AdminDrawer>
      )}
      {warningOpen && (
        <AdminDrawer title="Avertissement" onClose={() => setWarningOpen(false)} closeLabel="Fermer l'avertissement">
          {renderPaymentWarningForm()}
        </AdminDrawer>
      )}
      {historyOpen && (
        <AdminDrawer title="Historique des paiements" onClose={() => setHistoryOpen(false)} closeLabel="Fermer l'historique">
            <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Rechercher par nom ou matricule"
              />
            </label>
            <div className="space-y-2">
              {filteredHistoryPayments.length === 0 && !paymentHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
              {filteredHistoryPayments.map(({ payment, student, fee }) => {
                return (
                  <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button onClick={() => generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF">
                          <Download className="h-4 w-4" />
                        </button>
                        {canCorrectPayments && <button onClick={() => correctPayment(payment)} className="rounded bg-slate-100 p-2" title="Corriger"><Edit3 className="h-4 w-4" /></button>}
                        {canCorrectPayments && <button onClick={() => deletePayment(payment)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                    <p className="break-words text-slate-500">{fee.name} | ${payment.amount} | {payment.paidAt}</p>
                  </div>
                );
              })}
            </div>
            {renderPaymentHistoryPagination()}
        </AdminDrawer>
      )}
      {expenseHistoryOpen && (
        <AdminDrawer title="Historique de dépenses" onClose={() => setExpenseHistoryOpen(false)} closeLabel="Fermer l'historique des dépenses">
          {renderExpenseHistoryContent()}
        </AdminDrawer>
      )}
      {expenseEditTarget && (
        <AdminDrawer title="Modifier la dépense" onClose={closeEditExpense} closeLabel="Fermer la modification de dépense">
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Catégorie
            <select
              value={expenseEditCategory}
              onChange={(event) => {
                setExpenseEditCategory(event.target.value);
                setExpenseEditError("");
              }}
              className="input"
            >
              <option>Fournitures</option>
              <option>Transport</option>
              <option>Salaire</option>
              <option>Maintenance</option>
              <option>Autre</option>
            </select>
          </label>
          <Field label="Montant" value={expenseEditAmount} onChange={setExpenseEditAmount} type="number" />
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Libellé ou motif
            <textarea
              value={expenseEditDescription}
              onChange={(event) => {
                setExpenseEditDescription(event.target.value);
                setExpenseEditError("");
              }}
              className="input min-h-24"
              placeholder="Description de la dépense"
            />
          </label>
          {expenseEditError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseEditError}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={closeEditExpense} className="secondary-button justify-center" type="button">Annuler</button>
            <button onClick={updateExpense} disabled={!canManageExpenses} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Enregistrer
            </button>
          </div>
        </AdminDrawer>
      )}
      {expenseDeleteTarget && (
        <AdminDrawer title="Supprimer la dépense" onClose={() => setExpenseDeleteTarget(null)} closeLabel="Annuler la suppression de dépense">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            Confirmez-vous la suppression de cette dépense ? Cette action ne supprimera aucune autre donnée.
          </p>
          <div className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">{expenseDeleteTarget.description || expenseDeleteTarget.category}</p>
            <p className="text-slate-500">{formatExpenseDateTime(expenseDeleteTarget)} | {formatMoney(expenseDeleteTarget.amount)} | {expenseDeleteTarget.cashierName}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={() => setExpenseDeleteTarget(null)} className="secondary-button justify-center" type="button">Annuler</button>
            <button onClick={() => deleteExpense(expenseDeleteTarget)} disabled={!canManageExpenses} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Supprimer
            </button>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}

function ReportsModule({
  yearData,
  school,
  year,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
  const sectionLabels: Record<"all" | SchoolSection, string> = {
    all: "Toutes les sections",
    maternelle: "Maternelle",
    primaire: "Primaire",
    secondaire: "Secondaire",
  };
  const reportSectionChoices = useMemo(
    () =>
      getSchoolEducationLevels(school)
        .map((level) => (level === "Maternelle" ? "maternelle" : level === "Primaire" ? "primaire" : level === "Secondaire" ? "secondaire" : ""))
        .filter(Boolean) as SchoolSection[],
    [school],
  );
  useEffect(() => {
    if (sectionFilter !== "all" && !reportSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [reportSectionChoices, sectionFilter]);
  const filteredStudents = yearData.students.filter((student) => sectionFilter === "all" || getClassSection(student.className) === sectionFilter);
  const filteredStudentIds = new Set(filteredStudents.map((student) => student.id));
  const payments = yearData.payments.filter((payment) => payment.paidAt >= startDate && payment.paidAt <= endDate && filteredStudentIds.has(payment.studentId));
  const expenses = yearData.expenses.filter((expense) => expense.spentAt >= startDate && expense.spentAt <= endDate);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expected = buildStats(filteredStudents, yearData.parents, yearData.feeTypes, payments).expected;
  const recovery = expected > 0 ? Math.round((paid / expected) * 100) : 0;
  const usesSectionFilter = sectionFilter !== "all";

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Date début" value={startDate} onChange={setStartDate} type="date" />
          <Field label="Date fin" value={endDate} onChange={setEndDate} type="date" />
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Section
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as "all" | SchoolSection)} className="input">
              <option value="all">Toutes</option>
              {reportSectionChoices.map((section) => (
                <option key={section} value={section}>{sectionLabels[section]}</option>
              ))}
            </select>
          </label>
          <button onClick={() => exportReportPdf(school, year, startDate, endDate, sectionLabels[sectionFilter], usesSectionFilter, paid, spent, recovery, payments, expenses, filteredStudents)} className="primary-button self-end">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
        {usesSectionFilter && (
          <p className="mt-3 rounded bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            Les dépenses présentées sont globales pour l'école, car elles ne sont pas rattachées à une section.
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Paiements" value={`$${paid.toFixed(2)}`} />
        <Metric label="Dépenses" value={`$${spent.toFixed(2)}`} />
        <Metric label="Solde net" value={`$${(paid - spent).toFixed(2)}`} />
        <Metric label="Recouvrement période" value={`${recovery}%`} />
      </div>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <FormPanel title="Paiements">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {payments.map((payment) => {
              const student = filteredStudents.find((item) => item.id === payment.studentId);
              return (
                <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                  <p className="break-words font-semibold text-ink">{student ? `${student.nom} ${student.prenom}` : "Élève"}</p>
                  <p className="break-words text-slate-500">${payment.amount} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
            {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement sur cette période.</p>}
          </div>
        </FormPanel>
        <FormPanel title="Dépenses">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {expenses.map((expense) => (
              <div key={expense.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                <p className="break-words font-semibold text-ink">{expense.category}</p>
                <p className="break-words text-slate-500">${expense.amount} | {expense.spentAt} | {expense.cashierName}</p>
                <p className="break-words text-slate-500">{expense.description}</p>
              </div>
            ))}
            {expenses.length === 0 && <p className="text-sm text-slate-500">Aucune dépense sur cette période.</p>}
          </div>
        </FormPanel>
      </div>
    </section>
  );
}

function MessagesModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
}) {
  const [recipientParentId, setRecipientParentId] = useState<string>("");
  const [adminRecipientMode, setAdminRecipientMode] = useState<"all" | "parents" | "sections" | "classes">("all");
  const [selectedAdminParentIds, setSelectedAdminParentIds] = useState<string[]>([]);
  const [selectedAdminSection, setSelectedAdminSection] = useState<SchoolSection | "">("");
  const [selectedAdminClass, setSelectedAdminClass] = useState<SchoolClass | "">("");
  const [selectedDisciplineParentIds, setSelectedDisciplineParentIds] = useState<string[]>([]);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [messageFeedback, setMessageFeedback] = useState("");
  const canSend = user.role !== "parent" && year.status !== "archived";
  const isSchoolAdmin = user.role === "school_admin";
  const isCashier = user.role === "cashier";
  const isDisciplineDirector = user.role === "discipline_director";
  const disciplineMessageSubjects = ["Avertissement disciplinaire", "Convocation", "Décision disciplinaire", "Notification de fin de sanction"];
  const sameSchoolParents = yearData.parents.filter((parent) => parent.schoolId === school.id);
  const sameSchoolStudents = yearData.students.filter((student) => student.schoolId === school.id);
  const sectionLabels: Record<SchoolSection, string> = {
    maternelle: "Maternelle",
    primaire: "Primaire",
    secondaire: "Secondaire",
  };
  const adminSectionChoices = Array.from(new Set(sameSchoolStudents.map((student) => getClassSection(student.className))));
  const adminClassChoices = Array.from(new Set(sameSchoolStudents.map((student) => student.className))).sort((first, second) => first.localeCompare(second, "fr"));
  const recipientCandidates = sameSchoolParents.map((parent) => ({
    parent,
    children: sameSchoolStudents.filter((student) => student.parentId === parent.id || parent.studentIds.includes(student.id)),
  }));
  const disciplineRecipientCandidates = recipientCandidates.filter(({ children }) => children.length > 0);
  const recipientResults = recipientCandidates.filter(({ parent, children }) => {
      const search = recipientSearch.trim().toLowerCase();
      if (!search) return false;
      const studentText = children.map((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule} ${formatStudentClassName(student)}`).join(" ");
      return `${parent.fullName} ${parent.phone} ${parent.email} ${parent.address} ${studentText}`.toLowerCase().includes(search);
    });
  const disciplineRecipientResults = disciplineRecipientCandidates.filter(({ parent, children }) => {
      const search = recipientSearch.trim().toLowerCase();
      if (!search) return false;
      const studentText = children.map((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`).join(" ");
      return `${parent.fullName} ${studentText}`.toLowerCase().includes(search);
    });
  const hasRecipientSearch = recipientSearch.trim().length > 0;
  const selectedParent = yearData.parents.find((parent) => parent.id === recipientParentId);
  const selectedAdminParents = sameSchoolParents.filter((parent) => selectedAdminParentIds.includes(parent.id));
  const selectedDisciplineParents = yearData.parents.filter((parent) => selectedDisciplineParentIds.includes(parent.id));

  function uniqueParents(parents: ParentProfile[]) {
    return Array.from(new Map(parents.filter((parent) => parent.schoolId === school.id).map((parent) => [parent.id, parent])).values());
  }

  function parentForStudent(student: Student) {
    const directParent = student.parentId ? sameSchoolParents.find((parent) => parent.id === student.parentId) : undefined;
    return directParent ?? sameSchoolParents.find((parent) => parent.studentIds.includes(student.id));
  }

  function resolveParentsForStudents(students: Student[]) {
    return uniqueParents(students.map(parentForStudent).filter((parent): parent is ParentProfile => Boolean(parent)));
  }

  function resolveAdminRecipientParents() {
    if (adminRecipientMode === "all") return uniqueParents(sameSchoolParents);
    if (adminRecipientMode === "parents") return uniqueParents(selectedAdminParents);
    if (adminRecipientMode === "sections") {
      if (!selectedAdminSection) return [];
      return resolveParentsForStudents(sameSchoolStudents.filter((student) => getClassSection(student.className) === selectedAdminSection));
    }
    if (!selectedAdminClass) return [];
    return resolveParentsForStudents(sameSchoolStudents.filter((student) => student.className === selectedAdminClass));
  }

  const adminResolvedParents = isSchoolAdmin ? resolveAdminRecipientParents() : [];

  useEffect(() => {
    if (!isDisciplineDirector || !messageFeedback) return undefined;
    const persistentErrorMarkers = ["Impossible", "Échec", "Echec", "non envoyé", "permission", "connexion indisponible"];
    if (persistentErrorMarkers.some((marker) => messageFeedback.includes(marker))) return undefined;
    const timer = window.setTimeout(() => setMessageFeedback(""), 4000);
    return () => window.clearTimeout(timer);
  }, [isDisciplineDirector, messageFeedback]);

  function toggleDisciplineParent(parentId: string) {
    setSelectedDisciplineParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId],
    );
  }

  function removeDisciplineParent(parentId: string) {
    setSelectedDisciplineParentIds((current) => current.filter((id) => id !== parentId));
  }

  function changeAdminRecipientMode(mode: "all" | "parents" | "sections" | "classes") {
    setAdminRecipientMode(mode);
    setRecipientSearch("");
    setSelectedAdminParentIds([]);
    setSelectedAdminSection("");
    setSelectedAdminClass("");
  }

  function toggleAdminParent(parentId: string) {
    setSelectedAdminParentIds((current) =>
      current.includes(parentId) ? current.filter((id) => id !== parentId) : [...current, parentId],
    );
  }

  function removeAdminParent(parentId: string) {
    setSelectedAdminParentIds((current) => current.filter((id) => id !== parentId));
  }

  async function sendMessage() {
    setMessageFeedback("");
    if (isSchoolAdmin && adminRecipientMode === "parents" && selectedAdminParentIds.length === 0) {
      setMessageFeedback("Message non envoyé. Aucun parent sélectionné.");
      return;
    }
    if (isSchoolAdmin && adminRecipientMode === "sections" && !selectedAdminSection) {
      setMessageFeedback("Message non envoyé. Aucune section sélectionnée.");
      return;
    }
    if (isSchoolAdmin && adminRecipientMode === "classes" && !selectedAdminClass) {
      setMessageFeedback("Message non envoyé. Aucune classe sélectionnée.");
      return;
    }
    const recipientParents = isSchoolAdmin
      ? adminResolvedParents
      : isDisciplineDirector
      ? selectedDisciplineParents
      : yearData.parents.filter((parent) => parent.id === recipientParentId && parent.schoolId === school.id);
    if (recipientParents.length === 0) {
      setMessageFeedback("Aucun parent destinataire n'a été trouvé pour cette sélection.");
      return;
    }
    const createdAt = new Date().toISOString();
    const schoolRecipient = user.role === "school_admin" ? "admin" : user.role === "cashier" ? "cashier" : user.role === "discipline_director" ? "discipline" : undefined;
    const visibleSchoolRecipients =
      user.role === "school_admin"
        ? ["admin", "both"]
        : user.role === "cashier"
          ? ["cashier", "both"]
          : user.role === "discipline_director"
            ? ["discipline"]
            : [];
    const threadMessages = schoolRecipient
      ? yearData.messages.filter((message) => !message.schoolRecipient || visibleSchoolRecipients.includes(message.schoolRecipient))
      : yearData.messages;
    const messages: Message[] = recipientParents.map((parent) => {
      const threadId = nextMessageThreadId(threadMessages, user.id, parent.id, parent.id) ?? uid("thread");
      const existingThreadRecipient = threadMessages.find(
        (message) =>
          message.threadId === threadId &&
          message.threadParentId === parent.id &&
          message.schoolRecipient &&
          visibleSchoolRecipients.includes(message.schoolRecipient),
      )?.schoolRecipient;
      const message: Message = {
        id: uid("msg"),
        schoolId: school.id,
        schoolYearId: year.id,
        senderId: user.id,
        recipientParentId: parent.id,
        threadParentId: parent.id,
        threadId,
        subject,
        body,
        createdAt,
      };
      if (schoolRecipient) {
        message.schoolRecipient = existingThreadRecipient ?? schoolRecipient;
      }
      return message;
    });
    const notifications: AppNotification[] = messages.map((message) => ({
      id: uid("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "parent",
      parentId: message.threadParentId,
      messageId: message.id,
      type: "message",
      title: user.role === "discipline_director" ? "Nouveau message discipline" : "Nouveau message de l'école",
      body: `${school.name}: ${subject}`,
      createdAt,
      read: false,
    }));
    if (canUseFirestoreData()) {
      if (!db) {
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
      if (isDisciplineDirector) {
        const savedMessages: Message[] = [];
        const savedNotifications: AppNotification[] = [];
        const failedParentIds: string[] = [];
        for (const message of messages) {
          const notification = notifications.find((item) => item.messageId === message.id);
          if (!notification) continue;
          const parentName = recipientParents.find((parent) => parent.id === message.threadParentId)?.fullName;
          try {
            const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName });
            savedMessages.push(savedMessage);
            savedNotifications.push(notification);
          } catch (error) {
            console.warn("Envoi du message discipline impossible pour un parent.", { parentId: message.threadParentId, error });
            if (message.threadParentId) failedParentIds.push(message.threadParentId);
          }
        }
        if (savedMessages.length > 0) {
          updateData(
            { messages: [...savedMessages, ...data.messages], notifications: [...savedNotifications, ...data.notifications] },
            { persist: false },
          );
        }
        if (failedParentIds.length === 0) {
          setSubject("");
          setBody("");
          setSelectedDisciplineParentIds([]);
          setMessageFeedback(`${savedMessages.length} message(s) envoyé(s).`);
          return;
        }
        setSelectedDisciplineParentIds(failedParentIds);
        setMessageFeedback(
          savedMessages.length > 0
            ? `${savedMessages.length} message(s) envoyé(s), ${failedParentIds.length} échec(s).`
            : "Message non envoyé. Veuillez réessayer.",
        );
        return;
      }
      try {
        const savedMessages: Message[] = [];
        for (const message of messages) {
          const notification = notifications.find((item) => item.messageId === message.id);
          if (notification) {
            const parentName = recipientParents.find((parent) => parent.id === message.threadParentId)?.fullName;
            const savedMessage = await persistMessageWithConversation({ user, message, notification, parentName });
            savedMessages.push(savedMessage);
          }
        }
        updateData(
          { messages: [...savedMessages, ...data.messages], notifications: [...notifications, ...data.notifications] },
          { persist: false },
        );
      } catch (error) {
        console.warn("Envoi du message impossible.", error);
        setMessageFeedback("Message non envoyé. Veuillez réessayer.");
        return;
      }
    } else {
      updateData({ messages: [...messages, ...data.messages], notifications: [...notifications, ...data.notifications] });
    }
    setSubject("");
    setBody("");
    if (isDisciplineDirector) {
      setSelectedDisciplineParentIds([]);
      setMessageFeedback(`${messages.length} message(s) envoyé(s).`);
      return;
    }
    if (isSchoolAdmin) {
      setSelectedAdminParentIds([]);
      setRecipientSearch("");
    }
    setMessageFeedback("Message envoyé avec succès.");
  }

  function clearSelectedRecipient() {
    setRecipientParentId("");
    setRecipientSearch("");
  }

  return (
    <section className="grid min-w-0 gap-4">
      {canSend && (
        <FormPanel title="Envoyer un message">
          <div className="grid min-w-0 gap-2">
            {isSchoolAdmin ? (
              <>
                <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                  Destinataires
                  <select value={adminRecipientMode} onChange={(event) => changeAdminRecipientMode(event.target.value as "all" | "parents" | "sections" | "classes")} className="input">
                    <option value="all">Tous les parents</option>
                    <option value="parents">Sélection parent</option>
                    <option value="sections">Sections</option>
                    <option value="classes">Classes</option>
                  </select>
                </label>
                {adminRecipientMode === "parents" && (
                  <>
                    <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        value={recipientSearch}
                        onChange={(event) => setRecipientSearch(event.target.value)}
                        className="min-w-0 flex-1 outline-none"
                        placeholder="Rechercher parent, téléphone ou email"
                      />
                    </label>
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                      {hasRecipientSearch &&
                        recipientResults.map(({ parent, children }) => {
                          const selected = selectedAdminParentIds.includes(parent.id);
                          return (
                            <button
                              key={parent.id}
                              onClick={() => toggleAdminParent(parent.id)}
                              type="button"
                              className={`w-full rounded border p-3 text-left text-sm transition ${selected ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                            >
                              <p className="font-semibold text-ink">{parent.fullName}</p>
                              <p className="text-xs text-slate-500">{parent.phone || "Téléphone non renseigné"} | {parent.email || "Email non renseigné"}</p>
                              <p className="text-xs text-slate-500">
                                {children.length
                                  ? children.map((student) => `${student.nom} ${student.prenom}${student.matricule ? ` | ${student.matricule}` : ""}`).join(" • ")
                                  : "Aucun enfant associé"}
                              </p>
                            </button>
                          );
                        })}
                      {!hasRecipientSearch && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez un nom, téléphone ou email pour rechercher un parent.</p>}
                      {hasRecipientSearch && recipientResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
                    </div>
                  </>
                )}
                {adminRecipientMode === "sections" && (
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Section
                    <select value={selectedAdminSection} onChange={(event) => setSelectedAdminSection(event.target.value as SchoolSection | "")} className="input">
                      <option value="">Sélectionner une section</option>
                      {adminSectionChoices.map((section) => (
                        <option key={section} value={section}>{sectionLabels[section]}</option>
                      ))}
                    </select>
                  </label>
                )}
                {adminRecipientMode === "classes" && (
                  <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                    Classe
                    <select value={selectedAdminClass} onChange={(event) => setSelectedAdminClass(event.target.value as SchoolClass | "")} className="input">
                      <option value="">Sélectionner une classe</option>
                      {adminClassChoices.map((className) => (
                        <option key={className} value={className}>{className}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedAdminParents.length > 0 && (
                  <div className="grid gap-2 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                    <p>{selectedAdminParents.length} parent(s) sélectionné(s)</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedAdminParents.map((parent) => (
                        <span key={parent.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-blue-700">
                          <span className="min-w-0 truncate">{parent.fullName}</span>
                          <button
                            type="button"
                            onClick={() => removeAdminParent(parent.id)}
                            className="shrink-0 rounded-full p-0.5 transition hover:bg-blue-100"
                            aria-label={`Retirer ${parent.fullName}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  {adminResolvedParents.length} parent{adminResolvedParents.length > 1 ? "s" : ""} destinataire{adminResolvedParents.length > 1 ? "s" : ""}
                </p>
              </>
            ) : (
              <>
                <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    value={recipientSearch}
                    onChange={(event) => setRecipientSearch(event.target.value)}
                    className="min-w-0 flex-1 outline-none"
                    placeholder={isCashier ? "Saisissez le nom d'un parent, d'un enfant ou un matricule." : "Rechercher parent, enfant ou matricule"}
                  />
                </label>
                <div className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {(isDisciplineDirector ? disciplineRecipientResults : hasRecipientSearch ? recipientResults : []).map(({ parent, children }) => {
                    const selected = isDisciplineDirector ? selectedDisciplineParentIds.includes(parent.id) : recipientParentId === parent.id;
                    return (
                      <button
                        key={parent.id}
                        onClick={() => (isDisciplineDirector ? toggleDisciplineParent(parent.id) : setRecipientParentId(parent.id))}
                        type="button"
                        className={`w-full rounded border p-3 text-left text-sm transition ${selected ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                      >
                        <p className="font-semibold text-ink">{parent.fullName}</p>
                        <p className="text-xs text-slate-500">
                          {children.length
                            ? children.map((student) => `${student.nom} ${student.prenom}${student.matricule ? ` | ${student.matricule}` : ""} | ${formatStudentClassName(student)}`).join(" • ")
                            : "Aucun enfant associé"}
                        </p>
                      </button>
                    );
                  })}
                  {!hasRecipientSearch && !isDisciplineDirector && !isCashier && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez le nom d'un parent, d'un enfant ou un matricule.</p>}
                  {hasRecipientSearch && recipientResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
                </div>
              </>
            )}
            {isDisciplineDirector && selectedDisciplineParents.length > 0 && (
              <div className="grid gap-2 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                <p>{selectedDisciplineParents.length} parent(s) sélectionné(s)</p>
                <div className="flex flex-wrap gap-2">
                  {selectedDisciplineParents.map((parent) => (
                    <span key={parent.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-blue-700">
                      <span className="min-w-0 truncate">{parent.fullName}</span>
                      <button
                        type="button"
                        onClick={() => removeDisciplineParent(parent.id)}
                        className="shrink-0 rounded-full p-0.5 transition hover:bg-blue-100"
                        aria-label={`Retirer ${parent.fullName}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!isSchoolAdmin && !isDisciplineDirector && selectedParent && (
              <div className="flex min-w-0 items-center justify-between gap-3 rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                <p className="min-w-0 truncate">Destinataire : {selectedParent.fullName}</p>
                <button
                  type="button"
                  onClick={clearSelectedRecipient}
                  className="shrink-0 rounded-full p-1 text-blue-600 transition hover:bg-blue-100 hover:text-blue-800"
                  aria-label="Retirer le destinataire"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          {user.role === "discipline_director" ? (
            <select value={subject} onChange={(event) => setSubject(event.target.value)} className="input">
              <option value="">Choisir le type de message</option>
              {disciplineMessageSubjects.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          ) : (
            <input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />
          )}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-32" placeholder="Message" />
          {messageFeedback && (
            <p
              className={`rounded px-3 py-2 text-sm font-semibold ${
                messageFeedback === "Message envoyé avec succès." || messageFeedback.endsWith("message(s) envoyé(s).")
                  ? "bg-mint/10 text-mint"
                  : messageFeedback.includes("échec")
                    ? "border border-amber-200 bg-amber-50 text-amber-700"
                    : "border border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {messageFeedback}
            </p>
          )}
          <button onClick={sendMessage} disabled={!subject || !body || (isDisciplineDirector && selectedDisciplineParentIds.length === 0) || (isCashier && !recipientParentId)} className="primary-button disabled:opacity-50">
            <MessageSquare className="h-4 w-4" /> Envoyer
          </button>
        </FormPanel>
      )}
    </section>
  );
}

function MenuModule({
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
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  years: SchoolYear[];
  selectedYear: SchoolYear;
  onYearChange: (id: string) => void;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onLogout: () => void;
  valvesUploadsEnabled: boolean;
  onCreateParentFromDirectory: () => void;
  onEditParentFromDirectory: (parent: ParentProfile) => void;
}) {
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

    const newYearId = uid("year");
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
          id: editingFeeId && index === 0 ? editingFeeId : uid("fee"),
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
          <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} />
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
          createId={uid}
          createAuditLog={createAuditLog}
          getPublicationAttachmentDrafts={getPublicationAttachmentDrafts}
          getPublicationDownloadAttachments={getPublicationDownloadAttachments}
          getValveAttachmentKey={getValveAttachmentKey}
          validateValveAttachmentDrafts={validateValveAttachmentDrafts}
          getValvePublicationErrorMessage={getValvePublicationErrorMessage}
          getApproximateValveDocumentSize={getApproximateValveDocumentSize}
          maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES}
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
      return (
        <ActivityHistoryContent
          user={user}
          data={data}
          yearData={yearData}
          role={user.role === "cashier" ? "cashier" : "admin"}
        />
      );
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

const schoolEducationLevelChoices = ["Maternelle", "Primaire", "Secondaire"];
const schoolLevelChoices: SchoolLevelChoice[] = ["Maternelle", "Primaire", "Secondaire", "Primaire uniquement", "Secondaire uniquement"];
const defaultSchoolOptions = [
  "Sciences",
  "Littéraire",
  "Commerciale et Gestion",
  "Pédagogie générale",
  "Électricité générale",
  "Mécanique générale",
  "Coupe et Couture",
  "Électronique",
];

const feeTargetSeparator = "::option::";

function feeTargetHasOption(target: string) {
  return target.includes(feeTargetSeparator);
}

function formatFeeTargetLabel(fee: Pick<FeeType, "className" | "classOptionKey">) {
  return formatFeeTargetValue(fee.classOptionKey ?? fee.className);
}

function formatStudentPdfClassName(student: Pick<Student, "className" | "option">) {
  return student.className;
}

const studentPdfClassOrder: SchoolClass[] = [
  "Maternelle 1",
  "Maternelle 2",
  "Maternelle 3",
  "1ère Primaire",
  "2ème Primaire",
  "3ème Primaire",
  "4ème Primaire",
  "5ème Primaire",
  "6ème Primaire",
  "7ème CTEB",
  "8ème CTEB",
  "1ère Humanité",
  "2ème Humanité",
  "3ème Humanité",
  "4ème Humanité",
];

function compareStudentsForPdfByClass(first: Pick<Student, "className">, second: Pick<Student, "className">) {
  const firstIndex = studentPdfClassOrder.indexOf(first.className);
  const secondIndex = studentPdfClassOrder.indexOf(second.className);
  const firstOrder = firstIndex === -1 ? Number.MAX_SAFE_INTEGER : firstIndex;
  const secondOrder = secondIndex === -1 ? Number.MAX_SAFE_INTEGER : secondIndex;
  return firstOrder - secondOrder;
}

function sortStudentsForPdfByClass<T extends Pick<Student, "className">>(students: T[]) {
  return [...students].sort(compareStudentsForPdfByClass);
}

function studentImportKey(student: Student) {
  const identity = [student.nom, student.postnom, student.prenom, student.birthDate].map((value) => value.trim().toLowerCase()).join("|");
  return student.matricule?.trim().toLowerCase() || identity;
}

function formatArchiveDate(value?: string) {
  if (!value) return "Date non renseignée";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("fr-FR");
}

function generateReceiptNumber(payments: Payment[], yearName: string) {
  const year = yearName.slice(0, 4);
  return `REC-${year}-${String(payments.length + 1).padStart(4, "0")}`;
}

function operationTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function nearestCreationLog(auditLogs: AuditLog[], action: string, createdAt: string | undefined, matchesDetails: (details: string) => boolean) {
  const operationTime = operationTimestamp(createdAt);
  return auditLogs
    .filter((log) => log.action === action && matchesDetails(log.details ?? ""))
    .map((log) => ({ log, delta: Math.abs(operationTimestamp(log.createdAt) - operationTime) }))
    .sort((first, second) => first.delta - second.delta)[0]?.log;
}

function resolvePaymentCashierName(payment: Payment, auditLogs: AuditLog[]) {
  const paymentKeys = [payment.receiptNumber, payment.id].filter(Boolean);
  const matchingLog = nearestCreationLog(auditLogs, "Création paiement", payment.createdAt ?? payment.paidAt, (details) =>
    paymentKeys.some((key) => details.includes(String(key))),
  );
  return matchingLog?.actorName || payment.cashierName || "-";
}

function resolveExpenseCashierName(expense: Expense, auditLogs: AuditLog[]) {
  const matchingLog = nearestCreationLog(auditLogs, "Création dépense", expense.createdAt ?? expense.spentAt, (details) =>
    details.includes(expense.category) && details.includes(`$${expense.amount}`),
  );
  return matchingLog?.actorName || expense.cashierName || "-";
}

function isSessionAuditAction(action: string) {
  const normalizedAction = action
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  return ["connexion", "deconnexion", "login", "logout", "sign in", "sign out"].some((sessionAction) => normalizedAction.includes(sessionAction));
}

function createAuditLog(user: AppUser, schoolId: string, schoolYearId: string, action: string, details: string): AuditLog {
  return {
    id: uid("audit"),
    schoolId,
    schoolYearId,
    actorId: user.id,
    actorName: user.name,
    action,
    details,
    createdAt: new Date().toISOString(),
  };
}

async function exportStudentsPdf(school: School, year: SchoolYear, students: Student[], filters: string[]) {
  const showOptionColumn = students.some((student) => Boolean(student.option));
  const totalLabelColspan = showOptionColumn ? 5 : 4;
  const studentColumns: PdfTableColumn<Student>[] = [
    { header: "Matricule", render: (student) => student.matricule || "-" },
    { header: "Nom complet", render: (student) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() || "-" },
    { header: "Sexe", render: (student) => student.sexe || "-", align: "center" },
    { header: "Classe", render: (student) => formatStudentPdfClassName(student) || "-" },
    { header: "Téléphone", render: (student) => student.phone || "-" },
  ];
  if (showOptionColumn) {
    studentColumns.splice(4, 0, { header: "Option", render: (student) => student.option || "-" });
  }
  await renderAcadPdfPreview({
    filename: `eleves-${year.name}.pdf`,
    title: "Liste des élèves",
    school,
    year,
    subtitle: `Filtres appliqués : ${filters.join(" | ")}`,
    sections: [
      pdfSection(
        "Élèves",
        pdfTable(
          studentColumns,
          students,
          "Aucun élève ne correspond aux filtres appliqués.",
          {
            footerHtml: `
              <tr>
                <td colspan="${totalLabelColspan}">Total élèves</td>
                <td class="align-right">${students.length}</td>
              </tr>
            `,
          },
        ),
      ),
    ],
  });
}

function calculateStudentAge(birthDate?: string) {
  if (!birthDate) return null;
  const date = new Date(`${birthDate.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (today < birthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
}

async function exportAgeHomogeneityPdf(school: School, year: SchoolYear, students: Student[]) {
  type StudentAgeDetailRow = {
    index: number;
    student: Student;
    age: number | null;
    theoreticalAge: number | null;
    situation: "Âge normal" | "En avance" | "En retard" | "Non déterminé";
    observation: string;
  };
  type AgeHomogeneitySummaryRow = {
    index: number;
    className: SchoolClass;
    minAge: number | null;
    maxAge: number | null;
    averageAge: number | null;
    normal: number;
    early: number;
    late: number;
    total: number;
    homogeneityRate: number;
  };

  const theoreticalAgeByClass = new Map<SchoolClass, number>([
    ["Maternelle 1", 3],
    ["Maternelle 2", 4],
    ["Maternelle 3", 5],
    ["1ère Primaire", 6],
    ["2ème Primaire", 7],
    ["3ème Primaire", 8],
    ["4ème Primaire", 9],
    ["5ème Primaire", 10],
    ["6ème Primaire", 11],
    ["7ème CTEB", 12],
    ["8ème CTEB", 13],
    ["1ère Humanité", 14],
    ["2ème Humanité", 15],
    ["3ème Humanité", 16],
    ["4ème Humanité", 17],
  ]);
  const schoolOrderByClass = new Map<SchoolClass, { section: number; level: number }>([
    ["Maternelle 1", { section: 1, level: 1 }],
    ["Maternelle 2", { section: 1, level: 2 }],
    ["Maternelle 3", { section: 1, level: 3 }],
    ["1ère Primaire", { section: 2, level: 1 }],
    ["2ème Primaire", { section: 2, level: 2 }],
    ["3ème Primaire", { section: 2, level: 3 }],
    ["4ème Primaire", { section: 2, level: 4 }],
    ["5ème Primaire", { section: 2, level: 5 }],
    ["6ème Primaire", { section: 2, level: 6 }],
    ["7ème CTEB", { section: 3, level: 1 }],
    ["8ème CTEB", { section: 3, level: 2 }],
    ["1ère Humanité", { section: 3, level: 3 }],
    ["2ème Humanité", { section: 3, level: 4 }],
    ["3ème Humanité", { section: 3, level: 5 }],
    ["4ème Humanité", { section: 3, level: 6 }],
  ]);
  const sortedStudents = [...students].sort((a, b) => {
    const aOrder = schoolOrderByClass.get(a.className) ?? { section: 99, level: 99 };
    const bOrder = schoolOrderByClass.get(b.className) ?? { section: 99, level: 99 };
    const sectionDiff = aOrder.section - bOrder.section;
    if (sectionDiff !== 0) return sectionDiff;
    const levelDiff = aOrder.level - bOrder.level;
    if (levelDiff !== 0) return levelDiff;
    return `${a.nom} ${a.postnom} ${a.prenom}`.localeCompare(`${b.nom} ${b.postnom} ${b.prenom}`, "fr");
  });
  const detailRows: StudentAgeDetailRow[] = sortedStudents.map((student, index) => {
    const age = calculateStudentAge(student.birthDate);
    const theoreticalAge = theoreticalAgeByClass.get(student.className) ?? null;
    const situation =
      age === null || theoreticalAge === null
        ? "Non déterminé"
        : age < theoreticalAge
          ? "En avance"
          : age > theoreticalAge
            ? "En retard"
            : "Âge normal";
    const observation =
      age === null
        ? "Date de naissance absente ou invalide"
        : theoreticalAge === null
          ? "Âge théorique non défini"
          : situation === "Âge normal"
            ? "Conforme"
            : situation;
    return { index: index + 1, student, age, theoreticalAge, situation, observation };
  });
  const summaryRows: AgeHomogeneitySummaryRow[] = CLASSES.map((className) => {
    const classRows = detailRows.filter((row) => row.student.className === className);
    if (classRows.length === 0) return null;
    const knownAgeRows = classRows.filter((row) => row.age !== null);
    const ages = knownAgeRows.map((row) => row.age as number);
    const normal = classRows.filter((row) => row.situation === "Âge normal").length;
    const early = classRows.filter((row) => row.situation === "En avance").length;
    const late = classRows.filter((row) => row.situation === "En retard").length;
    return {
      index: 0,
      className,
      minAge: ages.length ? Math.min(...ages) : null,
      maxAge: ages.length ? Math.max(...ages) : null,
      averageAge: ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : null,
      normal,
      early,
      late,
      total: classRows.length,
      homogeneityRate: knownAgeRows.length ? Math.round((normal / knownAgeRows.length) * 100) : 0,
    };
  })
    .filter((row): row is Omit<AgeHomogeneitySummaryRow, "index"> & { index: number } => Boolean(row))
    .map((row, index) => ({ ...row, index: index + 1 }));
  const missingBirthDateCount = detailRows.filter((row) => row.age === null).length;
  const formatAge = (age: number | null) => (age === null ? "—" : `${age} ans`);
  const formatAverageAge = (age: number | null) => (age === null ? "—" : `${age.toFixed(1).replace(".", ",")} ans`);

  await renderAcadPdfPreview({
    filename: `homogeneite-age-${year.name}.pdf`,
    title: "Tableau d'homogénéité d'âge",
    school,
    year,
    subtitle: "Synthèse et détail de l'homogénéité d'âge scolaire",
    sections: [
      pdfSection(
        "Informations de calcul",
        pdfInfoGrid([
          { label: "Élèves analysés", value: detailRows.length },
          { label: "Classes représentées", value: summaryRows.length },
          { label: "Date de calcul", value: new Intl.DateTimeFormat("fr-FR").format(new Date()) },
          {
            label: "Données manquantes",
            value: missingBirthDateCount > 0 ? `${missingBirthDateCount} élève(s) sans date de naissance exploitable` : "Aucune",
          },
        ]),
      ),
      pdfSection(
        "Synthèse de l'homogénéité d'âge scolaire par classe",
        pdfTable(
          [
            { header: "N°", render: (row) => row.index, align: "center" },
            { header: "Classe", render: (row) => row.className },
            { header: "Effectif total", render: (row) => row.total, align: "center" },
            { header: "Âge minimum", render: (row) => formatAge(row.minAge), align: "center" },
            { header: "Âge maximum", render: (row) => formatAge(row.maxAge), align: "center" },
            { header: "Âge moyen", render: (row) => formatAverageAge(row.averageAge), align: "center" },
            { header: "Élèves à l'âge normal", render: (row) => row.normal, align: "center" },
            { header: "Élèves en avance", render: (row) => row.early, align: "center" },
            { header: "Élèves en retard", render: (row) => row.late, align: "center" },
            { header: "Taux d'homogénéité", render: (row) => `${row.homogeneityRate}%`, align: "center" },
          ],
          summaryRows,
          "Aucune donnée d'âge exploitable pour les élèves sélectionnés.",
        ),
      ),
      pdfSection(
        "Détail de l'homogénéité d'âge scolaire par élève",
        pdfTable(
          [
            { header: "N°", render: (row) => row.index, align: "center" },
            { header: "Matricule", render: (row) => row.student.matricule || "—" },
            { header: "Nom et prénom", render: (row) => `${row.student.nom} ${row.student.postnom} ${row.student.prenom}`.replace(/\s+/g, " ").trim() || "—" },
            { header: "Sexe", render: (row) => row.student.sexe, align: "center" },
            { header: "Date de naissance", render: (row) => row.student.birthDate || "—", align: "center" },
            { header: "Âge", render: (row) => formatAge(row.age), align: "center" },
            { header: "Classe", render: (row) => formatStudentClassName(row.student) },
            { header: "Âge théorique", render: (row) => formatAge(row.theoreticalAge), align: "center" },
            { header: "Situation", render: (row) => row.situation },
            { header: "Observation", render: (row) => row.observation },
          ],
          detailRows,
          "Aucun élève ne correspond aux filtres appliqués.",
        ),
        { pageBreakBefore: true },
      ),
    ],
  });
}

async function exportReportPdf(
  school: School,
  year: SchoolYear,
  startDate: string,
  endDate: string,
  sectionLabel: string,
  showGlobalExpenseNote: boolean,
  paid: number,
  spent: number,
  recovery: number,
  payments: Payment[],
  expenses: Expense[],
  students: Student[],
) {
  const studentById = new Map(students.map((student) => [student.id, student]));
  const fallback = "—";
  const timestampForSort = (value?: string) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
  };
  const compareByPrimaryThenCreatedAt = (
    first: { id: string; createdAt?: string },
    second: { id: string; createdAt?: string },
    firstPrimary?: string,
    secondPrimary?: string,
  ) => {
    const primaryDiff = timestampForSort(firstPrimary) - timestampForSort(secondPrimary);
    if (primaryDiff !== 0) return primaryDiff;
    const createdDiff = timestampForSort(first.createdAt) - timestampForSort(second.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return first.id.localeCompare(second.id, "fr");
  };
  const sortedPayments = [...payments].sort((first, second) => compareByPrimaryThenCreatedAt(first, second, first.paidAt, second.paidAt));
  const sortedExpenses = [...expenses].sort((first, second) => compareByPrimaryThenCreatedAt(first, second, first.spentAt, second.spentAt));
  const studentNameForPayment = (payment: Payment) => {
    const student = studentById.get(payment.studentId);
    if (!student) return fallback;
    return `${student.nom} ${student.postnom} ${student.prenom}`.trim() || fallback;
  };
  const studentOptionForPayment = (payment: Payment) => studentById.get(payment.studentId)?.option || fallback;
  const timeFromDate = (value?: string) => {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  };

  await renderAcadPdfPreview({
    filename: `rapport-${startDate}-${endDate}.pdf`,
    title: "Rapport Financier",
    school,
    year,
    subtitle: `Période : ${startDate} au ${endDate}`,
    sections: [
      pdfSection(
        "Synthèse",
        pdfInfoGrid([
          { label: "Section", value: sectionLabel },
          { label: "Paiements", value: money(paid) },
          { label: "Dépenses", value: money(spent) },
          { label: "Solde", value: money(paid - spent) },
          { label: "Recouvrement", value: `${recovery}%` },
          ...(showGlobalExpenseNote
            ? [{ label: "Note dépenses", value: "Les dépenses présentées sont globales pour l'école, car elles ne sont pas rattachées à une section." }]
            : []),
        ]),
      ),
      pdfSection(
        "Paiements",
        pdfTable(
          [
            { header: "Date", render: (payment) => payment.paidAt },
            { header: "Nom de l'élève", render: studentNameForPayment },
            { header: "Option", render: studentOptionForPayment },
            { header: "Caissier", render: (payment) => payment.cashierName },
            { header: "Montant", render: (payment) => money(payment.amount), align: "right" },
            { header: "Reçu", render: (payment) => payment.receiptNumber ?? payment.id },
          ],
          sortedPayments.slice(0, 24),
          "Aucun paiement pour cette période.",
        ),
      ),
      pdfSection(
        "Dépenses",
        pdfTable(
          [
            { header: "Date", render: (expense) => expense.spentAt },
            { header: "Heure", render: (expense) => timeFromDate(expense.spentAt), align: "center" },
            { header: "Catégorie", render: (expense) => expense.category },
            { header: "Caissier", render: (expense) => expense.cashierName || fallback },
            { header: "Montant", render: (expense) => money(expense.amount), align: "right" },
            { header: "Description", render: (expense) => expense.description },
          ],
          sortedExpenses.slice(0, 24),
          "Aucune dépense pour cette période.",
        ),
        { pageBreakBefore: true },
      ),
    ],
  });
}

function emptyParent(schoolId: string, schoolYearId: string): ParentProfile {
  return {
    id: `new-${crypto.randomUUID()}`,
    schoolId,
    schoolYearId,
    userId: "",
    fullName: "",
    phone: "",
    email: "",
    address: "",
    studentIds: [],
    status: "active",
  };
}
