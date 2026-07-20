import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Edit3, Search, Trash2 } from "lucide-react";
import { getDefaultRoute, signIn, signOutUser, subscribeToFirebaseUser, validateDisciplineDirector, validateParent, validatePlatformAdmin, validateSchoolStaff } from "./services/auth";
import { AccessDenied } from "./components/auth/AccessDenied";
import { ActivityHistoryContent } from "./components/history/ActivityHistoryContent";
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
import { isSessionAuditAction } from "./utils/audit";
import { resolveDefaultSchoolYear } from "./utils/schoolYears";
import { attendanceSettingsId } from "./utils/attendance";
import { formatFeeTargetValue } from "./utils/feeTargets";
import type { SchoolLevelChoice } from "./utils/schoolConfig";
import type {
  AppData,
  AppNotification,
  AppUser,
  AttendanceSettings,
  DisciplineSanction,
  FeeType,
  Message,
  ParentProfile,
  School,
  SchoolYear,
  Student,
} from "./types";

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
        mergeNotificationsById={mergeNotificationsById}
        mergeMessagesById={mergeMessagesById}
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
        MessagesModuleComponent={(props) => <MessagesModule {...props} createId={uid} />}
        createId={uid}
        disciplineStudentName={disciplineStudentName}
        disciplineClassName={disciplineClassName}
        disciplineSignalBody={disciplineSignalBody}
        selectAttendanceSettingsForYear={selectAttendanceSettingsForYear}
        normalizeDisciplineReason={normalizeDisciplineReason}
        mergeNotificationsById={mergeNotificationsById}
        mergeMessagesById={mergeMessagesById}
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
            createId={uid}
            formatArchiveDate={formatArchiveDate}
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
            formatArchiveDate={formatArchiveDate}
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
          />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "reports" && (
          <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} createId={uid} />
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
            nextSchoolYearDefaults={nextSchoolYearDefaults}
            schoolEducationLevelChoices={schoolEducationLevelChoices}
            feeTargetHasOption={feeTargetHasOption}
            formatFeeTargetLabel={formatFeeTargetLabel}
            renderFinancialReport={() => <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} />}
            renderActivityHistory={(role) => <ActivityHistoryContent user={user} data={data} yearData={yearData} role={role} />}
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

const MAX_VALVE_DOCUMENT_BYTES = 900 * 1024;

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
