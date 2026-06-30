import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  ArrowUpDown,
  ArrowLeft,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  CheckCircle2,
  Clock3,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Filter,
  GraduationCap,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Menu as MenuIcon,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  X,
  UserRound,
  UsersRound,
} from "lucide-react";
import { createFirebaseAuthUser, getDefaultRoute, sendPasswordReset, signIn, signOutUser, subscribeToFirebaseUser, validateParent, validatePlatformAdmin, validateSchoolStaff } from "./services/auth";
import { canUseFirestoreData, loadFirestoreData, persistFirestorePatch } from "./services/firestoreData";
import { manageSchool, provisionCashier, provisionParent, provisionSchoolAdmin } from "./services/provisioning";
import { escapePdfHtml, generateReceiptPdf, money, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./utils/pdf";
import type { PdfTableColumn } from "./utils/pdf";
import { buildStats, getStudentBalance } from "./utils/stats";
import type {
  AppData,
  AppNotification,
  AppUser,
  AuditLog,
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
} from "./types";
import { CLASSES, FEE_KINDS } from "./types";

type Tab = "dashboard" | "students" | "parents" | "control" | "reports" | "messages" | "menu";
type ParentTab = "children" | "messages" | "menu";

const roleLabels: Record<AppUser["role"], string> = {
  super_admin: "Super Administrateur",
  school_admin: "Administrateur d'école",
  cashier: "Caissier",
  parent: "Parent",
};

const appEnvironment = import.meta.env.VITE_APP_ENV ?? "development";
const showStagingBanner = import.meta.env.VITE_STAGING_BANNER === "true" || appEnvironment === "staging" || appEnvironment === "preview";
const stagingLabel = import.meta.env.VITE_STAGING_LABEL ?? "ENVIRONNEMENT DE TEST";
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
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function loadInitialData() {
  return emptyAppData;
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

export default function App() {
  const [data, setData] = useState<AppData>(() => loadInitialData());
  const [user, setUser] = useState<AppUser | null>(null);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [route, setRoute] = useState(() => getInitialRoute());
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const [dataLoading, setDataLoading] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const logoutInProgressRef = useRef(false);

  const school = data.schools.find((item) => item.id === user?.schoolId);
  const schoolYears = school ? data.schoolYears.filter((year) => year.schoolId === school.id) : [];
  const selectedYear = schoolYears.find((year) => year.id === selectedYearId);

  const navigate = useCallback((nextRoute: string) => {
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
      setData(loadInitialData());
      navigate("/login");
      return;
    }

    const nextRoute = getDefaultRoute(nextUser.role);
    const nextYearId = nextRoute === "/dashboard" ? nextUser.activeSchoolYearId ?? "" : "";

    setUser(nextUser);
    setSelectedYearId(nextYearId);
    setActiveTab("dashboard");
    navigate(nextRoute);
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

    loadFirestoreData(user)
      .then((firestoreData) => {
        if (!firestoreData || cancelled) return;
        setData(firestoreData);
        const nextSchool = firestoreData.schools.find((item) => item.id === user.schoolId);
        const nextSchoolYears = nextSchool ? firestoreData.schoolYears.filter((year) => year.schoolId === nextSchool.id) : [];
        const nextActiveYear = nextSchoolYears.find((year) => year.status === "active");
        setSelectedYearId(user.activeSchoolYearId && nextSchoolYears.some((year) => year.id === user.activeSchoolYearId) ? user.activeSchoolYearId : nextActiveYear?.id ?? "");
      })
      .catch((error) => {
        if (cancelled || logoutInProgressRef.current) return;
        console.warn("Chargement Firestore indisponible.", error);
        setAuthError(error instanceof Error ? error.message : "Chargement Firestore impossible après connexion.");
        setUser(null);
        setSelectedYearId("");
        setActiveTab("dashboard");
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
  }

  async function loginWithCredentials(email: string, password: string) {
    await signIn(email, password);
  }

  async function logout() {
    logoutInProgressRef.current = true;
    setUser(null);
    setSelectedYearId("");
    setActiveTab("dashboard");
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
        const firestoreData = await loadFirestoreData(user);
        if (firestoreData) {
          setData(firestoreData);
          return;
        }
      } catch (error) {
        console.warn("Actualisation Firestore indisponible.", error);
      }
    }
  }

  if (!authReady) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F7FB] px-4 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded bg-ink font-bold text-white">A</div>
          <p className="font-semibold text-ink">Vérification de la session Firebase...</p>
        </div>
      </main>
    );
  }

  if (!user || route === "/login") {
    return <LoginScreen onLogin={loginWithCredentials} initialError={authError} />;
  }

  if (route === "/platform") {
    if (!validatePlatformAdmin(user)) {
      return <AccessDenied onLogout={logout} />;
    }

    return <PlatformModule user={user} data={data} updateData={updateData} onLogout={logout} />;
  }

  if (dataLoading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#F5F7FB] px-4 text-center">
        <div>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded bg-ink font-bold text-white">A</div>
          <p className="font-semibold text-ink">Chargement des données Firestore...</p>
        </div>
      </main>
    );
  }

  if ((!validateSchoolStaff(user) && !validateParent(user)) || !school) {
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
    const visibleNotificationIds = new Set(yearData.notifications.map((notification) => notification.id));
    updateData({
      notifications: data.notifications.map((notification) =>
        notification.schoolId === currentSchool.id &&
        notification.schoolYearId === currentYear.id &&
        (notificationId ? notification.id === notificationId : visibleNotificationIds.has(notification.id))
          ? { ...notification, read: true }
          : notification,
      ),
    });
  }

  function openNotifications() {
    setNotificationsOpen((current) => !current);
    if (!notificationsOpen) markNotificationsRead();
  }

  if (validateParent(user)) {
    return <ParentPortal user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} onRefresh={refreshData} onLogout={logout} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBanner />
      <Header
        user={user}
        school={school}
        year={selectedYear}
        messages={yearData.messages}
        unreadNotifications={unreadNotifications}
        notificationsOpen={notificationsOpen}
        onRefresh={() => window.location.reload()}
        onToggleNotifications={openNotifications}
      />

      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        {studentDetailMatch ? (
          <StudentDetailPage
            studentId={studentDetailMatch[1]}
            yearData={yearData}
            year={selectedYear}
            school={school}
            onBack={() => {
              setActiveTab("students");
              navigate("/dashboard");
            }}
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
          />
        )}
        {!studentDetailMatch && route !== "/admin/rapport-financier" && activeTab === "parents" && (
          <ParentsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
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
          />
        )}
      </main>
      <BottomNavigation
        user={user}
        activeTab={activeTab}
        onTab={(tab) => {
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

  return {
    students,
    parents:
      user.role === "parent"
        ? data.parents.filter((parent) => parent.id === user.parentId && parent.schoolYearId === schoolYearId)
        : data.parents.filter((parent) => parent.schoolId === schoolId && parent.schoolYearId === schoolYearId),
    users: data.users.filter((item) => item.schoolId === schoolId),
    feeTypes: data.feeTypes.filter((fee) => fee.schoolId === schoolId && fee.schoolYearId === schoolYearId),
    payments: data.payments.filter((payment) => payment.schoolId === schoolId && payment.schoolYearId === schoolYearId && studentIds.includes(payment.studentId)),
    expenses: data.expenses.filter((expense) => expense.schoolId === schoolId && expense.schoolYearId === schoolYearId),
    auditLogs: data.auditLogs.filter((log) => log.schoolId === schoolId && log.schoolYearId === schoolYearId),
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
              (!notification.parentId || notification.recipientRole === "school"),
          ),
  };
}

