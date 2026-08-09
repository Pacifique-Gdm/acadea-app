import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getDefaultRoute, signIn, signOutUser, subscribeToFirebaseUser, validateDisciplineDirector, validateParent, validatePlatformAdmin, validateSchoolStaff, validateSecretary } from "./services/auth";
import { AccessDenied } from "./components/auth/AccessDenied";
import { ActivityHistoryContent } from "./components/history/ActivityHistoryContent";
import { LoginScreen } from "./components/auth/LoginScreen";
import { Header } from "./components/layout/Header";
import { BottomNavigation } from "./components/layout/BottomNavigation";
import { DisciplineBottomNavigation } from "./components/layout/DisciplineBottomNavigation";
import { EnvironmentBanner } from "./components/layout/EnvironmentBanner";
import { InstallPwaNavButton } from "./components/layout/InstallPwaNavButton";
import { ParentBottomNavigation } from "./components/layout/ParentBottomNavigation";
import { SecretaryBottomNavigation } from "./components/layout/SecretaryBottomNavigation";
import { PlatformLogoSlot } from "./components/layout/PlatformLogoSlot";
import { YearScreen } from "./components/school/YearScreen";
import { ParentFormEditor } from "./components/parents/ParentFormEditor";
import { StudentDetailPage } from "./components/students/StudentDetailPage";
import { StudentsModule } from "./modules/students/StudentsModule";
import { BiometricStudentsPage } from "./modules/biometrics/BiometricStudentsPage";
import { PlatformModule } from "./modules/platform/PlatformModule";
import { DisciplinePortal } from "./modules/discipline/DisciplinePortal";
import { ControlModule } from "./modules/control/ControlModule";
import { MenuModule } from "./modules/menu/MenuModule";
import { ParentsModule } from "./modules/parents/ParentsModule";
import { ParentPortal } from "./modules/parent/ParentPortal";
import { SecretaryPortal } from "./modules/secretary/SecretaryPortal";
import { SecretaryCorrespondenceModule } from "./modules/secretary/SecretaryCorrespondenceModule";
import { SecretaryReportsModule } from "./modules/secretary/SecretaryReportsModule";
import { SecretaryMenuModule } from "./modules/secretary/SecretaryMenuModule";
import { Dashboard } from "./modules/dashboard/Dashboard";
import { ReportsModule } from "./modules/reports/ReportsModule";
import { FinancialReportPage } from "./modules/reports/FinancialReportPage";
import { MessagesModule } from "./modules/messages/MessagesModule";
import { AdminDrawer } from "./components/ui";
import { useBillingControls } from "./hooks/useBillingControls";
import { reconcileRealtimeValves, useRealtimeValves } from "./hooks/useRealtimeValves";
import { reconcileRealtimeFeeTypes, useRealtimeFeeTypes } from "./hooks/useRealtimeFeeTypes";
import { reconcileFinancialSnapshot, useRealtimeFinancialTransactions } from "./hooks/useRealtimeFinancialTransactions";
import { useRealtimeSchoolRecords } from "./hooks/useRealtimeSchoolRecords";
import { markNotificationsReadTargeted } from "./services/notificationsPagination";
import { restorePaymentPushNotifications, stopPaymentPushForegroundListener } from "./services/pushNotifications";
import { canUseFirestoreData, loadDisciplineYearData, loadFirestoreBootstrapData, loadFirestoreData, loadFirestoreYearData, loadParentPortalData, loadPlatformSettings, persistFirestorePatch } from "./services/firestoreData";
import { loadSuperAdminInitialData } from "./services/superAdminData";
import type { SuperAdminGlobalCounts } from "./services/superAdminData";
import { isSessionAuditAction } from "./utils/audit";
import { mergeMessagesById, mergeNotificationsById } from "./utils/realtimeMerges";
import { resolveDefaultSchoolYear } from "./utils/schoolYears";
import { attendanceSettingsId } from "./utils/attendance";
import { canOpenMessageDeepLink, canOpenOperationalDeepLink } from "./utils/pushNotificationRoutes";
import { feeTargetHasOption, formatFeeTargetValue } from "./utils/feeTargets";
import { schoolEducationLevelChoices } from "./utils/schoolConfig";
import { markAuthStep, measureAuthStep } from "./utils/authPerformance";
import { getPlatformSchoolStats } from "./utils/platformSchoolStats";
import { firebaseErrorCode, logRefreshError, refreshErrorMessage } from "./utils/refreshErrors";
import { runRefreshTask } from "./utils/refreshTask";
import type { SchoolLevelChoice } from "./utils/schoolConfig";
import type {
  AppData,
  AppNotification,
  AppUser,
  AttendanceSettings,
  FeeType,
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
  secretary: "Secrétaire",
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
  const refreshInFlightRef = useRef(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [pendingPushMessageId, setPendingPushMessageId] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("push") === "message" ? params.get("messageId") ?? "" : "";
  });
  const [pendingOperationalPush, setPendingOperationalPush] = useState(() => {
    if (typeof window === "undefined") return { kind: "", id: "" };
    const params = new URLSearchParams(window.location.search);
    const kind = params.get("push") ?? "";
    const id = kind === "attendance" ? params.get("attendanceId") : kind === "discipline" ? params.get("disciplineSanctionId") : kind === "announcement" ? params.get("announcementId") : "";
    return { kind, id: id ?? "" };
  });
  const logoutInProgressRef = useRef(false);
  const renderedSessionRef = useRef("");
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(() => isStandaloneDisplayMode());
  const billingControls = useBillingControls(Boolean(user));
  const applyRealtimeValves = useCallback((valves: AppData["valves"], scope: { schoolId: string; schoolYearId: string }) => {
    setData((current) => ({
      ...current,
      valves: reconcileRealtimeValves(current.valves, valves, scope),
    }));
  }, []);
  useRealtimeValves({
    user,
    schoolId: user?.schoolId ?? "",
    schoolYearId: selectedYearId,
    onValves: applyRealtimeValves,
  });
  const applyRealtimeFeeTypes = useCallback((fees: AppData["feeTypes"]) => {
    if (!user?.schoolId || !selectedYearId) return;
    setData((current) => ({
      ...current,
      feeTypes: reconcileRealtimeFeeTypes(current.feeTypes, fees, user.schoolId ?? "", selectedYearId),
    }));
  }, [selectedYearId, user?.schoolId]);
  useRealtimeFeeTypes({
    user,
    schoolId: user?.schoolId ?? "",
    schoolYearId: selectedYearId,
    onFees: applyRealtimeFeeTypes,
  });
  const applyRealtimePayments = useCallback((payments: AppData["payments"]) => {
    if (!user?.schoolId || !selectedYearId) return;
    const schoolId = user.schoolId;
    setData((current) => ({
      ...current,
      payments: reconcileFinancialSnapshot(current.payments, payments, { schoolId, schoolYearId: selectedYearId }),
    }));
  }, [selectedYearId, user?.schoolId]);
  const applyRealtimeExpenses = useCallback((expenses: AppData["expenses"]) => {
    if (!user?.schoolId || !selectedYearId) return;
    const schoolId = user.schoolId;
    setData((current) => ({
      ...current,
      expenses: reconcileFinancialSnapshot(current.expenses, expenses, { schoolId, schoolYearId: selectedYearId }),
    }));
  }, [selectedYearId, user?.schoolId]);
  const handleFinancialRealtimeError = useCallback((error: Error) => {
    console.warn("Actualisation temps réel des transactions indisponible.", error);
  }, []);
  useRealtimeFinancialTransactions({
    enabled: user?.role === "school_admin" || user?.role === "cashier",
    schoolId: user?.schoolId ?? "",
    schoolYearId: selectedYearId,
    onPayments: applyRealtimePayments,
    onExpenses: applyRealtimeExpenses,
    onError: handleFinancialRealtimeError,
  });
  const applyRealtimeSchoolRecords = useCallback((next: Partial<Pick<AppData, "students" | "parents" | "disciplineSanctions">>) => {
    setData((current) => ({ ...current, ...next }));
  }, []);
  const handleSchoolRecordsRealtimeError = useCallback((source: "students" | "parents" | "disciplineSanctions", error: Error) => {
    console.warn(`Actualisation temps réel de ${source} indisponible.`, error);
  }, []);
  useRealtimeSchoolRecords({
    user,
    schoolId: user?.schoolId ?? "",
    schoolYearId: selectedYearId,
    onData: applyRealtimeSchoolRecords,
    onError: handleSchoolRecordsRealtimeError,
  });

  useEffect(() => {
    if (!user) {
      stopPaymentPushForegroundListener();
      return undefined;
    }
    void restorePaymentPushNotifications(user).catch((error) => {
      console.warn("Restauration des notifications push indisponible.", error);
    });
    return stopPaymentPushForegroundListener;
  }, [user]);

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

    setDataLoading(nextUser.role !== "super_admin");
    setUser(nextUser);
    setSelectedYearId("");
    setActiveTab("dashboard");
    navigate(getDefaultRoute(nextUser.role));
    markAuthStep("auth:redirect-complete");
    measureAuthStep("auth:firebase-to-redirect", "auth:firebase-complete", "auth:redirect-complete");
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
        console.error("[Acadéa auth] Session Firebase invalide.", { code: firebaseErrorCode(error) });
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
        console.error("[Acadéa auth] Firebase indisponible.", { code: firebaseErrorCode(error) });
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

    void (async () => {
      if (user.role === "super_admin") {
        try {
          const { data: firestoreData, counts } = await loadSuperAdminInitialData(user.id, user);
          if (cancelled) return;
          setPlatformCounts(counts);
          setData(firestoreData);
        } catch (error) {
          if (cancelled || logoutInProgressRef.current) return;
          console.warn("Chargement Firestore indisponible.", error);
          setPlatformCounts(null);
          setData({ ...loadInitialData(), users: [user] });
          setAuthError(error instanceof Error ? error.message : "Chargement Firestore impossible après connexion.");
        }
        return;
      }

      setDataLoading(true);
      let bootstrapResolved = false;
      try {
        const bootstrap = await loadFirestoreBootstrapData(user);
        if (!bootstrap || cancelled) return;
        bootstrapResolved = true;
        const nextSchool = bootstrap.schools.find((item) => item.id === user.schoolId);
        const nextSchoolYears = nextSchool ? bootstrap.schoolYears.filter((year) => year.schoolId === nextSchool.id) : [];
        const nextYearId = resolveDefaultSchoolYear(nextSchool, nextSchoolYears)?.id ?? "";
        setData({ ...loadInitialData(), ...bootstrap });
        setSelectedYearId(nextYearId);
        setDataLoading(false);
        markAuthStep("auth:school-loaded");
        measureAuthStep("auth:redirect-to-shell", "auth:redirect-complete", "auth:school-loaded");

        const firestoreData = await loadFirestoreData(user, nextYearId, bootstrap);
        if (!firestoreData || cancelled) return;
        setData(firestoreData);
      } catch (error) {
        if (cancelled || logoutInProgressRef.current) return;
        if (bootstrapResolved) {
          console.warn("Chargement des données secondaires indisponible.", error);
          setRefreshError(error instanceof Error ? error.message : "Certaines données n'ont pas pu être chargées.");
          return;
        }
        console.warn("Chargement Firestore indispensable indisponible.", error);
        setAuthError(error instanceof Error ? error.message : "Chargement Firestore impossible après connexion.");
        setUser(null);
        setSelectedYearId("");
        setActiveTab("dashboard");
        setPlatformCounts(null);
        setData(loadInitialData());
        navigate("/login");
        void signOutUser().catch((signOutError) => {
          console.warn("Déconnexion Firebase après erreur de chargement impossible.", signOutError);
        });
      } finally {
        if (!cancelled) setDataLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      setDataLoading(false);
    };
  }, [navigate, user]);

  useEffect(() => {
    if (!user) {
      renderedSessionRef.current = "";
      return;
    }
    const platformReady = route === "/platform" && validatePlatformAdmin(user);
    const schoolPortalReady = route !== "/login" && !dataLoading && Boolean(school) && (Boolean(selectedYear) || schoolYears.length === 0);
    if ((!platformReady && !schoolPortalReady) || renderedSessionRef.current === user.id) return;
    renderedSessionRef.current = user.id;
    markAuthStep("auth:guard-complete");
    markAuthStep("auth:dashboard-rendered");
    measureAuthStep("auth:firebase-to-dashboard", "auth:firebase-complete", "auth:dashboard-rendered");
    measureAuthStep("auth:login-total", "auth:login-start", "auth:dashboard-rendered");
  }, [dataLoading, route, school, schoolYears.length, selectedYear, user]);

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
    markAuthStep("auth:firebase-complete");
    measureAuthStep("auth:firebase-response", "auth:login-start", "auth:firebase-complete");
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
    if (refreshInFlightRef.current || !user || !selectedYearId || !canUseFirestoreData()) return;
    setRefreshError("");
    await runRefreshTask({ lock: refreshInFlightRef, setRefreshing: setIsRefreshing, load: async () => {
      const next = await loadFirestoreYearData(user, selectedYearId);
      if (!next) throw new Error("Actualisation Firestore indisponible.");
      return next;
    }, apply: (next) => setData((previous) => ({ ...previous, ...next })), onError: (error) => {
      logRefreshError({ module: "school-portal", error });
      setRefreshError(refreshErrorMessage(error));
    } });
  }

  async function refreshDisciplineData() {
    if (refreshInFlightRef.current || !user || !selectedYearId || !canUseFirestoreData()) return;
    setRefreshError("");
    await runRefreshTask({ lock: refreshInFlightRef, setRefreshing: setIsRefreshing, load: async () => {
      const next = await loadDisciplineYearData(user, selectedYearId);
      if (!next) throw new Error("Actualisation Firestore indisponible.");
      return next;
    }, apply: (next) => setData((previous) => ({ ...previous, ...next })), onError: (error) => {
      logRefreshError({ module: "discipline", error });
      setRefreshError(refreshErrorMessage(error));
    } });
  }

  async function refreshParentPortalData() {
    if (refreshInFlightRef.current || !user || !canUseFirestoreData()) return;
    setRefreshError("");
    await runRefreshTask({ lock: refreshInFlightRef, setRefreshing: setIsRefreshing, load: async () => {
      const next = await loadParentPortalData(user);
      if (!next) throw new Error("Actualisation Firestore indisponible.");
      return next;
    }, apply: (next) => setData((previous) => ({ ...previous, ...next })), onError: (error) => {
      logRefreshError({ module: "parent", error });
      setRefreshError(refreshErrorMessage(error));
    } });
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
  const focusedPushMessage = useMemo(() => {
    if (!user || !pendingPushMessageId || dataLoading) return undefined;
    const message = data.messages.find((item) => item.id === pendingPushMessageId);
    const sender = message ? data.users.find((item) => item.id === message.senderId) : undefined;
    return message && canOpenMessageDeepLink(user, message, sender) ? message : null;
  }, [data.messages, data.users, dataLoading, pendingPushMessageId, user]);
  const focusedOperationalNotification = useMemo(() => {
    if (!user || !pendingOperationalPush.id || dataLoading) return undefined;
    if (pendingOperationalPush.kind === "attendance") {
      const resource = data.attendance.find((item) => item.id === pendingOperationalPush.id);
      const notification = data.notifications.find((item) => item.attendanceId === pendingOperationalPush.id);
      const student = resource ? data.students.find((item) => item.id === resource.studentId) : undefined;
      return resource && notification && canOpenOperationalDeepLink(user, notification, resource, student) ? notification : null;
    }
    if (pendingOperationalPush.kind === "discipline") {
      const resource = data.disciplineSanctions.find((item) => item.id === pendingOperationalPush.id);
      const notification = data.notifications.find((item) => item.disciplineSanctionId === pendingOperationalPush.id && item.module === "discipline");
      const student = resource ? data.students.find((item) => item.id === resource.studentId) : undefined;
      return resource && notification && canOpenOperationalDeepLink(user, notification, resource, student) ? notification : null;
    }
    if (pendingOperationalPush.kind === "announcement") {
      const resource = data.valves.find((item) => item.id === pendingOperationalPush.id);
      const notification = data.notifications.find((item) => item.announcementId === pendingOperationalPush.id);
      return resource && notification && canOpenOperationalDeepLink(user, notification, resource) ? notification : null;
    }
    return null;
  }, [data.attendance, data.disciplineSanctions, data.notifications, data.students, data.valves, dataLoading, pendingOperationalPush, user]);

  useEffect(() => {
    if (!pendingPushMessageId || focusedPushMessage === undefined) return;
    window.history.replaceState({}, "", "/dashboard");
    setRoute("/dashboard");
    if (focusedPushMessage === null) setPendingPushMessageId("");
  }, [focusedPushMessage, pendingPushMessageId]);
  useEffect(() => {
    if (!pendingOperationalPush.id || focusedOperationalNotification === undefined) return;
    window.history.replaceState({}, "", "/dashboard");
    setRoute("/dashboard");
    if (focusedOperationalNotification === null) setPendingOperationalPush({ kind: "", id: "" });
  }, [focusedOperationalNotification, pendingOperationalPush.id]);

  const dismissPushMessage = useCallback(() => {
    setPendingPushMessageId("");
    window.history.replaceState({}, "", "/dashboard");
    setRoute("/dashboard");
  }, []);
  const dismissOperationalPush = useCallback(() => {
    setPendingOperationalPush({ kind: "", id: "" });
    window.history.replaceState({}, "", "/dashboard");
    setRoute("/dashboard");
  }, []);

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

  if ((!validateSchoolStaff(user) && !validateParent(user) && !validateDisciplineDirector(user) && !validateSecretary(user)) || !school) {
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
  const secretaryStudentDetailMatch = route.match(/^\/secretariat\/eleves\/(.+)$/);
  const biometricRoute = route === "/admin/empreintes" ? "fingerprints" : route === "/admin/cartes" ? "cards" : null;
  const biometricParentRoute = route === "/admin/empreintes-cartes";
  const secretaryBiometricView = route === "/secretariat/empreintes" ? "fingerprints" : route === "/secretariat/cartes" ? "cards" : route === "/secretariat/empreintes-cartes" ? "menu" : undefined;
  const standaloneAdminRoute = Boolean(studentDetailMatch) || route === "/admin/rapport-financier";
  const unreadNotifications = yearData.notifications.filter((notification) => !notification.read).length;

  if ((biometricRoute || biometricParentRoute) && user.role !== "school_admin") {
    return <AccessDenied onLogout={logout} />;
  }

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
            notificationsOpen={Boolean(focusedPushMessage || focusedOperationalNotification) || notificationsOpen}
            isRefreshing={isRefreshing}
            refreshError={refreshError}
            onRefresh={refreshParentPortalData}
            onToggleNotifications={onToggleNotifications}
            onCloseNotifications={() => {
              onCloseNotifications();
              dismissPushMessage();
              dismissOperationalPush();
            }}
            onRealtimeNotifications={onRealtimeNotifications}
            onRealtimeMessages={onRealtimeMessages}
            roleLabels={roleLabels}
            focusedMessageId={focusedPushMessage?.id}
          />
        )}
        renderBottomNavigation={(activeTab, onTab) => (
          <ParentBottomNavigation activeTab={activeTab} showInstallButton={showInstallPwaButton} onInstallPwa={installPwa} onTab={onTab} />
        )}
        renderActivityHistory={() => <ActivityHistoryContent user={user} data={data} yearData={yearData} role="parent" />}
        createId={uid}
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
        HeaderComponent={(props) => (
          <Header
            {...props}
            notificationsOpen={Boolean(focusedPushMessage || focusedOperationalNotification) || props.notificationsOpen}
            onCloseNotifications={() => {
              props.onCloseNotifications?.();
              dismissPushMessage();
              dismissOperationalPush();
            }}
            focusedMessageId={focusedPushMessage?.id}
            roleLabels={roleLabels}
          />
        )}
        DisciplineBottomNavigationComponent={DisciplineBottomNavigation}
        MessagesModuleComponent={(props) => <MessagesModule {...props} createId={uid} />}
        createId={uid}
        selectAttendanceSettingsForYear={selectAttendanceSettingsForYear}
        maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES}
      />
    );
  }

  if (validateSecretary(user)) {
    return (
      <SecretaryPortal
        initialTab={secretaryBiometricView ? "menu" : "students"}
        renderHeader={() => (
          <>
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
                if (notifications.length > 0) updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
              }}
              onRealtimeMessages={(messages) => {
                if (messages.length > 0) updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
              }}
              roleLabels={roleLabels}
            />
          </>
        )}
        renderBottomNavigation={(tab, onTab) => (
          <SecretaryBottomNavigation activeTab={tab} showInstallButton={showInstallPwaButton} onInstallPwa={installPwa} onTab={onTab} />
        )}
        renderCorrespondence={() => <SecretaryCorrespondenceModule user={user} users={data.users} school={school} year={selectedYear} />}
        renderReports={() => <SecretaryReportsModule user={user} school={school} year={selectedYear} />}
        renderMessages={() => (
          <MessagesModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            createId={uid}
            canAttachFiles
          />
        )}
        renderMenu={() => <SecretaryMenuModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} createId={uid} studentImportKey={studentImportKey} onLogout={logout} valvesUploadsEnabled={billingControls.controls.valvesUploadsEnabled} maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES} initialBiometricView={secretaryBiometricView} onBiometricViewChange={(view) => navigate(view === "fingerprints" ? "/secretariat/empreintes" : view === "cards" ? "/secretariat/cartes" : view === "menu" ? "/secretariat/empreintes-cartes" : "/dashboard")} />}
        renderStudents={() => secretaryStudentDetailMatch ? (
          <StudentDetailPage
            studentId={secretaryStudentDetailMatch[1]}
            user={user}
            data={data}
            yearData={yearData}
            year={selectedYear}
            school={school}
            updateData={updateData}
            onBack={() => navigate("/dashboard")}
            createId={uid}
            formatArchiveDate={formatArchiveDate}
            canLinkParent={false}
          />
        ) : (
          <StudentsModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            onOpenStudent={(studentId) => navigate(`/secretariat/eleves/${studentId}`)}
            uid={uid}
            formatArchiveDate={formatArchiveDate}
            capabilities={{
              canCreate: true,
              canEdit: true,
              canArchive: false,
              canReactivate: false,
              canCreateParent: true,
              canManageOptions: true,
            }}
          />
        )}
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
        notificationsOpen={Boolean(focusedPushMessage || focusedOperationalNotification) || notificationsOpen}
        isRefreshing={isRefreshing}
        refreshError={refreshError}
        onRefresh={refreshCurrentYearData}
        onToggleNotifications={openNotifications}
        onCloseNotifications={() => {
          closeNotifications();
          dismissPushMessage();
          dismissOperationalPush();
        }}
        onRealtimeNotifications={(notifications) => {
          if (notifications.length === 0) return;
          updateData({ notifications: mergeNotificationsById(data.notifications, notifications) }, { persist: false });
        }}
        onRealtimeMessages={(messages) => {
          if (messages.length === 0) return;
          updateData({ messages: mergeMessagesById(data.messages, messages) }, { persist: false });
        }}
        roleLabels={roleLabels}
        focusedMessageId={focusedPushMessage?.id}
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
            yearData={yearData}
            school={school}
            year={selectedYear}
            onBack={() => {
              setActiveTab("menu");
              navigate("/dashboard");
            }}
          />
        ) : activeTab === "dashboard" && <Dashboard data={yearData} school={school} year={selectedYear} />}
        {!standaloneAdminRoute && activeTab === "students" && (
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
          />
        )}
        {!standaloneAdminRoute && activeTab === "parents" && (
          <ParentsModule
            data={data}
            yearData={yearData}
            school={school}
            year={selectedYear}
            updateData={updateData}
            createId={uid}
          />
        )}
        {!standaloneAdminRoute && activeTab === "control" && (
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
        {!standaloneAdminRoute && activeTab === "reports" && (
          <ReportsModule yearData={yearData} school={school} year={selectedYear} />
        )}
        {!standaloneAdminRoute && activeTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} createId={uid} />
        )}
        {!standaloneAdminRoute && activeTab === "menu" && (
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
            renderFinancialReport={() => <ReportsModule yearData={yearData} school={school} year={selectedYear} />}
            renderActivityHistory={(role) => <ActivityHistoryContent user={user} data={data} yearData={yearData} role={role} />}
            maxValveDocumentBytes={MAX_VALVE_DOCUMENT_BYTES}
            onOpenBiometrics={(mode) => navigate(mode === "fingerprints" ? "/admin/empreintes" : "/admin/cartes")}
            initialBiometricsOpen={biometricParentRoute}
          />
        )}
      </main>
      {biometricRoute && (
        <AdminDrawer
          title={biometricRoute === "fingerprints" ? "Empreintes" : "Cartes"}
          onClose={() => navigate("/admin/empreintes-cartes")}
          closeLabel={biometricRoute === "fingerprints" ? "Fermer le drawer Empreintes" : "Fermer le drawer Cartes"}
        >
          <BiometricStudentsPage
            mode={biometricRoute}
            students={yearData.students}
            loading={isRefreshing}
            error={refreshError}
            onBack={() => navigate("/admin/empreintes-cartes")}
          />
        </AdminDrawer>
      )}
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

function schoolTabLabel(tab: "overview" | "info" | "admins" | "history") {
  const labels = {
    overview: "Overview",
    info: "Informations",
    admins: "Administrateurs",
    history: "Historique",
  };
  return labels[tab];
}

function selectAttendanceSettingsForYear(settings: AttendanceSettings[], schoolId: string, schoolYearId: string) {
  const scopedSettings = settings.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId);
  if (scopedSettings.length === 0) return undefined;
  const deterministicId = attendanceSettingsId(schoolId, schoolYearId);
  return scopedSettings.find((item) => item.id === deterministicId) ?? [...scopedSettings].sort((first, second) => (second.updatedAt ?? "").localeCompare(first.updatedAt ?? ""))[0];
}

const schoolLevelChoices: SchoolLevelChoice[] = ["Maternelle", "Primaire", "CTEB", "Secondaire", "Primaire uniquement", "CTEB uniquement", "Secondaire uniquement"];
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
