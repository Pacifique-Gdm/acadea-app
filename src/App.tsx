import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  ArrowLeft,
  Banknote,
  Bell,
  Clock3,
  Edit3,
  MessageSquare,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { getDefaultRoute, signIn, signOutUser, subscribeToFirebaseUser, validateDisciplineDirector, validateParent, validatePlatformAdmin, validateSchoolStaff } from "./services/auth";
import { AccessDenied } from "./components/auth/AccessDenied";
import { LoginScreen } from "./components/auth/LoginScreen";
import { Header } from "./components/layout/Header";
import { BottomNavigation } from "./components/layout/BottomNavigation";
import { DisciplineBottomNavigation } from "./components/layout/DisciplineBottomNavigation";
import { EnvironmentBanner } from "./components/layout/EnvironmentBanner";
import { InstallPwaNavButton } from "./components/layout/InstallPwaNavButton";
import { ParentBottomNavigation } from "./components/layout/ParentBottomNavigation";
import { PlatformLogoSlot } from "./components/layout/PlatformLogoSlot";
import { YearScreen } from "./components/school/YearScreen";
import { ParentFormEditor } from "./components/parents/ParentFormEditor";
import { StudentDetailPage } from "./components/students/StudentDetailPage";
import { StudentsModule } from "./modules/students/StudentsModule";
import { PlatformModule } from "./modules/platform/PlatformModule";
import { DisciplinePortal } from "./modules/discipline/DisciplinePortal";
import { ControlModule } from "./modules/control/ControlModule";
import { MenuModule } from "./modules/menu/MenuModule";
import { ParentPortal } from "./modules/parent/ParentPortal";
import { Dashboard } from "./modules/dashboard/Dashboard";
import { ReportsModule } from "./modules/reports/ReportsModule";
import { MessagesModule } from "./modules/messages/MessagesModule";
import { AdminDrawer, FormPanel, IconButton, SectionTitle } from "./components/ui";
import { useBillingControls } from "./hooks/useBillingControls";
import { markNotificationsReadTargeted } from "./services/notificationsPagination";
import { canUseFirestoreData, loadDisciplineYearData, loadFirestoreData, loadFirestoreYearData, loadParentPortalData, loadPlatformSettings, persistFirestorePatch } from "./services/firestoreData";
import { markConversationUnreadCountRead } from "./services/conversations";
import { loadSuperAdminInitialData } from "./services/superAdminData";
import type { SuperAdminGlobalCounts } from "./services/superAdminData";
import { formatSchoolRecipientLabel } from "./utils/messages";
import { money, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./utils/pdf";
import type { PdfTableColumn } from "./utils/pdf";
import { resolveDefaultSchoolYear } from "./utils/schoolYears";
import { buildSchoolYearDataIndexes } from "./utils/dataIndexes";
import { attendanceSettingsId } from "./utils/attendance";
import { formatFeeTargetValue } from "./utils/feeTargets";
import { formatValveAttachmentSize, MAX_VALVE_ATTACHMENTS, MAX_VALVE_ATTACHMENTS_TOTAL_SIZE, validateValveAttachments } from "./utils/valvesMedia";
import type { SchoolLevelChoice } from "./utils/schoolConfig";
import { formatStudentClassName } from "./utils/studentClasses";
import type {
  AppData,
  AppNotification,
  AppUser,
  AttendanceSettings,
  AuditLog,
  DisciplineSanction,
  Expense,
  FeeType,
  Message,
  ParentProfile,
  Payment,
  School,
  SchoolClass,
  SchoolYear,
  Student,
  ValvePublication,
} from "./types";
import { CLASSES } from "./types";

type Tab = "dashboard" | "students" | "parents" | "control" | "reports" | "messages" | "menu";
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

const appEnvironment = import.meta.env.VITE_APP_ENV ?? "development";
const showStagingBanner = import.meta.env.VITE_STAGING_BANNER === "true" || appEnvironment === "staging" || appEnvironment === "preview";
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

function isStandaloneDisplayMode() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
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

  async function refreshParentPortalData() {
    if (isRefreshing || !user || !canUseFirestoreData()) return;

    setIsRefreshing(true);
    setRefreshError("");
    try {
      const parentData = await loadParentPortalData(user);
      if (!parentData) {
        throw new Error("Actualisation Firestore indisponible.");
      }
      setData((prev) => ({
        ...prev,
        ...parentData,
      }));
    } catch (error) {
      console.warn("Actualisation parent Firestore indisponible.", error);
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
        createId={uid}
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
    return (
      <ParentPortal
        user={user}
        data={data}
        yearData={yearData}
        school={school}
        year={selectedYear}
        updateData={updateData}
        onLogout={logout}
        renderEnvironmentBanner={() => <EnvironmentBanner />}
        renderHeader={({ unreadNotifications, notificationsOpen, onToggleNotifications, onCloseNotifications, onRealtimeNotifications, onRealtimeMessages }) => (
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
            onRefresh={refreshParentPortalData}
            onToggleNotifications={onToggleNotifications}
            onCloseNotifications={onCloseNotifications}
            onRealtimeNotifications={onRealtimeNotifications}
            onRealtimeMessages={onRealtimeMessages}
            roleLabels={roleLabels}
          />
        )}
        renderBottomNavigation={(activeTab, onTab) => (
          <ParentBottomNavigation activeTab={activeTab} showInstallButton={showInstallPwaButton} onInstallPwa={installPwa} onTab={onTab} />
        )}
        renderActivityHistory={() => <ActivityHistoryContent user={user} data={data} yearData={yearData} role="parent" />}
        createId={uid}
        createAuditLog={createAuditLog}
        nextMessageThreadId={nextMessageThreadId}
        mergeNotificationsById={mergeNotificationsById}
        mergeMessagesById={mergeMessagesById}
        resolvePaymentCashierName={resolvePaymentCashierName}
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
        EnvironmentBannerComponent={EnvironmentBanner}
        HeaderComponent={(props) => <Header {...props} roleLabels={roleLabels} />}
        DisciplineBottomNavigationComponent={DisciplineBottomNavigation}
        MessagesModuleComponent={(props) => <MessagesModule {...props} createId={uid} nextMessageThreadId={nextMessageThreadId} />}
        createId={uid}
        createAuditLog={createAuditLog}
        nextMessageThreadId={nextMessageThreadId}
        disciplineStudentName={disciplineStudentName}
        disciplineClassName={disciplineClassName}
        disciplineSignalBody={disciplineSignalBody}
        selectAttendanceSettingsForYear={selectAttendanceSettingsForYear}
        normalizeDisciplineReason={normalizeDisciplineReason}
        mergeNotificationsById={mergeNotificationsById}
        mergeMessagesById={mergeMessagesById}
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
        roleLabels={roleLabels}
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
        ) : activeTab === "dashboard" && <Dashboard data={yearData} school={school} year={selectedYear} exportDashboardReportPdf={exportDashboardReportPdf} />}
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
          <ControlModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            createId={uid}
            createAuditLog={createAuditLog}
            generateReceiptNumber={generateReceiptNumber}
            resolvePaymentCashierName={resolvePaymentCashierName}
            resolveExpenseCashierName={resolveExpenseCashierName}
            formatStudentPdfClassName={formatStudentPdfClassName}
            compareStudentsForPdfByClass={compareStudentsForPdfByClass}
          />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "reports" && (
          <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} exportReportPdf={exportReportPdf} />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} createId={uid} nextMessageThreadId={nextMessageThreadId} />
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
            createId={uid}
            createAuditLog={createAuditLog}
            nextSchoolYearDefaults={nextSchoolYearDefaults}
            schoolEducationLevelChoices={schoolEducationLevelChoices}
            feeTargetHasOption={feeTargetHasOption}
            formatFeeTargetLabel={formatFeeTargetLabel}
            renderFinancialReport={() => <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} exportReportPdf={exportReportPdf} />}
            renderActivityHistory={(role) => <ActivityHistoryContent user={user} data={data} yearData={yearData} role={role} />}
            getPublicationAttachmentDrafts={getPublicationAttachmentDrafts}
            getPublicationDownloadAttachments={getPublicationDownloadAttachments}
            getValveAttachmentKey={getValveAttachmentKey}
            validateValveAttachmentDrafts={validateValveAttachmentDrafts}
            getValvePublicationErrorMessage={getValvePublicationErrorMessage}
            getApproximateValveDocumentSize={getApproximateValveDocumentSize}
            maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES}
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

function selectAttendanceSettingsForYear(settings: AttendanceSettings[], schoolId: string, schoolYearId: string) {
  const scopedSettings = settings.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId);
  if (scopedSettings.length === 0) return undefined;
  const deterministicId = attendanceSettingsId(schoolId, schoolYearId);
  return scopedSettings.find((item) => item.id === deterministicId) ?? [...scopedSettings].sort((first, second) => (second.updatedAt ?? "").localeCompare(first.updatedAt ?? ""))[0];
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
      <ReportsModule user={user} data={data} yearData={yearData} school={school} year={year} exportReportPdf={exportReportPdf} />
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