function LoginScreen({ onLogin, initialError }: { onLogin: (email: string, password: string) => Promise<void>; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    setError(initialError ?? "");
  }, [initialError]);

  function formatLoginError(loginError: unknown) {
    const message = loginError instanceof Error ? loginError.message : String(loginError);
    if (message.includes("auth/invalid-credential") || message.includes("auth/user-not-found") || message.includes("auth/wrong-password")) {
      return "Identifiants Firebase invalides. Vérifiez l'email et le mot de passe.";
    }
    if (message.includes("auth/too-many-requests")) {
      return "Trop de tentatives de connexion. Réessayez plus tard ou réinitialisez le mot de passe.";
    }
    if (message.includes("auth/network-request-failed")) {
      return "Connexion Firebase impossible : vérifiez votre connexion internet.";
    }
    return loginError instanceof Error ? loginError.message : "Connexion refusée.";
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

  async function requestPasswordReset() {
    setError("");
    if (!email.trim()) {
      setError("Renseignez votre email avant de demander la réinitialisation.");
      return;
    }

    setLoading(true);
    try {
      await sendPasswordReset(email.trim());
      setError("Un email de réinitialisation Firebase a été envoyé si ce compte existe.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Réinitialisation du mot de passe impossible.");
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
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center overflow-hidden rounded-[18px] bg-ink text-xl font-bold text-white shadow-[0_14px_30px_rgba(20,33,61,0.22)] sm:h-16 sm:w-16 sm:rounded-[22px] sm:text-2xl">
            A
          </div>
          <h1 className="mt-2 break-words text-2xl font-bold tracking-normal text-ink sm:mt-4 sm:text-3xl">Acadéa</h1>
          <p className="mt-1 break-words text-xs font-medium text-slate-500 sm:mt-2 sm:text-sm">Gestion scolaire sécurisée par école</p>
        </div>

        <div className="mt-4 text-center sm:mt-6">
          <h2 className="text-xl font-bold text-ink sm:text-2xl">Connexion</h2>
          <p className="mt-1 text-xs text-slate-500 sm:mt-2 sm:text-sm">Entrez vos identifiants pour continuer</p>
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
          <button
            type="button"
            disabled={loading}
            onClick={requestPasswordReset}
            className="text-sm font-semibold text-slate-600 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Mot de passe oublié
          </button>
        </form>

        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 sm:mt-5">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>

        <div className="mt-3 break-words rounded-2xl border border-slate-200 bg-[#F8FAFC] p-2 text-center text-xs leading-5 text-slate-500 sm:mt-5 sm:p-3">
          Connexion gérée par Firebase Authentication.
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
  school,
  year,
  messages,
  unreadNotifications,
  notificationsOpen,
  onRefresh,
  onToggleNotifications,
}: {
  user: AppUser;
  school: School;
  year: SchoolYear;
  messages: Message[];
  unreadNotifications: number;
  notificationsOpen: boolean;
  onRefresh: () => void;
  onToggleNotifications: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-ink font-bold text-white">A</div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{school.name}</p>
              <p className="text-xs text-slate-500">{roleLabels[user.role]}</p>
            </div>
          </div>
          <div className="relative flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center justify-end gap-3">
            <span className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Année scolaire : {year.name}</span>
            <button onClick={onRefresh} className="inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink" title="Actualiser" aria-label="Actualiser">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onToggleNotifications} className="relative inline-flex h-8 w-8 items-center justify-center text-slate-500 transition hover:text-ink" title="Boîte à Messagerie" aria-label="Boîte à Messagerie">
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">
                  {unreadNotifications}
                </span>
              )}
            </button>
            </div>
            {notificationsOpen && (
              <div className="fixed inset-x-3 bottom-24 top-24 z-30 rounded border border-slate-200 bg-white p-4 text-sm shadow-xl sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[420px] sm:max-w-[calc(100vw-2rem)]">
                <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">Boîte à Messagerie</p>
                    <p className="text-xs text-slate-500">Conversations envoyées et reçues</p>
                  </div>
                  <button onClick={onToggleNotifications} className="rounded bg-slate-100 p-2 text-slate-600 transition hover:bg-slate-200" aria-label="Fermer la boîte à messagerie" title="Fermer">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-full space-y-2 overflow-y-auto pr-1 scrollbar-thin sm:max-h-96">
                  {messages.length === 0 && <p className="rounded bg-slate-50 p-3 text-slate-500">Aucun message.</p>}
                  {messages.map((message) => (
                    <article key={message.id} className="rounded border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-ink">{message.subject}</p>
                          <p className="mt-1 text-[11px] text-slate-400">{new Date(message.createdAt).toLocaleString("fr-FR")}</p>
                        </div>
                        <span className={`shrink-0 rounded px-2 py-1 text-[10px] font-semibold uppercase ${message.senderId === user.id ? "bg-blue-50 text-blue-700" : "bg-mint/10 text-mint"}`}>
                          {message.senderId === user.id ? "Envoyé" : "Reçu"}
                        </span>
                      </div>
                      <p className="mt-3 break-words text-sm leading-6 text-slate-700">{message.body}</p>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function BottomNavigation({ user, activeTab, onTab }: { user: AppUser; activeTab: Tab; onTab: (tab: Tab) => void }) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "students", label: "Élèves", icon: GraduationCap },
    { id: "control", label: "Contrôle", icon: Banknote },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ].filter((tab) => (user.role === "cashier" ? ["dashboard", "control", "messages", "menu"].includes(tab.id) : true)) as { id: Tab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
      <div className={user.role === "cashier" ? "mx-auto grid w-full max-w-md grid-cols-4 gap-1" : "mx-auto grid max-w-3xl grid-cols-5 gap-1"}>
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
      </div>
    </nav>
  );
}

type TransactionPeriod = "today" | "last5" | "week";
type TransactionChartRow = { date: string; label: string; payments: number; expenses: number };

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
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return value.toString();
}

function getChartMaxAmount(rows: TransactionChartRow[]) {
  const maxAmount = Math.max(1, ...rows.map((row) => Math.max(row.payments, row.expenses)));
  return Math.max(500, Math.ceil(maxAmount / 500) * 500);
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
  const ticks = Array.from({ length: chartMax / 500 + 1 }, (_, index) => index * 500);

  return (
    <section className="rounded border border-slate-200 bg-slate-50/70 p-3">
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
              onClick={() => onPeriodChange(item)}
              className={`px-2 py-2 transition ${period === item ? "bg-ink text-white" : "hover:bg-slate-50"}`}
            >
              {transactionPeriodLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <svg className="min-w-full" style={{ minWidth: chartWidth }} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Mouvement des paiements et dépenses par jour">
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
              <g key={row.date}>
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
        </svg>
      </div>
    </section>
  );
}

type TransactionPeriod = "today" | "last5" | "week";
type TransactionChartRow = { date: string; label: string; payments: number; expenses: number };

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
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return value.toString();
}

function getChartMaxAmount(rows: TransactionChartRow[]) {
  const maxAmount = Math.max(1, ...rows.map((row) => Math.max(row.payments, row.expenses)));
  return Math.max(500, Math.ceil(maxAmount / 500) * 500);
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
  const ticks = Array.from({ length: chartMax / 500 + 1 }, (_, index) => index * 500);

  return (
    <section className="rounded border border-slate-200 bg-slate-50/70 p-3">
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
              onClick={() => onPeriodChange(item)}
              className={`px-2 py-2 transition ${period === item ? "bg-ink text-white" : "hover:bg-slate-50"}`}
            >
              {transactionPeriodLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto pb-1">
        <svg className="min-w-full" style={{ minWidth: chartWidth }} viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Mouvement des paiements et dépenses par jour">
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
              <g key={row.date}>
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
        </svg>
      </div>
    </section>
  );
}

function Dashboard({ data, school, year }: { data: ReturnType<typeof scopeData>; school: School; year: SchoolYear }) {
  const today = new Date().toISOString().slice(0, 10);
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [transactionPeriod, setTransactionPeriod] = useState<TransactionPeriod>("last5");
  const activeStudents = data.students.filter((student) => (student.status ?? "ACTIVE") === "ACTIVE");
  const filteredStudents = activeStudents.filter((student) => sectionFilter === "all" || getClassSection(student.className) === sectionFilter);
  const filteredStudentIds = new Set(filteredStudents.map((student) => student.id));
  const inDateRange = (date: string) => {
    const normalized = date.slice(0, 10);
    return (!startDate || normalized >= startDate) && (!endDate || normalized <= endDate);
  };
  const filteredPayments = data.payments.filter((payment) => filteredStudentIds.has(payment.studentId) && inDateRange(payment.paidAt));
  const filteredExpenses = data.expenses.filter((expense) => sectionFilter === "all" && inDateRange(expense.spentAt));
  const stats = buildStats(filteredStudents, data.parents, data.feeTypes, filteredPayments);
  const totalPayments = filteredPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalExpenses = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const remaining = Math.max(stats.expected - totalPayments, 0);
  const recoveryRate = stats.expected > 0 ? Math.round((totalPayments / stats.expected) * 100) : 0;
  const recoveryTone = recoveryRate >= 80 ? "text-mint bg-mint/10" : recoveryRate >= 50 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-50";
  const feeProgressRows = Array.from(
    data.feeTypes.reduce<Map<string, { name: string; expected: number; paid: number }>>((items, fee) => {
      const key = fee.name.trim().toLowerCase();
      const applicableStudentIds = new Set(activeStudents.filter((student) => !fee.className || fee.className === student.className).map((student) => student.id));
      const expected = applicableStudentIds.size * fee.amount;
      const paid = data.payments
        .filter((payment) => payment.feeTypeId === fee.id && applicableStudentIds.has(payment.studentId) && inDateRange(payment.paidAt))
        .reduce((sum, payment) => sum + payment.amount, 0);
      const current = items.get(key) ?? { name: fee.name, expected: 0, paid: 0 };
      items.set(key, { ...current, expected: current.expected + expected, paid: current.paid + paid });
      return items;
    }, new Map()).values(),
  )
    .map((row) => {
      const remaining = Math.max(row.expected - row.paid, 0);
      const rate = row.expected > 0 ? Math.round((row.paid / row.expected) * 100) : 0;
      return { ...row, remaining, rate };
    })
    .filter((row) => row.expected > 0);
  const admins = data.users.filter((item) => item.role === "school_admin").length;
  const cashiers = data.users.filter((item) => item.role === "cashier").length;
  const classRows = CLASSES.map((className) => {
    const students = filteredStudents.filter((student) => student.className === className);
    return {
      className,
      girls: students.filter((student) => student.sexe === "F").length,
      boys: students.filter((student) => student.sexe === "M").length,
      total: students.length,
    };
  }).filter((row) => row.total > 0);
  const totalGirls = classRows.reduce((sum, row) => sum + row.girls, 0);
  const totalBoys = classRows.reduce((sum, row) => sum + row.boys, 0);
  const totalStudents = totalGirls + totalBoys;
  const transactions = [
    ...filteredPayments.map((payment) => ({ id: payment.id, type: "Paiement", label: payment.cashierName, amount: payment.amount, date: payment.paidAt })),
    ...filteredExpenses.map((expense) => ({ id: expense.id, type: "D\u00e9pense", label: expense.category, amount: -expense.amount, date: expense.spentAt })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const chartDates = getTransactionPeriodDates(transactionPeriod);
  const transactionChartRows = chartDates.map((date) => {
    const payments = data.payments
      .filter((payment) => filteredStudentIds.has(payment.studentId) && payment.paidAt.slice(0, 10) === date)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const expenses = sectionFilter === "all"
      ? data.expenses.filter((expense) => expense.spentAt.slice(0, 10) === date).reduce((sum, expense) => sum + expense.amount, 0)
      : 0;
    return { date, label: formatChartDate(date), payments, expenses };
  });
  const sectionLabel = sectionFilter === "all" ? "Toutes les sections" : sectionFilter.charAt(0).toUpperCase() + sectionFilter.slice(1);
  const dateLabel = (startDate || "D\u00e9but") + " au " + (endDate || "Fin");
  const cards = [
    { label: "Nombre total d'\u00e9l\u00e8ves", value: stats.students, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre total de parents", value: stats.parents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Administrateurs", value: admins, icon: ShieldCheck, tone: "bg-blue-100 text-blue-700" },
    { label: "Caissiers", value: cashiers, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Montant total encaiss\u00e9", value: "$" + totalPayments.toFixed(2), icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant attendu", value: "$" + stats.expected.toFixed(2), icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
    { label: "Montant restant \u00e0 payer", value: "$" + remaining.toFixed(2), icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
    { label: "Nombre de classes", value: stats.classes, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
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
            <option value="maternelle">Maternelle</option>
            <option value="primaire">Primaire</option>
            <option value="secondaire">Secondaire</option>
          </select>
          <input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" className="input" />
          <input value={endDate} onChange={(event) => setEndDate(event.target.value)} type="date" className="input" />
          <button onClick={exportDashboardPdf} type="button" className="secondary-button justify-center">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
        </div>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <p className="text-sm text-slate-500">{"Recouvrement selon la section et la p\u00e9riode s\u00e9lectionn\u00e9es."}</p>
          </div>
          <span className={"rounded px-3 py-2 text-sm font-bold " + recoveryTone}>{recoveryRate}{"% recouvr\u00e9"}</span>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
          <div className={`h-full rounded ${progressBarTone(recoveryRate)}`} style={{ width: Math.min(100, recoveryRate) + "%" }} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Metric label={"Encaiss\u00e9"} value={"$" + totalPayments.toFixed(2)} />
          <Metric label={"D\u00e9penses"} value={"$" + totalExpenses.toFixed(2)} />
          <Metric label="Attendu" value={"$" + stats.expected.toFixed(2)} />
          <Metric label="Reste" value={"$" + remaining.toFixed(2)} />
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
              {classRows.map((row) => (
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

function PlatformModule({
  user,
  data,
  updateData,
  onLogout,
}: {
  user: AppUser;
  data: AppData;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onLogout: () => void;
}) {
  type PlatformView = "overview" | "schools";
  type SchoolDetailTab = "overview" | "info" | "admins" | "subscription" | "history";
  type SubscriptionFilter = "all" | "active" | "suspended" | "expired";
  type SchoolSort = "az" | "recent" | "users";

  const [schoolName, setSchoolName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState<School["subscriptionPlan"]>("Standard");
  const [platformView, setPlatformView] = useState<PlatformView>("overview");
  const [selectedSchoolId, setSelectedSchoolId] = useState(data.schools[0]?.id ?? "");
  const [detailTab, setDetailTab] = useState<SchoolDetailTab>("overview");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | School["status"]>("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>("all");
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

  const visibleSchools = data.schools.filter((school) => String(school.status) !== "deleted");
  const totalRevenue = visibleSchools.reduce((sum, school) => sum + school.subscriptionAmount, 0);
  const totalStudents = data.students.length;
  const totalParents = data.parents.length;
  const totalAdmins = data.users.filter((item) => item.role === "school_admin").length;
  const activeSchools = visibleSchools.filter((school) => school.status === "active").length;
  const suspendedSchools = visibleSchools.filter((school) => school.status === "suspended").length;
  const selectedSchool = visibleSchools.find((school) => school.id === selectedSchoolId) ?? visibleSchools[0];
  const selectedStats = selectedSchool ? getPlatformSchoolStats(selectedSchool.id, data) : { students: 0, parents: 0, admins: 0, users: 0 };
  const selectedAdmins = selectedSchool ? data.users.filter((item) => item.role === "school_admin" && item.schoolId === selectedSchool.id) : [];
  const selectedMainAdmin = selectedSchool ? selectedAdmins.find((admin) => admin.id === selectedSchool.mainAdminId) ?? selectedAdmins[0] : undefined;
  const selectedLogs = selectedSchool
    ? data.auditLogs.filter((log) => log.schoolId === selectedSchool.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const adminFormValid =
    adminName.trim().length >= 2 &&
    modalAdminEmail.includes("@") &&
    (editingAdminId || modalAdminPassword.length >= 6) &&
    (editingAdminId || modalAdminPassword === modalAdminPasswordConfirm);
  const filteredSchools = visibleSchools
    .filter((school) => school.name.toLowerCase().includes(search.toLowerCase()) || (school.acronym ?? "").toLowerCase().includes(search.toLowerCase()))
    .filter((school) => (statusFilter === "all" ? true : school.status === statusFilter))
    .filter((school) => (subscriptionFilter === "all" ? true : getSubscriptionStatus(school) === subscriptionFilter))
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
    if (!schoolName || !adminEmail || !adminPassword) return;

    setProvisioningError("");
    setProvisioningLoading(true);
    try {
      const provisioned = await provisionSchoolAdmin({
        schoolName,
        adminEmail,
        adminPassword,
        subscriptionPlan,
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
      setAdminEmail("");
      setAdminPassword("");
      setSelectedSchoolId(provisioned.school.id);
      setPlatformView("schools");
      setDetailTab("overview");
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

  function updateSubscription(schoolId: string, plan: School["subscriptionPlan"]) {
    const amount = plan === "Starter" ? 29 : plan === "Premium" ? 99 : 49;
    updateData({
      schools: data.schools.map((school) =>
        school.id === schoolId ? { ...school, subscriptionPlan: plan, subscriptionStatus: "active", subscriptionAmount: amount } : school,
      ),
      auditLogs: [writeAudit(schoolId, `Passage au plan ${plan}`), ...data.auditLogs],
    });
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

  async function deleteSchool(school: School) {
    const confirmation = window.prompt(`Suppression definitive de ${school.name}. Tapez exactement SUPPRIMER ECOLE pour confirmer.`);
    if (confirmation !== "SUPPRIMER ECOLE") return;

    setSchoolActionError("");
    setSchoolActionSuccess("");
    try {
      const payload = await manageSchool({ action: "delete", schoolId: school.id, confirmation });
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
        },
        { persist: false },
      );
      setSelectedSchoolId(remainingSchools[0]?.id ?? "");
      setPlatformView("schools");
      setSchoolActionSuccess(`Ecole ${school.name} supprimee avec succes.`);
    } catch (error) {
      setSchoolActionError(error instanceof Error ? error.message : "Suppression ecole impossible.");
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
      const adminId = await createFirebaseAuthUser(modalAdminEmail, modalAdminPassword);
      const adminUser: AppUser = {
        id: adminId,
        name: adminName,
        email: modalAdminEmail,
        role: "school_admin",
        schoolId: selectedSchool.id,
        activeSchoolYearId: selectedSchool.activeSchoolYearId,
        phone: adminPhone,
        status: "active",
        createdAt: new Date().toISOString(),
      };
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
    setPlatformView("schools");
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-ink">
      <EnvironmentBanner />
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <div className="flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded bg-ink font-bold text-white">A</div>
          <div>
            <p className="font-bold">Acadéa Platform</p>
            <p className="text-xs text-slate-500">Console SaaS</p>
          </div>
        </div>
        <nav className="mt-8 grid gap-1">
          <PlatformNavButton active={platformView === "overview"} icon={LayoutDashboard} label="Vue globale" onClick={() => setPlatformView("overview")} />
          <PlatformNavButton active={platformView === "schools"} icon={Building2} label="Écoles" onClick={() => setPlatformView("schools")} />
        </nav>
        <div className="absolute bottom-5 left-4 right-4 rounded bg-slate-50 p-3 text-xs text-slate-500">
          <p className="font-semibold text-ink">Sécurité multi-tenant</p>
          <p className="mt-1">La plateforme affiche uniquement des statistiques agrégées.</p>
        </div>
      </aside>

      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-ink font-bold text-white lg:hidden">A</div>
            <div className="min-w-0">
              <p className="break-words text-xl font-bold text-ink">Plateforme Acadéa</p>
              <p className="break-words text-xs text-slate-500">{roleLabels[user.role]} | dashboard SaaS anonymisé</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setPlatformView("overview")} className="secondary-button lg:hidden">
              <LayoutDashboard className="h-4 w-4" /> Vue globale
            </button>
            <button onClick={() => setPlatformView("schools")} className="secondary-button lg:hidden">
              <Building2 className="h-4 w-4" /> Écoles
            </button>
            <button onClick={onLogout} className="secondary-button">
              <LogOut className="h-4 w-4" /> Sortir
            </button>
          </div>
          </div>
        </header>

        <main className="grid min-w-0 gap-5 px-3 py-5 sm:px-6 lg:px-8">
          <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PlatformCard label="Écoles" value={data.schools.length} icon={BookOpen} description={`${activeSchools} actives, ${suspendedSchools} suspendues`} tone="mint" />
            <PlatformCard label="Élèves totalisés" value={totalStudents} icon={GraduationCap} description="Chiffre agrégé, sans détail individuel" tone="sky" />
            <PlatformCard label="Parents" value={totalParents} icon={UsersRound} description="Comptes rattachés aux écoles" tone="violet" />
            <PlatformCard label="Revenus globaux" value={`$${totalRevenue.toFixed(2)}`} icon={Banknote} description={`${totalAdmins} administrateurs école`} tone="amber" />
          </section>

          {platformView === "overview" && (
            <section className="grid min-w-0 gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
              <FormPanel title="Créer une école">
                <Field label="Nom de l'école" value={schoolName} onChange={setSchoolName} />
                <Field label="Email admin école" value={adminEmail} onChange={setAdminEmail} type="email" />
                <PasswordField label="Mot de passe admin" value={adminPassword} onChange={setAdminPassword} />
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Abonnement
                  <select value={subscriptionPlan} onChange={(event) => setSubscriptionPlan(event.target.value as School["subscriptionPlan"])} className="input">
                    <option value="Starter">Starter</option>
                    <option value="Standard">Standard</option>
                    <option value="Premium">Premium</option>
                  </select>
                </label>
                {provisioningError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{provisioningError}</p>}
                <button onClick={createSchool} disabled={provisioningLoading} className="primary-button disabled:cursor-not-allowed disabled:opacity-60">
                  <Plus className="h-4 w-4" /> {provisioningLoading ? "Création..." : "Créer"}
                </button>
              </FormPanel>

              <section className="grid min-w-0 gap-4">
                <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold text-ink">Activité plateforme</h2>
                      <p className="text-sm text-slate-500">Vue globale anonymisée des écoles clientes.</p>
                    </div>
                    <span className="rounded bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">SaaS</span>
                  </div>
                  <div className="mt-5 grid h-48 grid-cols-6 items-end gap-3 rounded bg-slate-50 p-4">
                    {[42, 58, 52, 70, 64, 86].map((height, index) => (
                      <div key={index} className="flex h-full items-end">
                        <div className="w-full rounded-t bg-ink" style={{ height: `${height}%` }} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="font-bold text-ink">Écoles récentes</h2>
                      <p className="text-sm text-slate-500">Accès rapide aux comptes école.</p>
                    </div>
                    <button onClick={() => setPlatformView("schools")} className="secondary-button">
                      Voir tout
                    </button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {visibleSchools.slice(0, 3).map((school) => (
                      <SchoolSaasCard
                        key={school.id}
                        school={school}
                        stats={getPlatformSchoolStats(school.id, data)}
                        onSelect={() => selectSchool(school.id)}
                        onEdit={() => void editSchool(school)}
                        onStatus={() => void changeSchoolStatus(school)}
                        onDelete={() => void deleteSchool(school)}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </section>
          )}

          {platformView === "schools" && (
            <section className="grid gap-4">
              {schoolActionError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{schoolActionError}</p>}
              {schoolActionSuccess && <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{schoolActionSuccess}</p>}
              <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_repeat(4,180px)]">
                  <label className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input value={search} onChange={(event) => setSearch(event.target.value)} className="input pl-9" placeholder="Rechercher une école..." />
                  </label>
                  <FilterSelect icon={Filter} value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)}>
                    <option value="all">Tous statuts</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspendue</option>
                  </FilterSelect>
                  <FilterSelect icon={ShieldCheck} value={subscriptionFilter} onChange={(value) => setSubscriptionFilter(value as SubscriptionFilter)}>
                    <option value="all">Tous abonnements</option>
                    <option value="active">Actif</option>
                    <option value="suspended">Suspendu</option>
                    <option value="expired">Expiré</option>
                  </FilterSelect>
                  <FilterSelect icon={Building2} value={typeFilter} onChange={(value) => setTypeFilter(value as typeof typeFilter)}>
                    <option value="all">Tous types</option>
                    <option value="Maternelle">Maternelle</option>
                    <option value="Primaire">Primaire</option>
                    <option value="Secondaire">Secondaire</option>
                    <option value="Mixte">Mixte</option>
                  </FilterSelect>
                  <FilterSelect icon={ArrowUpDown} value={sortBy} onChange={(value) => setSortBy(value as SchoolSort)}>
                    <option value="az">A-Z</option>
                    <option value="recent">Plus récente</option>
                    <option value="users">Plus d'utilisateurs</option>
                  </FilterSelect>
                </div>
              </div>

              <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_460px]">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredSchools.length === 0 && (
                    <div className="rounded border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
                      Aucune école ne correspond aux filtres.
                    </div>
                  )}
                  {filteredSchools.map((school) => (
                    <SchoolSaasCard
                      key={school.id}
                      school={school}
                      stats={getPlatformSchoolStats(school.id, data)}
                      selected={school.id === selectedSchool?.id}
                      onSelect={() => selectSchool(school.id)}
                      onEdit={() => void editSchool(school)}
                      onStatus={() => void changeSchoolStatus(school)}
                      onDelete={() => void deleteSchool(school)}
                    />
                  ))}
                </div>

                {selectedSchool && (
                  <section className="rounded border border-slate-200 bg-white shadow-sm 2xl:sticky 2xl:top-24 2xl:max-h-[calc(100vh-7rem)] 2xl:overflow-y-auto">
                    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <SchoolLogo school={selectedSchool} />
                          <div className="min-w-0">
                            <h2 className="truncate text-lg font-bold text-ink">{selectedSchool.name}</h2>
                            <div className="mt-1 flex flex-wrap gap-2">
                              <StatusBadge status={selectedSchool.status} />
                              <SubscriptionBadge status={getSubscriptionStatus(selectedSchool)} />
                            </div>
                          </div>
                        </div>
                        <button className="rounded border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Actions rapides">
                          <MoreHorizontal className="h-5 w-5" />
                        </button>
                      </div>
                      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                        {(["overview", "info", "admins", "subscription", "history"] as SchoolDetailTab[]).map((tab) => (
                          <button
                            key={tab}
                            onClick={() => setDetailTab(tab)}
                            className={`shrink-0 rounded px-3 py-2 text-xs font-semibold ${detailTab === tab ? "bg-ink text-white" : "bg-slate-100 text-slate-600"}`}
                          >
                            {schoolTabLabel(tab)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="p-4">
                      {detailTab === "overview" && (
                        <div className="grid gap-4">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <MiniStat label="Élèves" value={selectedStats.students} />
                            <MiniStat label="Parents" value={selectedStats.parents} />
                            <MiniStat label="Administrateurs" value={selectedStats.admins} />
                            <MiniStat label="Total utilisateurs" value={selectedStats.users} />
                          </div>
                          <div className="rounded bg-slate-50 p-4">
                            <p className="text-sm font-semibold text-ink">Évolution utilisateurs</p>
                            <div className="mt-4 flex h-32 items-end gap-2">
                              {[35, 48, 46, 61, 72, 80].map((height, index) => (
                                <div key={index} className="flex-1 rounded-t bg-mint" style={{ height: `${height}%` }} />
                              ))}
                            </div>
                          </div>
                          <AuditTimeline logs={selectedLogs.slice(0, 4)} />
                        </div>
                      )}

                      {detailTab === "info" && (
                        <div className="grid gap-3 text-sm">
                          <InfoRow label="Nom" value={selectedSchool.name} />
                          <InfoRow label="Sigle" value={selectedSchool.acronym ?? "-"} />
                          <InfoRow label="Adresse" value={selectedSchool.address || "-"} />
                          <InfoRow label="Téléphone" value={selectedSchool.phone || "-"} />
                          <InfoRow label="Email" value={selectedSchool.email || "-"} />
                          <InfoRow label="Statut" value={selectedSchool.status} />
                          <InfoRow label="Date de creation" value={selectedSchool.createdAt ? new Date(selectedSchool.createdAt).toLocaleDateString("fr-FR") : "-"} />
                          <InfoRow label="Administrateur principal" value={selectedMainAdmin?.name ?? "-"} />
                          <InfoRow label="Nombre d'eleves" value={String(selectedStats.students)} />
                          <InfoRow label="Nombre d'enseignants" value="0" />
                          <InfoRow label="Nombre de classes" value="0" />
                          <InfoRow label="Abonnement" value={selectedSchool.subscriptionPlan} />
                          <InfoRow label="Niveaux" value={(selectedSchool.educationLevels ?? []).join(", ") || "-"} />
                          <InfoRow label="Type" value={selectedSchool.schoolType ?? "-"} />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button onClick={() => void editSchool(selectedSchool)} className="secondary-button">Modifier</button>
                            <button onClick={() => void changeSchoolStatus(selectedSchool)} className="secondary-button">
                              {selectedSchool.status === "active" ? "Suspendre" : "Reactiver"}
                            </button>
                            <button onClick={() => void deleteSchool(selectedSchool)} className="rounded bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">Supprimer</button>
                          </div>
                        </div>
                      )}

                      {detailTab === "admins" && (
                        <div className="grid gap-3">
                          <button onClick={openCreateAdminModal} className="primary-button justify-center">
                            <Plus className="h-4 w-4" /> Ajouter un admin
                          </button>
                          {selectedAdmins.map((admin) => (
                            <div key={admin.id} className="rounded border border-slate-200 p-3">
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                  <p className="font-semibold text-ink">{admin.name}</p>
                                  <p className="text-sm text-slate-500">{admin.email}</p>
                                  <p className="text-xs text-slate-400">{admin.phone ?? "Téléphone non renseigné"}</p>
                                </div>
                                <StatusPill active={admin.status !== "inactive"} />
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button onClick={() => openEditAdminModal(admin)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                  Modifier
                                </button>
                                <button onClick={() => toggleAdminStatus(admin)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                  {admin.status === "inactive" ? "Réactiver" : "Désactiver"}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {detailTab === "subscription" && (
                        <div className="grid gap-4">
                          <div className="rounded bg-slate-50 p-4">
                            <p className="text-sm text-slate-500">Plan actuel</p>
                            <p className="mt-1 text-2xl font-bold text-ink">{selectedSchool.subscriptionPlan}</p>
                            <p className="text-sm text-slate-500">${selectedSchool.subscriptionAmount}/mois</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(["Starter", "Standard", "Premium"] as School["subscriptionPlan"][]).map((plan) => (
                              <button key={plan} onClick={() => updateSubscription(selectedSchool.id, plan)} className="secondary-button">
                                Upgrade {plan}
                              </button>
                            ))}
                            <button
                              onClick={() => void changeSchoolStatus(selectedSchool)}
                              className="rounded bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                            >
                              {selectedSchool.status === "active" ? "Suspendre" : "Reactiver"}
                            </button>
                          </div>
                          <AuditTimeline logs={selectedLogs} />
                        </div>
                      )}

                      {detailTab === "history" && <AuditTimeline logs={selectedLogs} />}
                    </div>
                  </section>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      {adminModalOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4">
          <section className="w-full max-w-lg rounded border border-slate-200 bg-white p-5 shadow-xl">
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

function PlatformCard({
  label,
  value,
  icon: Icon,
  description,
  tone = "mint",
}: {
  label: string;
  value: string | number;
  icon: typeof BookOpen;
  description?: string;
  tone?: "mint" | "sky" | "violet" | "amber";
}) {
  const tones = {
    mint: "bg-mint/10 text-mint",
    sky: "bg-sky-50 text-sky-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700",
  };
  return (
    <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
      {description && <p className="mt-2 text-xs text-slate-500">{description}</p>}
    </article>
  );
}

function PlatformNavButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof BookOpen; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded px-3 py-2 text-sm font-semibold ${active ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-50"}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function SchoolSaasCard({
  school,
  stats,
  selected,
  onSelect,
  onEdit,
  onStatus,
  onDelete,
}: {
  school: School;
  stats: ReturnType<typeof getPlatformSchoolStats>;
  selected?: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onStatus?: () => void;
  onDelete?: () => void;
}) {
  return (
    <article className={`rounded border bg-white p-4 shadow-sm ${selected ? "border-ink ring-2 ring-ink/10" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <SchoolLogo school={school} />
        <div className="min-w-0 flex-1">
          <button onClick={onSelect} className="max-w-full truncate text-left font-bold text-ink underline-offset-4 hover:underline">
            {school.name}
          </button>
          <p className="text-xs text-slate-500">{school.acronym ?? buildAcronym(school.name)}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge status={school.status} />
        <SubscriptionBadge status={getSubscriptionStatus(school)} />
      </div>
      <p className="mt-3 text-sm text-slate-500">{(school.educationLevels ?? ["Primaire"]).join(" · ")}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <MiniStat label="Utilisateurs" value={stats.users} compact />
        <MiniStat label="Plan" value={school.subscriptionPlan} compact />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onEdit ?? onSelect} className="rounded bg-ink px-3 py-2 text-xs font-semibold text-white">
          Modifier
        </button>
        <button onClick={onStatus ?? onSelect} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          {school.status === "active" ? "Suspendre" : "Reactiver"}
        </button>
        <button onClick={onDelete ?? onSelect} className="rounded bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          Supprimer
        </button>
      </div>
    </article>
  );
}

function SchoolLogo({ school }: { school: School }) {
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50 text-sm font-bold text-ink">
      {school.logoUrl ? <img src={school.logoUrl} alt="" className="h-full w-full object-cover" /> : school.acronym ?? buildAcronym(school.name)}
    </div>
  );
}

function StatusBadge({ status }: { status: School["status"] }) {
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold ${status === "active" ? "bg-mint/10 text-mint" : "bg-red-50 text-red-700"}`}>
      {status === "active" ? "Active" : "Suspendue"}
    </span>
  );
}

function SubscriptionBadge({ status }: { status: NonNullable<School["subscriptionStatus"]> }) {
  const classes = {
    active: "bg-mint/10 text-mint",
    suspended: "bg-amber-50 text-amber-700",
    expired: "bg-red-50 text-red-700",
  };
  const labels = {
    active: "Abonnement actif",
    suspended: "Abonnement suspendu",
    expired: "Abonnement expiré",
  };
  return <span className={`rounded px-2 py-1 text-xs font-semibold ${classes[status]}`}>{labels[status]}</span>;
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

function MiniStat({ label, value, compact }: { label: string; value: string | number; compact?: boolean }) {
  return (
    <div className={`rounded bg-slate-50 ${compact ? "p-3" : "p-4"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`${compact ? "text-lg" : "text-2xl"} mt-1 font-bold text-ink`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-ink">{value}</p>
    </div>
  );
}

function AuditTimeline({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
        Aucun historique pour cette école.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <p className="text-sm font-semibold text-ink">Historique</p>
      {logs.map((log) => (
        <div key={log.id} className="flex gap-3 rounded border border-slate-200 p-3">
          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600">
            <Clock3 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">{log.action}</p>
            <p className="text-xs text-slate-500">
              {log.actorName} · {new Date(log.createdAt).toLocaleString("fr-FR")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

type ActivityHistoryItem = {
  id: string;
  type: "activity" | "message";
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
  const items = buildActivityHistoryItems(user, data, yearData, role);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    const text = `${item.title} ${item.actorName} ${item.details}`.toLowerCase();
    return matchesType && (!normalizedQuery || text.includes(normalizedQuery));
  });

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
        </select>
      </div>

      <div className="space-y-2">
        {filteredItems.length === 0 && (
          <p className="rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">Aucun historique trouvé.</p>
        )}
        {filteredItems.map((item) => (
          <article key={item.id} className="min-w-0 rounded border border-slate-200 bg-white p-3 text-sm">
            <div className="flex min-w-0 items-start gap-3">
              <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded ${item.type === "message" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                {item.type === "message" ? <MessageSquare className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-semibold text-ink">{item.title}</p>
                  <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-500">
                    {item.type === "message" ? "Message" : "Activité"}
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

function buildActivityHistoryItems(user: AppUser, data: AppData, yearData: ReturnType<typeof scopeData>, role: "admin" | "cashier" | "parent") {
  const usersById = new Map(data.users.map((item) => [item.id, item]));
  const parentsById = new Map(yearData.parents.map((item) => [item.id, item]));
  const auditItems = yearData.auditLogs
    .filter((log) => {
      const actor = usersById.get(log.actorId);
      if (role === "admin") return log.actorId === user.id || actor?.role === "cashier";
      if (role === "cashier") return log.actorId === user.id;
      return log.actorId === user.id;
    })
    .map<ActivityHistoryItem>((log) => ({
      id: `audit-${log.id}`,
      type: "activity",
      title: log.action,
      actorName: log.actorName,
      details: log.details ?? "",
      createdAt: log.createdAt,
    }));

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
          ? "École"
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

  return [...auditItems, ...messageItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getPlatformSchoolStats(schoolId: string, data: AppData) {
  const students = data.students.filter((student) => student.schoolId === schoolId).length;
  const parents = data.parents.filter((parent) => parent.schoolId === schoolId).length;
  const admins = data.users.filter((item) => item.role === "school_admin" && item.schoolId === schoolId).length;
  const users = data.users.filter((item) => item.schoolId === schoolId).length;
  return { students, parents, admins, users };
}

function getSubscriptionStatus(school: School): NonNullable<School["subscriptionStatus"]> {
  return school.subscriptionStatus ?? (school.status === "suspended" ? "suspended" : "active");
}

function buildAcronym(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.slice(0, 1).toUpperCase())
    .join("");
}

function schoolTabLabel(tab: "overview" | "info" | "admins" | "subscription" | "history") {
  const labels = {
    overview: "Overview",
    info: "Informations",
    admins: "Administrateurs",
    subscription: "Abonnement",
    history: "Historique",
  };
  return labels[tab];
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
  onLogout,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [activeParentTab, setActiveParentTab] = useState<ParentTab>("children");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [parentHistoryOpen, setParentHistoryOpen] = useState(false);
  const parent = yearData.parents.find((item) => item.id === user.parentId);
  const unread = yearData.notifications.filter((notification) => !notification.read).length;
  const parentMessages = yearData.messages.filter((message) => message.threadParentId === user.parentId);

  function sendParentMessage() {
    if (!subject || !body || !user.parentId) return;
    const message: Message = {
      id: uid("msg"),
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId: "school",
      threadParentId: user.parentId,
      subject,
      body,
      createdAt: new Date().toISOString(),
    };
    const notification: AppNotification = {
      id: uid("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "school",
      messageId: message.id,
      type: "message",
      title: "Nouveau message parent",
      body: `${parent?.fullName ?? user.name}: ${subject}`,
      createdAt: message.createdAt,
      read: false,
    };
    updateData({ messages: [message, ...data.messages], notifications: [notification, ...data.notifications] });
    setSubject("");
    setBody("");
  }

  function markNotificationsRead() {
    updateData({
      notifications: data.notifications.map((notification) =>
        notification.parentId === user.parentId && notification.schoolYearId === year.id ? { ...notification, read: true } : notification,
      ),
    });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
      <EnvironmentBanner />
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl min-w-0 flex-col gap-3 px-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-ink font-bold text-white">A</div>
            <div className="min-w-0">
              <p className="break-words text-lg font-bold text-ink">{school.name}</p>
              <p className="break-words text-xs text-slate-500">Espace Parent | {parent?.fullName ?? user.name} | {year.name}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
            <button onClick={onRefresh} className="inline-flex h-9 w-9 items-center justify-center text-slate-500 transition hover:text-ink" title="Actualiser" aria-label="Actualiser">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={markNotificationsRead} className="relative inline-flex h-9 w-9 items-center justify-center text-slate-500 transition hover:text-ink" title="Notifications" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {unread > 0 && <span className="absolute right-0 top-0 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">{unread}</span>}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-7xl min-w-0 flex-1 gap-4 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
        <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-ink">{activeParentTab === "children" ? "Mes enfants" : activeParentTab === "messages" ? "Message" : "Menu"}</h1>
              <p className="break-words text-sm text-slate-500">
                {activeParentTab === "children"
                  ? "Consultation limitée aux élèves rattachés à ce parent."
                  : activeParentTab === "messages"
                    ? "Notifications et conversation avec l'école."
                    : "Options du compte parent."}
              </p>
            </div>
          </div>
        </section>

        <section className="grid min-w-0 gap-4">
          {activeParentTab === "children" && (
          <div className="grid min-w-0 gap-4">
            {yearData.students.map((student) => {
              const balance = getStudentBalance(student.id, yearData.feeTypes, yearData.payments, yearData.students);
              const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
              const payments = yearData.payments.filter((payment) => payment.studentId === student.id);
              return (
                <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                  <div className="flex min-w-0 flex-col gap-4 md:flex-row">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-xl font-bold text-ink">
                      {student.photoUrl ? <img src={student.photoUrl} alt="" className="h-full w-full object-cover" /> : student.prenom.slice(0, 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h2 className="break-words text-xl font-bold text-ink">{student.nom} {student.postnom} {student.prenom}</h2>
                          <p className="break-words text-sm text-slate-500">{student.className} | {year.name}</p>
                        </div>
                        <span className="shrink-0 rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">{progress}% payé</span>
                      </div>
                      <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
                        <div className="h-full rounded bg-mint" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <Metric label="Total frais" value={`$${balance.expected}`} />
                        <Metric label="Total payé" value={`$${balance.paid}`} />
                        <Metric label="Solde" value={`$${balance.remaining}`} />
                      </div>
                      <div className="mt-4">
                        <p className="mb-2 text-sm font-semibold text-ink">Historique des paiements</p>
                        <div className="max-h-48 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                          {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
                          {payments.map((payment) => {
                            const fee = yearData.feeTypes.find((item) => item.id === payment.feeTypeId);
                            return (
                              <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                                <span className="font-semibold text-ink">${payment.amount}</span>
                                <span className="break-words text-slate-500"> | {fee?.name ?? "Frais"} | {payment.paidAt}</span>
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
          <div className="min-w-0 space-y-4">
            <FormPanel title="Notifications">
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                {yearData.notifications.length === 0 && <p className="text-sm text-slate-500">Aucune notification.</p>}
                {yearData.notifications.map((notification) => (
                  <div key={notification.id} className={`min-w-0 rounded border p-3 text-sm ${notification.read ? "border-slate-100 bg-white" : "border-mint/30 bg-mint/5"}`}>
                    <p className="break-words font-semibold text-ink">{notification.title}</p>
                    <p className="break-words text-slate-600">{notification.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(notification.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                ))}
              </div>
            </FormPanel>

            <FormPanel title="Message à l'école">
              <input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />
              <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-32" placeholder="Message" />
              <button onClick={sendParentMessage} disabled={!subject || !body} className="primary-button disabled:opacity-50">
                <Send className="h-4 w-4" /> Envoyer
              </button>
            </FormPanel>

            <FormPanel title="Conversation">
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                {parentMessages.length === 0 && <p className="text-sm text-slate-500">Aucun message.</p>}
                {parentMessages.map((message) => (
                  <div key={message.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                    <p className="break-words font-semibold text-ink">{message.subject}</p>
                    <p className="break-words text-slate-600">{message.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(message.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                ))}
              </div>
            </FormPanel>
          </div>
          )}
        </section>

        {activeParentTab === "menu" && (
          <section className="grid min-w-0 gap-4">
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

            <FormPanel title="Compte parent">
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Parent" value={parent?.fullName ?? user.name} />
                <Metric label="Email" value={user.email} />
                <Metric label="École" value={school.name} />
                <Metric label="Année scolaire" value={year.name} />
                <Metric label="Enfant(s)" value={String(yearData.students.length)} />
                <Metric label="Notification(s)" value={String(unread)} />
              </div>
            </FormPanel>

            <div className="mt-2 border-t border-slate-200 pt-4">
              <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
                <LogOut className="h-4 w-4" /> Déconnexion
              </button>
            </div>
          </section>
        )}
      </main>

      {parentHistoryOpen && (
        <AdminDrawer title="Historique" onClose={() => setParentHistoryOpen(false)} closeLabel="Fermer l'historique">
          <ActivityHistoryContent user={user} data={data} yearData={yearData} role="parent" />
        </AdminDrawer>
      )}

      <ParentBottomNavigation activeTab={activeParentTab} onTab={setActiveParentTab} />
    </div>
  );
}

function ParentBottomNavigation({ activeTab, onTab }: { activeTab: ParentTab; onTab: (tab: ParentTab) => void }) {
  const tabs = [
    { id: "children", label: "Enfants", icon: GraduationCap },
    { id: "messages", label: "Message", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] satisfies { id: ParentTab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-1">
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
      </div>
    </nav>
  );
}

function StudentsModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  onOpenStudent,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [classFilter, setClassFilter] = useState("");
  const [optionFilter, setOptionFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [schoolOptions, setSchoolOptions] = useState<string[]>(["Littéraire", "Pédagogie", "Sciences", "Commerciale"]);
  const [form, setForm] = useState<Student>(() => emptyStudent(school.id, year.id));
  const [quickParent, setQuickParent] = useState({ fullName: "", phone: "", email: "", password: "" });
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const canEdit = user.role === "school_admin";
  const studentClassChoices = CLASSES.filter((className) => className !== "Humanités");
  const availableClasses = studentClassChoices.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);
  const optionChoices = Array.from(new Set([...schoolOptions, ...yearData.students.map((student) => student.option).filter(Boolean)])) as string[];

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

  function saveStudent() {
    setSaveError("");
    setSaveMessage("");
    const exists = data.students.some((item) => item.id === form.id);
    const targetYearId = exists ? form.schoolYearId : year.id;
    const targetYearName = exists ? data.schoolYears.find((item) => item.id === form.schoolYearId)?.name ?? year.name : year.name;
    const matricule = exists ? form.matricule : generateMatricule(data.students, targetYearName, school.id, targetYearId);
    const student = {
      ...form,
      matricule,
      section: getClassSection(form.className),
      status: form.status ?? "ACTIVE",
      schoolId: school.id,
      schoolYearId: targetYearId,
      annee_scolaire_id: targetYearId,
    };
    const parents = data.parents.map((parent) => {
      const withoutStudent = parent.studentIds.filter((studentId) => studentId !== student.id);
      return parent.id === student.parentId ? { ...parent, studentIds: [...withoutStudent, student.id] } : { ...parent, studentIds: withoutStudent };
    });
    const users = data.users.map((item) => {
      if (item.role !== "parent" || !item.parentId) return item;
      const parent = parents.find((parentItem) => parentItem.id === item.parentId);
      return parent ? { ...item, studentIds: parent.studentIds } : item;
    });
    updateData({
      students: exists ? data.students.map((item) => (item.id === student.id ? student : item)) : [...data.students, student],
      parents,
      users,
      auditLogs: [
        createAuditLog(user, school.id, targetYearId, exists ? "Modification élève" : "Création élève", `${student.matricule} - ${student.nom} ${student.prenom}`),
        ...data.auditLogs,
      ],
    });
    setForm(emptyStudent(school.id, year.id));
    setShowForm(false);
    setSaveMessage(exists ? "Élève modifié avec succès." : "Élève enregistré avec succès.");
  }

  function openAddStudentForm() {
    setForm(emptyStudent(school.id, year.id));
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
    const student = data.students.find((item) => item.id === id);
    if (!student) return;
    const reason = prompt("Motif obligatoire: Renvoi définitif, Décès, Abandon ou Autre avec précision");
    if (!reason) return;
    const normalized = reason.toLowerCase();
    const status = normalized.includes("décès") || normalized.includes("deces") ? "DECEASED" : normalized.includes("abandon") ? "DROPPED" : "TRANSFERRED";
    updateData({
      students: data.students.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              exitReason: reason.includes("Autre") ? "Autre" : normalized.includes("décès") || normalized.includes("deces") ? "Décès" : normalized.includes("abandon") ? "Abandon" : "Renvoi définitif",
              exitReasonDetails: reason,
              deletedAt: new Date().toISOString(),
            }
          : item,
      ),
      auditLogs: [createAuditLog(user, school.id, year.id, "Archivage élève", `${student.matricule} - ${reason}`), ...data.auditLogs],
    });
  }

  async function createParentForStudent() {
    setSaveError("");
    if (!quickParent.fullName || !quickParent.phone || !quickParent.email) return;
    const parentId = uid("parent");
    const existingUser = data.users.find((item) => item.email.toLowerCase() === quickParent.email.toLowerCase());
    if (existingUser) {
      setSaveError("Un compte existe deja avec cet email.");
      return;
    }
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
          email: quickParent.email,
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
      email: quickParent.email,
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
    setSchoolOptions((current) => (current.some((item) => item.toLowerCase() === trimmed.toLowerCase()) ? current : [...current, trimmed]));
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
    exportStudentsPdf(school, year, students, filters);
  }

  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <SectionTitle title="Élèves" subtitle="Ajouter, modifier, rechercher et filtrer par direction puis classe." />
        {saveError && <p className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{saveError}</p>}
        {saveMessage && <p className="mb-3 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{saveMessage}</p>}
        {canEdit && (
          <button onClick={openAddStudentForm} className="primary-button mb-3">
            <Plus className="h-4 w-4" /> Ajouter un élève
          </button>
        )}
        <div className="mb-3 grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_160px_180px_220px]">
          <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" className="min-w-0 flex-1 outline-none" />
          </label>
          <select value={archiveFilter} onChange={(event) => setArchiveFilter(event.target.value as typeof archiveFilter)} className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2">
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
            className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2"
          >
            <option value="all">Toutes les sections</option>
            <option value="maternelle">Maternelle</option>
            <option value="primaire">Primaire</option>
            <option value="secondaire">Secondaire</option>
          </select>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2">
            <option value="">Toutes les classes</option>
            {availableClasses.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
        </div>
        <div className="mb-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select value={optionFilter} onChange={(event) => setOptionFilter(event.target.value)} className="min-w-0 rounded border border-slate-200 bg-white px-3 py-2">
            <option value="">Toutes les options</option>
            {optionChoices.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <button onClick={printStudentsPdf} type="button" className="secondary-button justify-center">
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
                    <span className={`rounded px-2 py-1 text-xs font-semibold ${archived ? "bg-slate-200 text-slate-700" : "bg-mint/10 text-mint"}`}>
                      {archived ? "Archivé" : "Actif"}
                    </span>
                  </td>
                  <td className="px-3 py-3">{student.sexe}</td>
                  <td className="px-3 py-3">{student.className}</td>
                  <td className="px-3 py-3">{student.phone}</td>
                  <td className="px-3 py-3">
                    {archived ? (
                      <div className="max-w-[260px] text-xs text-slate-600">
                        <p className="break-words font-semibold text-ink">{student.exitReasonDetails ?? student.exitReason ?? "Motif non renseigné"}</p>
                        <p className="mt-1 text-slate-500">{formatArchiveDate(student.deletedAt)}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {canEdit ? (
                      <div className="flex gap-1">
                        {archived ? (
                          <IconButton label="Consulter" onClick={() => onOpenStudent(student.id)} icon={Eye} />
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
          />
        </AdminDrawer>
      )}
    </section>
  );
}

function StudentDetailPage({
  studentId,
  yearData,
  year,
  school,
  onBack,
}: {
  studentId: string;
  yearData: ReturnType<typeof scopeData>;
  year: SchoolYear;
  school: School;
  onBack: () => void;
}) {
  const student = yearData.students.find((item) => item.id === studentId);

  if (!student) {
    return (
      <section className="grid gap-4">
        <button onClick={onBack} className="secondary-button w-fit">← Retour à la liste des élèves</button>
        <FormPanel title="Élève introuvable">
          <p className="text-sm text-slate-500">Aucun élève ne correspond à ce dossier dans l'année scolaire sélectionnée.</p>
        </FormPanel>
      </section>
    );
  }

  const balance = getStudentBalance(student.id, yearData.feeTypes, yearData.payments, yearData.students);
  const payments = yearData.payments.filter((payment) => payment.studentId === student.id);
  const parent = yearData.parents.find((item) => item.id === student.parentId);
  const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
  const archived = isArchivedStudent(student);

  return (
    <section className="grid min-w-0 gap-4">
      <button onClick={onBack} className="secondary-button w-fit">← Retour à la liste des élèves</button>

      <article className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-2xl font-bold text-ink">
            {student.photoUrl ? <img src={student.photoUrl} alt="" className="h-full w-full object-cover" /> : student.prenom.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <h1 className="break-words text-2xl font-bold text-ink">{student.nom} {student.postnom} {student.prenom}</h1>
            <p className="break-words text-sm text-slate-500">{student.matricule} | {student.className} | {year.name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{student.className}</span>
              <span className={`rounded px-2 py-1 text-xs font-semibold ${archived ? "bg-slate-200 text-slate-700" : "bg-mint/10 text-mint"}`}>
                {archived ? "Archivé" : "Actif"}
              </span>
            </div>
          </div>
        </div>
      </article>

      <section className="grid min-w-0 gap-4">
        <FormPanel title="Informations générales">
          <Metric label="Sexe" value={student.sexe} />
          <Metric label="Date de naissance" value={student.birthDate} />
          <Metric label="Adresse" value={student.address} />
          <Metric label="Téléphone" value={student.phone} />
          <Metric label="Parent" value={parent?.fullName ?? "Non renseigné"} />
          {archived && (
            <>
              <Metric label="Motif d'archivage" value={student.exitReasonDetails ?? student.exitReason ?? "Motif non renseigné"} />
              <Metric label="Date d'archivage" value={formatArchiveDate(student.deletedAt)} />
            </>
          )}
        </FormPanel>

        <FormPanel title="Paiements">
          <Metric label="Total frais" value={`$${balance.expected}`} />
          <Metric label="Total payé" value={`$${balance.paid}`} />
          <Metric label="Solde" value={`$${balance.remaining}`} />
          <div className="h-3 overflow-hidden rounded bg-slate-100">
            <div className="h-full rounded bg-mint" style={{ width: `${progress}%` }} />
          </div>
        </FormPanel>

        <FormPanel title="Historique des paiements">
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement enregistré.</p>}
            {payments.map((payment) => {
              const fee = yearData.feeTypes.find((item) => item.id === payment.feeTypeId);
              return (
                <div key={payment.id} className="min-w-0 rounded border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{fee?.name ?? "Frais"}</p>
                    <button onClick={() => fee && generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="break-words text-slate-500">${payment.amount} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
          </div>
        </FormPanel>
      </section>
    </section>
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
  const [form, setForm] = useState<ParentProfile>(() => emptyParent(school.id, year.id));
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [parentError, setParentError] = useState("");
  const [parentSuccess, setParentSuccess] = useState("");
  const [showParentPassword, setShowParentPassword] = useState(false);
  const filteredParents = yearData.parents.filter((parent) => {
    const text = `${parent.fullName} ${parent.email} ${parent.phone}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  async function saveParentProfile() {
    setParentError("");
    setParentSuccess("");
    if (!form.fullName || !form.email || !form.phone) return;

    const isNew = form.id.startsWith("new");
    const parentId = isNew ? uid("parent") : form.id;
    const existingUser = data.users.find((item) => item.id === form.userId || item.parentId === parentId);
    if ((isNew || !existingUser) && !password) {
      setParentError("Mot de passe requis pour créer le compte Firebase Auth du parent.");
      return;
    }
    let userId = existingUser?.id;
    if (isNew || !existingUser) {
      try {
        const provisioned = await provisionParent({
          schoolId: school.id,
          schoolYearId: year.id,
          parentId,
          name: form.fullName,
          email: form.email,
          password,
          phone: form.phone,
          address: form.address,
          studentIds: form.studentIds,
          status: form.status ?? "active",
        });
        userId = provisioned.user.id;
      } catch (error) {
        setParentError(error instanceof Error ? `Provisionnement parent impossible : ${error.message}` : "Provisionnement parent impossible.");
        return;
      }
    }
    if (!userId) return;
    const parent: ParentProfile = {
      ...form,
      id: parentId,
      userId,
      schoolId: school.id,
      schoolYearId: year.id,
      status: form.status ?? "active",
      studentIds: form.studentIds,
    };
    const parentUser: AppUser = {
      id: userId,
      name: parent.fullName,
      email: parent.email,
      role: "parent",
      schoolId: school.id,
      activeSchoolYearId: year.id,
      parentId: parent.id,
      studentIds: parent.studentIds,
      status: parent.status,
      phone: parent.phone,
      address: parent.address,
    };
    const nextParents = isNew ? [...data.parents, parent] : data.parents.map((item) => (item.id === parent.id ? parent : item));
    const nextUsers = isNew || !existingUser ? [...data.users, parentUser] : data.users.map((item) => (item.id === userId ? { ...item, ...parentUser } : item));
    const nextStudents = data.students.map((student) => {
      if (parent.studentIds.includes(student.id)) return { ...student, parentId: parent.id };
      if (student.parentId === parent.id) return { ...student, parentId: undefined };
      return student;
    });

    if (isNew || !existingUser) {
      updateData({ parents: nextParents, users: nextUsers }, { persist: false });
      updateData({ students: nextStudents });
    } else {
      updateData({ parents: nextParents, users: nextUsers, students: nextStudents });
    }
    setForm(emptyParent(school.id, year.id));
    setPassword("");
    if (isNew || !existingUser) {
      setParentSuccess("Compte parent créé avec succès. Il peut maintenant se connecter avec son email et son mot de passe.");
    }
  }

  function toggleParent(parent: ParentProfile) {
    const status = parent.status === "active" ? "inactive" : "active";
    updateData({
      parents: data.parents.map((item) => (item.id === parent.id ? { ...item, status } : item)),
      users: data.users.map((item) => (item.parentId === parent.id ? { ...item, status } : item)),
    });
  }

  function editParent(parent: ParentProfile) {
    setForm(parent);
    setPassword("");
    setParentSuccess("");
  }

  function deleteParent(parent: ParentProfile) {
    if (!confirm(`Supprimer le parent ${parent.fullName} et détacher ses élèves ?`)) return;
    updateData({
      parents: data.parents.filter((item) => item.id !== parent.id),
      users: data.users.filter((item) => item.parentId !== parent.id && item.id !== parent.userId),
      students: data.students.map((student) => (student.parentId === parent.id ? { ...student, parentId: undefined } : student)),
    });
    setForm(emptyParent(school.id, year.id));
  }


  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <SectionTitle title="Parents" subtitle="Comptes parents, statut et liaison unique avec les élèves." />
        {parentError && <p className="mb-3 rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{parentError}</p>}
        {parentSuccess && <p className="mb-3 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{parentSuccess}</p>}
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
                  <div className="flex flex-wrap gap-2">
                    <IconButton label="Modifier" onClick={() => editParent(parent)} icon={Edit3} />
                    <IconButton label="Supprimer" onClick={() => deleteParent(parent)} icon={Trash2} danger />
                    <button onClick={() => toggleParent(parent)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                      {parent.status === "active" ? "Désactiver" : "Réactiver"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <FormPanel title={form.id.startsWith("new") ? "Créer un parent" : "Modifier le parent"}>
        <Field label="Nom complet" value={form.fullName} onChange={(value) => setForm({ ...form, fullName: value })} />
        <Field label="Téléphone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <Field label="Adresse e-mail" value={form.email} onChange={(value) => setForm({ ...form, email: value })} type="email" />
        <Field label="Adresse" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
        {form.id.startsWith("new") && (
          <PasswordField
            label="Mot de passe temporaire"
            value={password}
            onChange={setPassword}
            visible={showParentPassword}
            onToggle={() => setShowParentPassword(!showParentPassword)}
          />
        )}
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Élèves liés
          <select
            multiple
            value={form.studentIds}
            onChange={(event) => setForm({ ...form, studentIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}
            className="input min-h-32"
          >
            {yearData.students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.nom} {student.prenom}{student.parentId && student.parentId !== form.id ? " - déjà lié" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="grid min-w-0 grid-cols-2 gap-2">
          <button onClick={() => setForm(emptyParent(school.id, year.id))} className="secondary-button">Annuler</button>
          <button onClick={saveParentProfile} className="primary-button"><CheckCircle2 className="h-4 w-4" /> Enregistrer</button>
        </div>
      </FormPanel>
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
  const [amountComparator, setAmountComparator] = useState<"all" | ">=" | "<">("all");
  const [amountThreshold, setAmountThreshold] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cashierControlDrawer, setCashierControlDrawer] = useState<"payment" | "expense" | "history" | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState("");
  const canPay = user.role === "cashier";
  const canCorrectPayments = user.role === "school_admin";
  const selectedPaymentStudent = yearData.students.find((student) => student.id === studentId);
  const selectedPaymentBalance = selectedPaymentStudent
    ? getStudentBalance(selectedPaymentStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const payableFeeTypes = selectedPaymentStudent ? yearData.feeTypes.filter((fee) => !fee.className || fee.className === selectedPaymentStudent.className) : [];
  const selectedFeeTypeValue = payableFeeTypes.some((fee) => fee.id === feeTypeId) ? feeTypeId : payableFeeTypes[0]?.id ?? "";
  const selectedPaymentFee = payableFeeTypes.find((fee) => fee.id === selectedFeeTypeValue);
  const selectedPaymentFeePaid = selectedPaymentStudent && selectedPaymentFee
    ? yearData.payments
        .filter((payment) => payment.studentId === selectedPaymentStudent.id && payment.feeTypeId === selectedPaymentFee.id)
        .reduce((sum, payment) => sum + payment.amount, 0)
    : 0;
  const selectedPaymentFeeRemaining = selectedPaymentFee ? Math.max(selectedPaymentFee.amount - selectedPaymentFeePaid, 0) : 0;
  const isPaymentEntryDisabled = !selectedPaymentFee || selectedPaymentFeeRemaining <= 0;
  const selectedHistoryStudent = yearData.students.find((student) => student.id === selectedHistoryStudentId);
  const paymentStudentSearch = paymentStudentQuery.trim().toLowerCase();
  const paymentStudentResults = paymentStudentSearch
    ? yearData.students.filter((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`.toLowerCase().includes(paymentStudentSearch)).slice(0, 8)
    : [];

  const rows = yearData.students
    .map((student) => ({ student, balance: getStudentBalance(student.id, yearData.feeTypes, yearData.payments, yearData.students) }))
    .filter((row) => {
      if (amountComparator === "all" || !amountThreshold) return true;
      return amountComparator === ">=" ? row.balance.paid >= Number(amountThreshold) : row.balance.paid < Number(amountThreshold);
    });
  const historyPayments = yearData.payments
    .map((payment) => {
      const student = yearData.students.find((item) => item.id === payment.studentId);
      const fee = yearData.feeTypes.find((item) => item.id === payment.feeTypeId);
      return student && fee ? { payment, student, fee } : null;
    })
    .filter((item): item is { payment: Payment; student: Student; fee: FeeType } => Boolean(item));
  const filteredHistoryPayments = historyPayments.filter(({ student }) => {
    const query = historyQuery.trim().toLowerCase();
    if (!query) return true;
    return `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`.toLowerCase().includes(query);
  });
  const selectedHistoryBalance = selectedHistoryStudent
    ? getStudentBalance(selectedHistoryStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const selectedHistoryPayments = selectedHistoryStudent
    ? yearData.payments
        .filter((payment) => payment.studentId === selectedHistoryStudent.id)
        .map((payment) => ({
          payment,
          fee: yearData.feeTypes.find((item) => item.id === payment.feeTypeId),
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
  const cashierDrawerTitle =
    cashierControlDrawer === "payment"
      ? "Enregistrer un paiement"
      : cashierControlDrawer === "expense"
        ? "Enregistrer une dépense"
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

  function isStudentPaymentComplete(balance: { expected: number; paid: number }) {
    return balance.expected > 0 && balance.paid === balance.expected;
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
    const feePaid = yearData.payments
      .filter((payment) => payment.studentId === selectedPaymentStudent.id && payment.feeTypeId === selectedPaymentFee.id)
      .reduce((sum, payment) => sum + payment.amount, 0);
    if (feePaid + paymentAmount > selectedPaymentFee.amount) {
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
          body: `Un paiement de $${paymentAmount.toFixed(2)} a été enregistré pour ${student.nom} ${student.prenom}.`,
          createdAt: new Date().toISOString(),
          read: false,
        }
      : undefined;
    updateData({
      payments: [...data.payments, payment],
      notifications: notification ? [notification, ...data.notifications] : data.notifications,
      auditLogs: [createAuditLog(user, school.id, year.id, "Création paiement", `${payment.receiptNumber} - $${payment.amount}`), ...data.auditLogs],
    });
    setAmount("");
  }

  function saveExpense() {
    if (!expenseAmount || !expenseDescription) return;
    const expense: Expense = {
      id: uid("expense"),
      schoolId: school.id,
      schoolYearId: year.id,
      amount: Number(expenseAmount),
      category: expenseCategory,
      description: expenseDescription,
      spentAt: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      cashierName: user.name,
    };
    updateData({
      expenses: [expense, ...data.expenses],
      auditLogs: [createAuditLog(user, school.id, year.id, "Création dépense", `${expense.category} - $${expense.amount}`), ...data.auditLogs],
    });
    setExpenseAmount("");
    setExpenseDescription("");
  }

  function correctPayment(payment: Payment) {
    const nextAmount = prompt("Nouveau montant du paiement", String(payment.amount));
    if (!nextAmount) return;
    const correctedAmount = Number(nextAmount);
    if (!Number.isFinite(correctedAmount) || correctedAmount <= 0) {
      alert("Montant de paiement invalide.");
      return;
    }
    const paymentStudent = yearData.students.find((student) => student.id === payment.studentId);
    const paymentFee = paymentStudent
      ? yearData.feeTypes.find((fee) => fee.id === payment.feeTypeId && (!fee.className || fee.className === paymentStudent.className))
      : undefined;
    const paidForFee = paymentStudent && paymentFee
      ? yearData.payments
          .filter((item) => item.studentId === paymentStudent.id && item.feeTypeId === paymentFee.id && item.id !== payment.id)
          .reduce((sum, item) => sum + item.amount, 0)
      : 0;
    if (!paymentFee || paidForFee + correctedAmount > paymentFee.amount) {
      alert("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const reason = prompt("Motif obligatoire de correction");
    if (!reason) return;
    updateData({
      payments: data.payments.map((item) =>
        item.id === payment.id ? { ...item, amount: correctedAmount, updatedAt: new Date().toISOString(), correctionReason: reason } : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Correction paiement", `${payment.receiptNumber ?? payment.id}: ancien $${payment.amount}, nouveau $${correctedAmount}. Motif: ${reason}`),
        ...data.auditLogs,
      ],
    });
  }

  function deletePayment(payment: Payment) {
    const reason = prompt("Motif obligatoire de suppression du paiement");
    if (!reason) return;
    updateData({
      payments: data.payments.filter((item) => item.id !== payment.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression paiement", `${payment.receiptNumber ?? payment.id}: $${payment.amount}. Motif: ${reason}`), ...data.auditLogs],
    });
  }

  async function printFilteredStudents() {
    const filterLabel =
      amountComparator === "all" || !amountThreshold
        ? "Montant payé : tous"
        : `Montant payé ${amountComparator} ${amountThreshold}`;
    const showOptionColumn = rows.some(({ student }) => Boolean(student.option));
    const studentPaymentColumns: PdfTableColumn<(typeof rows)[number]>[] = [
      { header: "Nom de l'élève", render: ({ student }) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() },
      { header: "Matricule", render: ({ student }) => student.matricule },
      { header: "Classe", render: ({ student }) => student.className },
      { header: "Montant prévu", render: ({ balance }) => formatMoney(balance.expected), align: "right" },
      { header: "Montant payé", render: ({ balance }) => formatMoney(balance.paid), align: "right" },
      { header: "Solde restant", render: ({ balance }) => formatMoney(balance.remaining), align: "right" },
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
            rows,
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
            { label: "Classe", value: selectedHistoryStudent.className },
            { label: "Total payé", value: formatMoney(selectedHistoryBalance.paid) },
            { label: "Total restant", value: formatMoney(selectedHistoryBalance.remaining) },
          ]),
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
                {selectedHistoryStudent.matricule} | {selectedHistoryStudent.className}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button onClick={() => createStudentHistoryPdf("view")} className="secondary-button justify-center" type="button">
              <Eye className="h-4 w-4" /> Voir PDF
            </button>
            <button onClick={() => createStudentHistoryPdf("print")} className="primary-button justify-center" type="button">
              <Download className="h-4 w-4" /> Imprimer PDF
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <Metric label="Total attendu" value={formatMoney(selectedHistoryBalance.expected)} />
          <Metric label="Total paye" value={formatMoney(selectedHistoryBalance.paid)} />
          <Metric label="Total restant" value={formatMoney(selectedHistoryBalance.remaining)} />
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
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en dollar américain." />
        <div className="mb-3 flex min-w-0 flex-wrap gap-2">
          <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value as typeof amountComparator)} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">Montant payé</option>
            <option value=">=">Payé &gt;=</option>
            <option value="<">Payé &lt;</option>
          </select>
          <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="w-32 max-w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Montant" />
          <button onClick={printFilteredStudents} className="secondary-button">
            <Download className="h-4 w-4" /> Imprimer
          </button>
          {canPay && user.role === "cashier" && (
            <>
              <button onClick={() => setCashierControlDrawer("payment")} className="secondary-button" type="button">
                Enregistrer un paiement
              </button>
              <button onClick={() => setCashierControlDrawer("expense")} className="secondary-button" type="button">
                Enregistrer une dépense
              </button>
            </>
          )}
          <button onClick={() => (user.role === "cashier" ? setCashierControlDrawer("history") : setHistoryOpen(true))} className="secondary-button" type="button">
            Historique des paiements
          </button>
        </div>
        <div className="grid min-w-0 gap-3">
          {rows.map(({ student, balance }) => (
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
                  <p className="break-words text-sm text-slate-500">{student.matricule} | {student.className}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${isStudentPaymentComplete(balance) ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                  {isStudentPaymentComplete(balance) ? "En ordre" : "Non en ordre"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                <Metric label="Prévu" value={`$${balance.expected}`} />
                <Metric label="Payé" value={`$${balance.paid}`} />
                <Metric label="Solde" value={`$${balance.remaining}`} />
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
            <div className="grid grid-cols-3 gap-2 text-sm">
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
            <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button disabled:opacity-50"><Plus className="h-4 w-4" /> Enregistrer</button>
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
            <button onClick={saveExpense} className="primary-button"><Plus className="h-4 w-4" /> Enregistrer</button>
          </FormPanel>
        )}
      </div>
      )}
      {user.role === "cashier" && cashierControlDrawer && (
        <AdminDrawer title={cashierDrawerTitle} onClose={() => setCashierControlDrawer(null)} closeLabel={`Fermer ${cashierDrawerTitle}`}>
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
                        <p className="text-xs text-slate-500">{student.matricule} | {student.className}</p>
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
              <div className="grid grid-cols-3 gap-2 text-sm">
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
              <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button disabled:opacity-50" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
            </>
          )}
          {cashierControlDrawer === "expense" && (
            <>
              <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} className="input">
                <option>Fournitures</option>
                <option>Transport</option>
                <option>Salaire</option>
                <option>Maintenance</option>
                <option>Autres</option>
              </select>
              <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
              <textarea value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} className="input min-h-24" placeholder="Description" />
              <button onClick={saveExpense} className="primary-button" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
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
                {filteredHistoryPayments.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
                {filteredHistoryPayments.map(({ payment, student, fee }) => {
                  return (
                    <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                        <div className="flex shrink-0 gap-1">
                          <button onClick={() => generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF" type="button">
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
            </>
          )}
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
              {filteredHistoryPayments.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
              {filteredHistoryPayments.map(({ payment, student, fee }) => {
                return (
                  <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF">
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
  const payments = yearData.payments.filter((payment) => payment.paidAt >= startDate && payment.paidAt <= endDate);
  const expenses = yearData.expenses.filter((expense) => expense.spentAt >= startDate && expense.spentAt <= endDate);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expected = yearData.students.length * yearData.feeTypes.reduce((sum, fee) => sum + fee.amount, 0);
  const recovery = expected > 0 ? Math.round((paid / expected) * 100) : 0;

  return (
    <section className="grid min-w-0 gap-4">
      <SectionTitle title="Rapports" subtitle="Rapports journaliers et globaux limités à l'année scolaire sélectionnée." />
      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Date début" value={startDate} onChange={setStartDate} type="date" />
          <Field label="Date fin" value={endDate} onChange={setEndDate} type="date" />
          <button onClick={() => exportReportPdf(school, year, startDate, endDate, paid, spent, recovery, payments, expenses)} className="primary-button self-end">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
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
              const student = yearData.students.find((item) => item.id === payment.studentId);
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
  const [recipientParentId, setRecipientParentId] = useState<string>("all");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const canSend = user.role !== "parent";
  const recipientCandidates = yearData.parents.reduce<{ parent: ParentProfile; student?: Student }[]>((items, parent) => {
      const children = yearData.students.filter((student) => student.parentId === parent.id);
      if (children.length === 0) return [...items, { parent }];
      return [...items, ...children.map((student) => ({ parent, student }))];
    }, []);
  const recipientResults = recipientCandidates.filter(({ parent, student }) => {
      const search = recipientSearch.trim().toLowerCase();
      if (!search) return false;
      const studentText = student ? `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}` : "";
      return `${parent.fullName} ${studentText}`.toLowerCase().includes(search);
    });
  const hasRecipientSearch = recipientSearch.trim().length > 0;
  const selectedParent = yearData.parents.find((parent) => parent.id === recipientParentId);

  function sendMessage() {
    const threadParentId = recipientParentId !== "all" ? recipientParentId : undefined;
    const createdAt = new Date().toISOString();
    const message: Message = {
      id: uid("msg"),
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId,
      threadParentId,
      subject,
      body,
      createdAt,
    };
    const recipientParents = recipientParentId === "all" ? yearData.parents : yearData.parents.filter((parent) => parent.id === recipientParentId);
    const notifications: AppNotification[] = recipientParents.map((parent) => ({
      id: uid("notif"),
      schoolId: school.id,
      schoolYearId: year.id,
      recipientRole: "parent",
      parentId: parent.id,
      messageId: message.id,
      type: "message",
      title: "Nouveau message de l'école",
      body: `${school.name}: ${subject}`,
      createdAt,
      read: false,
    }));
    updateData({ messages: [message, ...data.messages], notifications: [...notifications, ...data.notifications] });
    setSubject("");
    setBody("");
  }

  function clearSelectedRecipient() {
    setRecipientParentId("all");
    setRecipientSearch("");
  }

  return (
    <section className="grid min-w-0 gap-4">
      {canSend && (
        <FormPanel title="Envoyer un message">
          <div className="grid min-w-0 gap-2">
            <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={recipientSearch}
                onChange={(event) => setRecipientSearch(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Rechercher parent, enfant ou matricule"
              />
            </label>
            <div className="max-h-60 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              <button
                onClick={() => setRecipientParentId("all")}
                type="button"
                className={`w-full rounded border p-3 text-left text-sm transition ${recipientParentId === "all" ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
              >
                <p className="font-semibold text-ink">Tous les parents</p>
                <p className="text-xs text-slate-500">Envoyer à tous les parents</p>
              </button>
              {hasRecipientSearch && recipientResults.map(({ parent, student }) => (
                <button
                  key={`${parent.id}-${student?.id ?? "none"}`}
                  onClick={() => setRecipientParentId(parent.id)}
                  type="button"
                  className={`w-full rounded border p-3 text-left text-sm transition ${recipientParentId === parent.id ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"}`}
                >
                  <p className="font-semibold text-ink">{parent.fullName}</p>
                  <p className="text-xs text-slate-500">
                    {student ? `${student.nom} ${student.prenom} | ${student.matricule}` : "Aucun enfant associé"}
                  </p>
                </button>
              ))}
              {hasRecipientSearch && recipientResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun parent trouvé.</p>}
            </div>
            {recipientParentId !== "all" && selectedParent && (
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
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-32" placeholder="Message" />
          <button onClick={sendMessage} disabled={!subject || !body} className="primary-button disabled:opacity-50">
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
}) {
  type MenuSection = "school" | "years" | "accounts" | "fees" | "financial" | "history";
  const [schoolForm, setSchoolForm] = useState(school);
  const [cashierName, setCashierName] = useState("");
  const [cashierPhone, setCashierPhone] = useState("");
  const [cashierEmail, setCashierEmail] = useState("");
  const [cashierPassword, setCashierPassword] = useState("");
  const [cashierError, setCashierError] = useState("");
  const [cashierSuccess, setCashierSuccess] = useState("");
  const [showCashierPassword, setShowCashierPassword] = useState(false);
  const [feeName, setFeeName] = useState<FeeKind>("Minerval");
  const [feeClassName, setFeeClassName] = useState<SchoolClass>(CLASSES[0]);
  const [feeAmount, setFeeAmount] = useState("100");
  const [editingFeeId, setEditingFeeId] = useState("");
  const [showNewFeeForm, setShowNewFeeForm] = useState(false);
  const [newFeeName, setNewFeeName] = useState("");
  const [activeMenuSection, setActiveMenuSection] = useState<MenuSection | null>(null);
  const canAdmin = user.role === "school_admin";
  const menuSections = [
    { id: "school", title: "Paramètres école", description: "Logo, coordonnées et informations de l'établissement.", icon: Settings },
    { id: "years", title: "Années scolaires", description: "Année active, années archivées et contexte global.", icon: BookOpen },
    { id: "accounts", title: "Créer un caissier", description: "Compte de connexion caissier lié à l'école.", icon: ShieldCheck },
    { id: "fees", title: "Types de frais", description: "Montants et catégories de frais scolaires.", icon: Banknote },
    { id: "financial", title: "Rapport financier", description: "Synthèse et exports des rapports financiers.", icon: BarChart3 },
    { id: "history", title: "Historique", description: "Activités et messages enregistrés pour ce compte.", icon: Clock3 },
  ] satisfies { id: MenuSection; title: string; description: string; icon: typeof Settings }[];
  const feeKindChoices = Array.from(new Set([...FEE_KINDS, ...yearData.feeTypes.map((fee) => fee.name)]));

  function saveSchool() {
    updateData({ schools: data.schools.map((item) => (item.id === school.id ? schoolForm : item)) });
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

  async function saveCashier() {
    setCashierError("");
    setCashierSuccess("");
    if (!cashierName || !cashierEmail || !cashierPassword) return;

    const existingUser = data.users.find((item) => item.email.toLowerCase() === cashierEmail.toLowerCase());
    if (existingUser) {
      setCashierError("Un compte existe deja avec cet email.");
      return;
    }
    let cashierId: string | undefined;
    if (!cashierId) {
      try {
        const provisioned = await provisionCashier({
          schoolId: school.id,
          schoolYearId: selectedYear.id,
          name: cashierName,
          email: cashierEmail,
          password: cashierPassword,
          phone: cashierPhone,
        });
        cashierId = provisioned.id;
      } catch (error) {
        setCashierError(error instanceof Error ? `Création Firebase Auth caissier impossible : ${error.message}` : "Création Firebase Auth caissier impossible.");
        return;
      }
    }
    const cashierUser: AppUser & { active: boolean } = {
      id: cashierId,
      name: cashierName,
      email: cashierEmail,
      role: "cashier",
      schoolId: school.id,
      activeSchoolYearId: selectedYear.id,
      phone: cashierPhone,
      status: "active",
      active: true,
      createdAt: new Date().toISOString(),
    };
    updateData({ users: [...data.users, cashierUser] }, { persist: false });
    setCashierName("");
    setCashierPhone("");
    setCashierEmail("");
    setCashierPassword("");
    setCashierSuccess("Compte caissier créé avec succès. Il peut maintenant se connecter avec son email et son mot de passe.");
  }

  function saveFee() {
    if (!feeName || !feeClassName || !feeAmount) return;
    const fee: FeeType = {
      id: editingFeeId || uid("fee"),
      schoolId: school.id,
      schoolYearId: selectedYear.id,
      name: feeName,
      className: feeClassName,
      amount: Number(feeAmount),
    };
    updateData({
      feeTypes: editingFeeId ? data.feeTypes.map((item) => (item.id === editingFeeId ? fee : item)) : [...data.feeTypes, fee],
    });
    setEditingFeeId("");
    setFeeName("Minerval");
    setFeeClassName(CLASSES[0]);
    setFeeAmount("100");
  }

  function editFee(fee: FeeType) {
    setEditingFeeId(fee.id);
    setFeeName(fee.name);
    setFeeClassName(fee.className ?? CLASSES[0]);
    setFeeAmount(String(fee.amount));
  }

  function deleteFee(fee: FeeType) {
    if (!confirm(`Supprimer le frais ${fee.name} ?`)) return;
    updateData({ feeTypes: data.feeTypes.filter((item) => item.id !== fee.id) });
  }

  function addFeeKind() {
    const trimmed = newFeeName.trim();
    if (!trimmed) return;
    setFeeName(trimmed);
    setNewFeeName("");
    setShowNewFeeForm(false);
  }

  function renderMenuSectionForm(sectionId: MenuSection) {
    if (sectionId === "school") {
      return (
        <div className="grid min-w-0 gap-4">
          <ImageUploadField label="Logo de l'école" value={schoolForm.logoUrl ?? ""} onChange={(value) => setSchoolForm({ ...schoolForm, logoUrl: value })} maxWidth={600} maxBytes={200 * 1024} disabled={!canAdmin} />
          <Field label="Nom de l'école" value={schoolForm.name} onChange={(value) => setSchoolForm({ ...schoolForm, name: value })} disabled={!canAdmin} />
          <Field label="Adresse" value={schoolForm.address} onChange={(value) => setSchoolForm({ ...schoolForm, address: value })} disabled={!canAdmin} />
          <Field label="Téléphone" value={schoolForm.phone} onChange={(value) => setSchoolForm({ ...schoolForm, phone: value })} disabled={!canAdmin} />
          <Field label="Email" value={schoolForm.email} onChange={(value) => setSchoolForm({ ...schoolForm, email: value })} disabled={!canAdmin} />
          <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">Année scolaire : {selectedYear.name}</p>
          {canAdmin && <button onClick={saveSchool} className="primary-button"><Settings className="h-4 w-4" /> Enregistrer</button>}
        </div>
      );
    }

    if (sectionId === "years") {
      return (
        <div className="grid min-w-0 gap-4">
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
                    <button onClick={() => activateYear(year.id)} className="rounded bg-mint px-3 py-2 text-xs font-semibold text-white" type="button">Activer</button>
                    <button onClick={() => archiveYear(year.id)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700" type="button">Archiver</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (sectionId === "accounts" && canAdmin) {
      return (
        <div className="grid min-w-0 gap-4">
          {cashierError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{cashierError}</p>}
          {cashierSuccess && <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{cashierSuccess}</p>}
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
          <button onClick={saveCashier} disabled={!cashierName || !cashierEmail || !cashierPassword} className="primary-button disabled:opacity-50" type="button">
            <UserRound className="h-4 w-4" /> Créer le caissier
          </button>
        </div>
      );
    }

    if (sectionId === "fees" && canAdmin) {
      return (
        <div className="grid min-w-0 gap-4">
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px_auto]">
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
            <select value={feeClassName} onChange={(event) => setFeeClassName(event.target.value as SchoolClass)} className="input">
              {CLASSES.map((className) => (
                <option key={className} value={className}>{className}</option>
              ))}
            </select>
            <input value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} type="number" className="input" />
            <button onClick={saveFee} className="primary-button" type="button"><Plus className="h-4 w-4" /> {editingFeeId ? "Enregistrer" : "Ajouter"}</button>
          </div>
          {editingFeeId && (
            <button
              onClick={() => {
                setEditingFeeId("");
                setFeeName("Minerval");
                setFeeClassName(CLASSES[0]);
                setFeeAmount("100");
              }}
              className="secondary-button w-fit"
              type="button"
            >
              Annuler la modification
            </button>
          )}
          {showNewFeeForm && (
            <div className="rounded border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">Nouveau frais</p>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input value={newFeeName} onChange={(event) => setNewFeeName(event.target.value)} className="input" placeholder="Nom du frais" />
                <button onClick={addFeeKind} type="button" className="secondary-button justify-center">
                  <Plus className="h-4 w-4" /> Ajouter le frais
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {yearData.feeTypes.map((fee) => (
              <div key={fee.id} className="flex min-w-0 flex-col gap-3 rounded bg-slate-50 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-words font-semibold text-ink">{fee.name} - {fee.className ?? "Toutes les classes"}</span>
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

  const visibleMenuSections = menuSections.filter((section) => (canAdmin ? true : user.role === "cashier" && section.id === "history"));
  const activeMenuSectionConfig = visibleMenuSections.find((section) => section.id === activeMenuSection);

  return (
    <section className="grid min-w-0 gap-3">
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
      <div className="mt-2 border-t border-slate-200 pt-4">
        <button onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100" type="button">
          <LogOut className="h-4 w-4" /> Déconnexion
        </button>
      </div>
    </section>
  );
}

function StudentForm({
  form,
  setForm,
  parents,
  quickParent,
  setQuickParent,
  classChoices,
  optionChoices,
  onAddOption,
  onCreateParent,
  onSave,
  onReset,
}: {
  form: Student;
  setForm: (student: Student) => void;
  parents: ParentProfile[];
  quickParent: { fullName: string; phone: string; email: string; password: string };
  setQuickParent: (parent: { fullName: string; phone: string; email: string; password: string }) => void;
  classChoices: SchoolClass[];
  optionChoices: string[];
  onAddOption: (option: string) => void;
  onCreateParent: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const [showOptionForm, setShowOptionForm] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [showQuickParentPassword, setShowQuickParentPassword] = useState(false);

  function submitOption() {
    const trimmed = newOption.trim();
    if (!trimmed) return;
    onAddOption(trimmed);
    setNewOption("");
    setShowOptionForm(false);
  }

  return (
    <>
      <Field label="Matricule" value={form.matricule || "Généré automatiquement"} onChange={() => undefined} disabled />
      <Field label="Nom" value={form.nom} onChange={(value) => setForm({ ...form, nom: value })} />
      <Field label="Postnom" value={form.postnom} onChange={(value) => setForm({ ...form, postnom: value })} />
      <Field label="Prénom" value={form.prenom} onChange={(value) => setForm({ ...form, prenom: value })} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Sexe
        <select value={form.sexe} onChange={(event) => setForm({ ...form, sexe: event.target.value as "M" | "F" })} className="input">
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
      </label>
      <Field label="Date de naissance" value={form.birthDate} onChange={(value) => setForm({ ...form, birthDate: value })} type="date" />
      <Field label="Adresse" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
      <Field label="Téléphone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Parent
        <select value={form.parentId ?? ""} onChange={(event) => setForm({ ...form, parentId: event.target.value || undefined })} className="input">
          <option value="">Aucun parent</option>
          {parents.map((parent) => (
            <option key={parent.id} value={parent.id}>{parent.fullName} - {parent.phone}</option>
          ))}
        </select>
      </label>
      <div className="rounded border border-slate-100 bg-slate-50 p-3">
        <p className="mb-2 text-sm font-semibold text-ink">Créer un parent sans quitter la fiche</p>
        <div className="grid gap-2">
          <input value={quickParent.fullName} onChange={(event) => setQuickParent({ ...quickParent, fullName: event.target.value })} className="input" placeholder="Nom complet" />
          <input value={quickParent.phone} onChange={(event) => setQuickParent({ ...quickParent, phone: event.target.value })} className="input" placeholder="Téléphone" />
          <input value={quickParent.email} onChange={(event) => setQuickParent({ ...quickParent, email: event.target.value })} className="input" placeholder="Email" />
          <PasswordField
            label="Mot de passe temporaire"
            value={quickParent.password}
            onChange={(value) => setQuickParent({ ...quickParent, password: value })}
            visible={showQuickParentPassword}
            onToggle={() => setShowQuickParentPassword(!showQuickParentPassword)}
            placeholder="Mot de passe temporaire"
          />
          <button onClick={onCreateParent} className="secondary-button" type="button"><Plus className="h-4 w-4" /> Créer et sélectionner</button>
        </div>
      </div>
      <label className="grid gap-1 text-sm font-medium text-slate-700">
        Classe
        <select value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value as SchoolClass })} className="input">
          {classChoices.map((className) => (
            <option key={className} value={className}>{className}</option>
          ))}
        </select>
      </label>
      {getClassSection(form.className) === "secondaire" && (
        <div className="grid gap-2">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Option
            <select
              value={optionChoices.includes(form.option ?? "") ? form.option : ""}
              onChange={(event) => {
                if (event.target.value === "__add_option__") {
                  setShowOptionForm(true);
                  return;
                }
                setForm({ ...form, option: event.target.value || undefined });
              }}
              className="input"
            >
              <option value="">Aucune option</option>
              {optionChoices.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
              <option value="__add_option__">Ajouter une option</option>
            </select>
          </label>
          {showOptionForm && (
            <div className="rounded border border-slate-100 bg-slate-50 p-3">
              <p className="mb-2 text-sm font-semibold text-ink">Nouvelle option</p>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input value={newOption} onChange={(event) => setNewOption(event.target.value)} className="input" placeholder="Nom de l'option" />
                <button onClick={submitOption} type="button" className="secondary-button justify-center">
                  <Plus className="h-4 w-4" /> Ajouter
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      <ImageUploadField label="Photo de l'élève" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} maxWidth={800} maxBytes={300 * 1024} />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onReset} className="secondary-button">Réinitialiser</button>
        <button onClick={onSave} className="primary-button"><CheckCircle2 className="h-4 w-4" /> Sauver</button>
      </div>
    </>
  );
}

function getClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

function generateMatricule(students: Student[], yearName: string, schoolId: string, schoolYearId: string) {
  const year = yearName.slice(2, 4);
  const count = students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId).length + 1;
  return `ACD-${year}-${String(count).padStart(4, "0")}`;
}

function isArchivedStudent(student: Student) {
  return Boolean(student.deletedAt) || (student.status ?? "ACTIVE") !== "ACTIVE";
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
    { header: "Classe", render: (student) => student.className || "-" },
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

async function exportReportPdf(
  school: School,
  year: SchoolYear,
  startDate: string,
  endDate: string,
  paid: number,
  spent: number,
  recovery: number,
  payments: Payment[],
  expenses: Expense[],
) {
  await renderAcadPdfPreview({
    filename: `rapport-${startDate}-${endDate}.pdf`,
    title: "Rapport Acadéa",
    school,
    year,
    subtitle: `Période : ${startDate} au ${endDate}`,
    sections: [
      pdfSection(
        "Synthèse",
        pdfInfoGrid([
          { label: "Paiements", value: money(paid) },
          { label: "Dépenses", value: money(spent) },
          { label: "Solde", value: money(paid - spent) },
          { label: "Recouvrement", value: `${recovery}%` },
        ]),
      ),
      pdfSection(
        "Paiements",
        pdfTable(
          [
            { header: "Date", render: (payment) => payment.paidAt },
            { header: "Caissier", render: (payment) => payment.cashierName },
            { header: "Montant", render: (payment) => money(payment.amount), align: "right" },
            { header: "Reçu", render: (payment) => payment.receiptNumber ?? payment.id },
          ],
          payments.slice(0, 24),
          "Aucun paiement pour cette période.",
        ),
      ),
      pdfSection(
        "Dépenses",
        pdfTable(
          [
            { header: "Date", render: (expense) => expense.spentAt },
            { header: "Catégorie", render: (expense) => expense.category },
            { header: "Montant", render: (expense) => money(expense.amount), align: "right" },
            { header: "Description", render: (expense) => expense.description },
          ],
          expenses.slice(0, 24),
          "Aucune dépense pour cette période.",
        ),
      ),
    ],
  });
}

function emptyStudent(schoolId: string, schoolYearId: string): Student {
  return {
    id: `new-${crypto.randomUUID()}`,
    schoolId,
    schoolYearId,
    annee_scolaire_id: schoolYearId,
    matricule: "",
    nom: "",
    postnom: "",
    prenom: "",
    sexe: "M",
    birthDate: "",
    address: "",
    phone: "",
    className: "1ère Primaire",
    section: "primaire",
    status: "ACTIVE",
    photoUrl: "",
  };
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

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 min-w-0">
      <h1 className="break-words text-2xl font-bold text-ink">{title}</h1>
      <p className="break-words text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function AdminDrawer({
  title,
  children,
  onClose,
  closeLabel,
  notificationPanel = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  notificationPanel?: boolean;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const notificationPanelStyle = notificationPanel
    ? {
        height: "calc(100vh - 72px - 5.75rem - env(safe-area-inset-bottom) - 1.5rem)",
        marginTop: "72px",
        marginBottom: "calc(5.75rem + env(safe-area-inset-bottom))",
      }
    : undefined;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusableElements = drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusableElements || focusableElements.length === 0) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${notificationPanel ? "z-[80]" : "z-50"} bg-ink/30 p-3 backdrop-blur-sm`} onMouseDown={onClose} role="presentation">
      <div
        ref={drawerRef}
        className={`ml-auto flex min-h-0 w-full max-w-xl flex-col rounded border border-slate-200 bg-white p-4 shadow-2xl ${notificationPanel ? "" : "h-full"}`}
        style={notificationPanelStyle}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <h2 id="drawer-title" className="break-words text-lg font-bold text-ink">{title}</h2>
          <button ref={closeButtonRef} onClick={onClose} className="rounded bg-slate-100 p-2 text-slate-700" aria-label={closeLabel} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1 scrollbar-thin">{children}</div>
      </div>
    </div>
  );
}

function FormPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="min-w-0 max-w-full rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 break-words text-lg font-bold text-ink">{title}</h2>
      <div className="grid min-w-0 gap-3">{children}</div>
    </aside>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} type={type} disabled={disabled} className="input disabled:bg-slate-100" />
    </label>
  );
}

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const acceptedImageExtensions = "JPG, JPEG, PNG, WEBP";

async function compressImageFile(file: File, maxWidth: number, maxBytes: number) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error(`Format non pris en charge. Utilisez ${acceptedImageExtensions}.`);
  }

  const image = await loadImage(file);
  const ratio = image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Compression impossible : navigateur non compatible.");
  context.drawImage(image, 0, 0, width, height);

  const outputType = "image/webp";
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
  let bestBlob: Blob | null = null;

  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
    if (blob.size <= maxBytes) return blobToDataUrl(blob);
  }

  if (bestBlob && bestBlob.size <= maxBytes) return blobToDataUrl(bestBlob);
  throw new Error(`Image trop lourde après compression. Choisissez une image plus légère (${Math.round(maxBytes / 1024)} Ko maximum recommandé).`);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire cette image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Compression impossible."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture de l'image compressée impossible."));
    reader.readAsDataURL(blob);
  });
}

function ImageUploadField({
  label,
  value,
  onChange,
  maxWidth,
  maxBytes,
  disabled = false,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  maxWidth: number;
  maxBytes: number;
  disabled?: boolean;
}) {
  const inputId = useId();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      const dataUrl = await compressImageFile(file, maxWidth, maxBytes);
      onChange(dataUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image impossible à traiter.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3">
        {value ? (
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
              <img src={value} alt="" className="h-full w-full object-cover" />
            </div>
            <p className="min-w-0 break-words text-xs font-medium text-slate-500">Image sélectionnée. Les anciennes URL restent compatibles.</p>
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 bg-white p-4 text-center text-xs font-medium text-slate-500">
            Aucune image sélectionnée
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={disabled || processing} className="sr-only" />
          <label htmlFor={inputId} className={`secondary-button cursor-pointer ${disabled || processing ? "pointer-events-none opacity-60" : ""}`}>
            {processing ? "Compression..." : value ? "Remplacer l'image" : "Choisir une image"}
          </label>
          {value && !disabled && (
            <button onClick={() => onChange("")} className="rounded border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50" type="button">
              Supprimer
            </button>
          )}
        </div>
        <p className="text-xs font-medium text-slate-500">{acceptedImageExtensions} uniquement. Largeur max {maxWidth}px, objectif {Math.round(maxBytes / 1024)} Ko.</p>
        {error && <p className="rounded bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  visible,
  onToggle,
  placeholder,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible?: boolean;
  onToggle?: () => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isVisible = visible ?? internalVisible;
  const toggleVisibility = onToggle ?? (() => setInternalVisible((current) => !current));

  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
      {label}
      <span className="relative min-w-0">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          type={isVisible ? "text" : "password"}
          disabled={disabled}
          className="input pr-10 disabled:bg-slate-100"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={toggleVisibility}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          aria-label={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          title={isVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
        >
          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
    </label>
  );
}

function IconButton({ label, onClick, icon: Icon, danger = false }: { label: string; onClick: () => void; icon: typeof Edit3; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={`rounded p-2 ${danger ? "bg-red-50 text-red-600" : "bg-slate-100 text-slate-700"}`}>
      <Icon className="h-4 w-4" />
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded bg-slate-50 p-2">
      <p className="break-words text-xs text-slate-500">{label}</p>
      <p className="break-words font-bold text-ink">{value}</p>
    </div>
  );
}
