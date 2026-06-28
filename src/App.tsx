import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
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
  Upload,
  X,
  UserRound,
  UsersRound,
} from "lucide-react";
import { demoData } from "./data/demoData";
import { firebaseReady } from "./firebase";
import { createFirebaseAuthUser, getDefaultRoute, signIn, signOutUser, validateParent, validatePlatformAdmin, validateSchoolStaff } from "./services/auth";
import { canUseFirestoreData, loadFirestoreData, persistFirestorePatch } from "./services/firestoreData";
import { generateReceiptPdf } from "./utils/pdf";
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

const roleLabels: Record<AppUser["role"], string> = {
  super_admin: "Super Administrateur",
  school_admin: "Administrateur d'école",
  cashier: "Caissier",
  parent: "Parent",
};

const appEnvironment = import.meta.env.VITE_APP_ENV ?? "development";
const showStagingBanner = import.meta.env.VITE_STAGING_BANNER === "true" || appEnvironment === "staging" || appEnvironment === "preview";
const stagingLabel = import.meta.env.VITE_STAGING_LABEL ?? "ENVIRONNEMENT DE TEST";
const localDataKey = "acadea-app-data";
const sessionKey = "acadea-session";

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function loadInitialData() {
  if (typeof window === "undefined") return demoData;

  try {
    const saved = window.localStorage.getItem(localDataKey);
    return saved ? ({ ...demoData, ...JSON.parse(saved) } as AppData) : demoData;
  } catch {
    return demoData;
  }
}

function loadStoredSession(data: AppData) {
  if (typeof window === "undefined") return null;

  try {
    const saved = JSON.parse(window.localStorage.getItem(sessionKey) ?? "null") as { userId?: string; selectedYearId?: string; activeTab?: Tab } | null;
    const sessionUser = saved?.userId ? data.users.find((item) => item.id === saved.userId && item.status !== "inactive") : undefined;
    return sessionUser ? { user: sessionUser, selectedYearId: saved?.selectedYearId ?? "", activeTab: saved?.activeTab ?? "dashboard" } : null;
  } catch {
    return null;
  }
}

function getInitialRoute(hasSession: boolean) {
  if (typeof window === "undefined") return "/login";
  const path = window.location.pathname;
  if (!hasSession) return path === "/platform" ? "/platform" : "/login";
  if (path === "/platform" || path === "/dashboard" || path.startsWith("/admin/")) return path;
  return "/dashboard";
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
  const storedSession = loadStoredSession(data);
  const [user, setUser] = useState<AppUser | null>(() => storedSession?.user ?? null);
  const [selectedYearId, setSelectedYearId] = useState(() => storedSession?.selectedYearId ?? "");
  const [activeTab, setActiveTab] = useState<Tab>(() => storedSession?.activeTab ?? "dashboard");
  const [route, setRoute] = useState(() => getInitialRoute(Boolean(storedSession?.user)));
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const school = data.schools.find((item) => item.id === user?.schoolId);
  const schoolYears = school ? data.schoolYears.filter((year) => year.schoolId === school.id) : [];
  const selectedYear = schoolYears.find((year) => year.id === selectedYearId);

  useEffect(() => {
    if (!user || !canUseFirestoreData()) return;

    let cancelled = false;

    loadFirestoreData()
      .then((firestoreData) => {
        if (!firestoreData || cancelled) return;
        const mergedData = { ...demoData, ...firestoreData };
        window.localStorage.setItem(localDataKey, JSON.stringify(mergedData));
        setData(mergedData);
      })
      .catch((error) => {
        console.warn("Chargement Firestore indisponible, fallback localStorage.", error);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  function saveSession(nextUser: AppUser | null, nextSelectedYearId = selectedYearId, nextActiveTab = activeTab) {
    if (!nextUser) {
      window.localStorage.removeItem(sessionKey);
      return;
    }

    window.localStorage.setItem(sessionKey, JSON.stringify({ userId: nextUser.id, selectedYearId: nextSelectedYearId, activeTab: nextActiveTab }));
  }

  function navigate(nextRoute: string) {
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  }

  function enterSchoolYear(yearId: string) {
    setSelectedYearId(yearId);
    setUser((currentUser) => (currentUser ? { ...currentUser, activeSchoolYearId: yearId } : currentUser));
    if (user) saveSession({ ...user, activeSchoolYearId: yearId }, yearId);
    setData((prev) => {
      const updated = {
        ...prev,
        users: prev.users.map((item) => (item.id === user?.id ? { ...item, activeSchoolYearId: yearId } : item)),
      };
      window.localStorage.setItem(localDataKey, JSON.stringify(updated));
      return updated;
    });
  }

  async function loginWithCredentials(email: string, password: string) {
    const nextUser = await signIn(email, password, data);
    const nextRoute = getDefaultRoute(nextUser.role);
    let nextSessionYearId = "";

    if (nextRoute === "/platform" && !validatePlatformAdmin(nextUser)) {
      throw new Error("Accès plateforme refusé.");
    }

    if (nextRoute === "/dashboard") {
      const schoolStaffAccess = validateSchoolStaff(nextUser);
      const parentAccess = validateParent(nextUser);
      if (["school_admin", "cashier"].includes(nextUser.role) && !nextUser.schoolId) {
        throw new Error("schoolId manquant.");
      }
      if (!schoolStaffAccess && !parentAccess) {
        const authDiagnostic = (nextUser as AppUser & { __authDiagnostic?: Record<string, unknown> }).__authDiagnostic ?? {};
        const rawRole = authDiagnostic.rawRole ?? nextUser.role;
        const schoolStaffReasons = {
          roleAccepted: ["school_admin", "cashier"].includes(nextUser.role),
          hasSchoolId: Boolean(nextUser.schoolId),
        };
        const parentReasons = {
          roleAccepted: nextUser.role === "parent",
          hasSchoolId: Boolean(nextUser.schoolId),
          hasParentId: Boolean(nextUser.parentId),
          statusActive: nextUser.status !== "inactive",
        };
        console.error("[Acadéa auth] Accès dashboard refusé.", {
          firebaseUid: authDiagnostic.firebaseUid ?? nextUser.id,
          email: authDiagnostic.email ?? nextUser.email,
          firestoreDocument: authDiagnostic.firestoreDocument ?? null,
          customClaims: authDiagnostic.customClaims ?? null,
          rawRole,
          normalizedRole: nextUser.role,
          schoolId: nextUser.schoolId,
          tenantId: authDiagnostic.tenantId,
          validateSchoolStaff: schoolStaffAccess,
          validateParent: parentAccess,
          validationReasons: {
            validateSchoolStaff: schoolStaffReasons,
            validateParent: parentReasons,
          },
          exactFailure: {
            validateSchoolStaff: Object.entries(schoolStaffReasons)
              .filter(([, passed]) => !passed)
              .map(([reason]) => reason),
            validateParent: Object.entries(parentReasons)
              .filter(([, passed]) => !passed)
              .map(([reason]) => reason),
          },
        });
        throw new Error("Votre compte ne peut pas accéder à cet espace.");
      }

      const nextSchool = data.schools.find((item) => item.id === nextUser.schoolId);
      if (!nextSchool) {
        throw new Error("Aucune école n'est associée à ce compte.");
      }

      if (nextSchool.status !== "active") {
        throw new Error("Cette école est suspendue. Contactez la plateforme Acadéa.");
      }

      const nextSchoolYears = data.schoolYears.filter((year) => year.schoolId === nextSchool.id);
      const nextActiveYear = nextSchoolYears.find((year) => year.status === "active");
      setSelectedYearId(nextActiveYear?.id ?? "");
      nextSessionYearId = nextActiveYear?.id ?? "";
    }

    setUser(nextUser);
    setActiveTab("dashboard");
    saveSession(nextUser, nextSessionYearId, "dashboard");
    navigate(nextRoute);
  }

  async function logout() {
    await signOutUser();
    saveSession(null);
    setUser(null);
    setSelectedYearId("");
    setActiveTab("dashboard");
    navigate("/login");
  }

  function updateData(next: Partial<AppData>) {
    setData((prev) => {
      const updated = { ...prev, ...next };
      window.localStorage.setItem(localDataKey, JSON.stringify(updated));
      void persistFirestorePatch(next).catch((error) => {
        console.warn("Sauvegarde Firestore indisponible, fallback localStorage.", error);
      });
      return updated;
    });
  }

  async function refreshData() {
    if (canUseFirestoreData()) {
      try {
        const firestoreData = await loadFirestoreData();
        if (firestoreData) {
          const mergedData = { ...demoData, ...firestoreData };
          window.localStorage.setItem(localDataKey, JSON.stringify(mergedData));
          setData(mergedData);
          return;
        }
      } catch (error) {
        console.warn("Actualisation Firestore indisponible, fallback localStorage.", error);
      }
    }

    setData(loadInitialData());
  }

  if (!user || route === "/login") {
    return <LoginScreen onLogin={loginWithCredentials} />;
  }

  if (route === "/platform") {
    if (!validatePlatformAdmin(user)) {
      return <AccessDenied onLogout={logout} />;
    }

    return <PlatformModule user={user} data={data} updateData={updateData} onLogout={logout} />;
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
        onLogout={logout}
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
              saveSession(user, selectedYear.id, "menu");
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
          />
        )}
      </main>
      <BottomNavigation
        user={user}
        activeTab={activeTab}
        onTab={(tab) => {
          setActiveTab(tab);
          saveSession(user, selectedYear.id, tab);
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

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("direction@acadea.demo");
  const [password, setPassword] = useState("ecole123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const normalizedEmail = email.trim().toLowerCase();
  const isSuperAdmin = normalizedEmail === "admin@acadea.demo" || normalizedEmail === "superadmin@acadea.demo";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await onLogin(email, password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Connexion refusée.");
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
            {logoPreview ? <img src={logoPreview} alt="Logo Acadéa" className="h-full w-full object-cover" /> : "A"}
          </div>
          <h1 className="mt-2 break-words text-2xl font-bold tracking-normal text-ink sm:mt-4 sm:text-3xl">Acadéa</h1>
          <p className="mt-1 break-words text-xs font-medium text-slate-500 sm:mt-2 sm:text-sm">Gestion scolaire sécurisée par école</p>
          {isSuperAdmin && (
            <div className="mt-4">
              <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-ink/20 hover:bg-slate-50">
                <Upload className="h-4 w-4" />
                Changer le logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) setLogoPreview(URL.createObjectURL(file));
                  }}
                />
              </label>
            </div>
          )}
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
        </form>

        <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 sm:mt-5">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>

        <div className="mt-3 break-words rounded-2xl border border-slate-200 bg-[#F8FAFC] p-2 text-center text-xs leading-5 text-slate-500 sm:mt-5 sm:p-3">
          Firebase SDK : {firebaseReady ? "configuré" : "mode démonstration local"}
        </div>

        {!firebaseReady && (
          <div className="mt-2 break-words rounded-2xl border border-slate-200 bg-white p-2 text-center text-xs leading-5 text-slate-500 sm:mt-3 sm:p-3">
            Démo: direction@acadea.demo / ecole123 pour l'école, admin@acadea.demo / admin123 pour la plateforme.
          </div>
        )}
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
  onLogout,
}: {
  user: AppUser;
  school: School;
  year: SchoolYear;
  messages: Message[];
  unreadNotifications: number;
  notificationsOpen: boolean;
  onRefresh: () => void;
  onToggleNotifications: () => void;
  onLogout: () => void;
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
            <button onClick={onLogout} className="inline-flex items-center justify-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
              <LogOut className="h-4 w-4" /> Sortir
            </button>
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
  ].filter((tab) => (user.role === "cashier" ? ["dashboard", "control", "messages"].includes(tab.id) : true)) as { id: Tab; label: string; icon: typeof BookOpen }[];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 max-w-full overflow-hidden border-t border-slate-200 bg-white/95 px-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:px-2">
      <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1">
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

function Dashboard({ data, school, year }: { data: ReturnType<typeof scopeData>; school: School; year: SchoolYear }) {
  const today = new Date().toISOString().slice(0, 10);
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
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
  const transactionsByDay = transactions.reduce<{ date: string; income: number; outcome: number }[]>((items, transaction) => {
    const date = transaction.date.slice(0, 10);
    const existing = items.find((item) => item.date === date);
    if (existing) {
      if (transaction.amount >= 0) existing.income += transaction.amount;
      else existing.outcome += Math.abs(transaction.amount);
      return items;
    }
    return [...items, { date, income: transaction.amount >= 0 ? transaction.amount : 0, outcome: transaction.amount < 0 ? Math.abs(transaction.amount) : 0 }];
  }, []).sort((a, b) => a.date.localeCompare(b.date));
  const maxDailyAmount = Math.max(1, ...transactionsByDay.map((item) => Math.max(item.income, item.outcome)));
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
          <div className="h-full rounded bg-mint" style={{ width: Math.min(100, recoveryRate) + "%" }} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Metric label={"Encaiss\u00e9"} value={"$" + totalPayments.toFixed(2)} />
          <Metric label={"D\u00e9penses"} value={"$" + totalExpenses.toFixed(2)} />
          <Metric label="Attendu" value={"$" + stats.expected.toFixed(2)} />
          <Metric label="Reste" value={"$" + remaining.toFixed(2)} />
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
          <h3 className="mb-3 text-sm font-bold text-ink">Mouvement des transactions par jour</h3>
          <div className="grid min-w-0 gap-3">
            {transactionsByDay.map((item) => (
              <div key={item.date} className="grid min-w-0 gap-2 sm:grid-cols-[110px_minmax(0,1fr)] sm:items-center">
                <span className="text-xs font-semibold text-slate-500">{item.date}</span>
                <div className="grid min-w-0 gap-1">
                  <div className="h-2 rounded bg-slate-100">
                    <div className="h-full rounded bg-mint" style={{ width: (item.income / maxDailyAmount) * 100 + "%" }} />
                  </div>
                  <div className="h-2 rounded bg-slate-100">
                    <div className="h-full rounded bg-red-400" style={{ width: (item.outcome / maxDailyAmount) * 100 + "%" }} />
                  </div>
                </div>
              </div>
            ))}
            {transactionsByDay.length === 0 && <p className="text-sm text-slate-500">{"Aucun mouvement \u00e0 afficher."}</p>}
          </div>
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
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  let y = 18;

  doc.setFontSize(16);
  doc.text(`Dashboard Acadea - ${school.name}`, 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Annee scolaire: ${year.name}`, 14, y);
  y += 6;
  doc.text(`Date d'impression: ${new Date().toLocaleDateString("fr-FR")}`, 14, y);
  y += 6;
  doc.text(`Section: ${sectionLabel}`, 14, y);
  y += 6;
  doc.text(`Tranche de date: ${dateLabel}`, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text("KPI financier", 14, y);
  y += 7;
  doc.setFontSize(9);
  doc.text(`Recouvrement: ${recoveryRate}%`, 14, y);
  y += 5;
  doc.text(`Encaisse: $${totalPayments.toFixed(2)} | Depenses: $${totalExpenses.toFixed(2)} | Attendu: $${expected.toFixed(2)} | Reste: $${remaining.toFixed(2)}`, 14, y);
  y += 10;

  doc.setFontSize(12);
  doc.text("Transactions du jour", 14, y);
  y += 7;
  doc.setFontSize(8);
  transactions.slice(0, 18).forEach((transaction) => {
    doc.text(`${transaction.date.slice(0, 10)} - ${transaction.type} - ${transaction.label} - $${transaction.amount.toFixed(2)}`, 14, y);
    y += 5;
  });
  if (transactions.length === 0) {
    doc.text("Aucune transaction pour cette periode.", 14, y);
    y += 5;
  }
  y += 6;

  doc.setFontSize(12);
  doc.text("Eleves par classe", 14, y);
  y += 7;
  doc.setFontSize(8);
  classRows.forEach((row) => {
    doc.text(`${row.className} | Filles: ${row.girls} | Garcons: ${row.boys} | Total: ${row.total}`, 14, y);
    y += 5;
  });
  y += 4;
  doc.setFontSize(9);
  doc.text(`Total filles: ${totalGirls} | Total garcons: ${totalBoys} | Total general: ${totalStudents}`, 14, y);
  doc.save(`dashboard-${year.name}.pdf`);
}

function PlatformModule({
  user,
  data,
  updateData,
  onLogout,
}: {
  user: AppUser;
  data: AppData;
  updateData: (next: Partial<AppData>) => void;
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

  const totalRevenue = data.schools.reduce((sum, school) => sum + school.subscriptionAmount, 0);
  const totalStudents = data.students.length;
  const totalParents = data.parents.length;
  const totalAdmins = data.users.filter((item) => item.role === "school_admin").length;
  const activeSchools = data.schools.filter((school) => school.status === "active").length;
  const suspendedSchools = data.schools.filter((school) => school.status === "suspended").length;
  const selectedSchool = data.schools.find((school) => school.id === selectedSchoolId) ?? data.schools[0];
  const selectedStats = selectedSchool ? getPlatformSchoolStats(selectedSchool.id, data) : { students: 0, parents: 0, admins: 0, users: 0 };
  const selectedAdmins = selectedSchool ? data.users.filter((item) => item.role === "school_admin" && item.schoolId === selectedSchool.id) : [];
  const selectedLogs = selectedSchool
    ? data.auditLogs.filter((log) => log.schoolId === selectedSchool.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const adminFormValid =
    adminName.trim().length >= 2 &&
    modalAdminEmail.includes("@") &&
    (editingAdminId || modalAdminPassword.length >= 6) &&
    (editingAdminId || modalAdminPassword === modalAdminPasswordConfirm);
  const filteredSchools = data.schools
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

    const schoolId = uid("school");
    const yearId = uid("year");
    const fallbackAdminId = uid("u-school-admin");
    const adminId = await createFirebaseAuthUser(adminEmail, adminPassword, fallbackAdminId);
    const amount = subscriptionPlan === "Starter" ? 29 : subscriptionPlan === "Premium" ? 99 : 49;
    const school: School = {
      id: schoolId,
      name: schoolName,
      address: "",
      phone: "",
      email: adminEmail,
      currency: "USD",
      activeSchoolYearId: yearId,
      logoUrl: "",
      acronym: buildAcronym(schoolName),
      educationLevels: ["Primaire"],
      schoolType: "Mixte",
      createdAt: new Date().toISOString(),
      status: "active",
      subscriptionPlan,
      subscriptionStatus: "active",
      subscriptionAmount: amount,
    };
    const year: SchoolYear = {
      id: yearId,
      schoolId,
      name: "2026-2027",
      startsAt: "2026-09-01",
      endsAt: "2027-07-15",
      status: "active",
    };
    const adminUser: AppUser = {
      id: adminId,
      name: `Admin ${schoolName}`,
      email: adminEmail,
      role: "school_admin",
      schoolId,
      activeSchoolYearId: yearId,
      demoPassword: adminPassword,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    updateData({
      schools: [...data.schools, school],
      schoolYears: [...data.schoolYears, year],
      users: [...data.users, adminUser],
      auditLogs: [writeAudit(schoolId, `Création de l'école ${schoolName}`), ...data.auditLogs],
    });
    setSchoolName("");
    setAdminEmail("");
    setAdminPassword("");
    setSelectedSchoolId(schoolId);
    setPlatformView("schools");
    setDetailTab("overview");
  }

  function updateSchool(schoolId: string, next: Partial<School>) {
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
      const fallbackAdminId = uid("u-school-admin");
      const adminId = await createFirebaseAuthUser(modalAdminEmail, modalAdminPassword, fallbackAdminId);
      const adminUser: AppUser = {
        id: adminId,
        name: adminName,
        email: modalAdminEmail,
        role: "school_admin",
        schoolId: selectedSchool.id,
        activeSchoolYearId: selectedSchool.activeSchoolYearId,
        demoPassword: modalAdminPassword,
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

  function resetAdminPassword(admin: AppUser) {
    if (!confirm(`Générer un nouveau mot de passe temporaire pour ${admin.name} ?`)) return;
    const nextPassword = `Acadea-${Math.random().toString(36).slice(2, 8)}`;
    updateData({
      users: data.users.map((item) => (item.id === admin.id ? { ...item, demoPassword: nextPassword } : item)),
      auditLogs: [writeAudit(admin.schoolId, `Réinitialisation du mot de passe de ${admin.name}`), ...data.auditLogs],
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
                <Field label="Mot de passe admin" value={adminPassword} onChange={setAdminPassword} type="password" />
                <label className="grid gap-1 text-sm font-medium text-slate-700">
                  Abonnement
                  <select value={subscriptionPlan} onChange={(event) => setSubscriptionPlan(event.target.value as School["subscriptionPlan"])} className="input">
                    <option value="Starter">Starter</option>
                    <option value="Standard">Standard</option>
                    <option value="Premium">Premium</option>
                  </select>
                </label>
                <button onClick={createSchool} className="primary-button">
                  <Plus className="h-4 w-4" /> Créer
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
                    {data.schools.slice(0, 3).map((school) => (
                      <SchoolSaasCard key={school.id} school={school} stats={getPlatformSchoolStats(school.id, data)} onSelect={() => selectSchool(school.id)} />
                    ))}
                  </div>
                </div>
              </section>
            </section>
          )}

          {platformView === "schools" && (
            <section className="grid gap-4">
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
                      onSubscription={() => selectSchool(school.id, "subscription")}
                      onAdmins={() => selectSchool(school.id, "admins")}
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
                          <InfoRow label="Niveaux" value={(selectedSchool.educationLevels ?? []).join(", ") || "-"} />
                          <InfoRow label="Type" value={selectedSchool.schoolType ?? "-"} />
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
                                <button onClick={() => resetAdminPassword(admin)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                                  Reset password
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
                              onClick={() => updateSchool(selectedSchool.id, { status: "suspended", subscriptionStatus: "suspended" })}
                              className="rounded bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                            >
                              Suspendre
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
                  <label className="grid gap-1 text-sm font-medium text-slate-700">
                    Mot de passe
                    <span className="relative">
                      <input
                        value={modalAdminPassword}
                        onChange={(event) => setModalAdminPassword(event.target.value)}
                        type={showModalPassword ? "text" : "password"}
                        className="input pr-10"
                      />
                      <button type="button" onClick={() => setShowModalPassword(!showModalPassword)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500">
                        {showModalPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </label>
                  <Field label="Confirmation" value={modalAdminPasswordConfirm} onChange={setModalAdminPasswordConfirm} type={showModalPassword ? "text" : "password"} />
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
  onSubscription,
  onAdmins,
}: {
  school: School;
  stats: ReturnType<typeof getPlatformSchoolStats>;
  selected?: boolean;
  onSelect: () => void;
  onSubscription?: () => void;
  onAdmins?: () => void;
}) {
  return (
    <article className={`rounded border bg-white p-4 shadow-sm ${selected ? "border-ink ring-2 ring-ink/10" : "border-slate-200"}`}>
      <div className="flex items-start gap-3">
        <SchoolLogo school={school} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-bold text-ink">{school.name}</h3>
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
        <button onClick={onSelect} className="rounded bg-ink px-3 py-2 text-xs font-semibold text-white">
          Voir détails
        </button>
        <button onClick={onSubscription ?? onSelect} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Abonnement
        </button>
        <button onClick={onAdmins ?? onSelect} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Admins
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
  updateData: (next: Partial<AppData>) => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const parent = yearData.parents.find((item) => item.id === user.parentId);
  const unread = yearData.notifications.filter((notification) => !notification.read).length;

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
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8fb]">
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
          <button onClick={onLogout} className="secondary-button">
            <LogOut className="h-4 w-4" /> Sortir
          </button>
          <button onClick={onRefresh} className="secondary-button" title="Actualiser">
            <RefreshCw className="h-4 w-4" /> Actualiser
          </button>
          <button onClick={markNotificationsRead} className="relative secondary-button" title="Notifications">
            <Bell className="h-4 w-4" />
            {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">{unread}</span>}
          </button>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl min-w-0 gap-4 px-3 py-5 sm:px-6 lg:px-8">
        <section className="min-w-0 rounded border border-slate-200 bg-white p-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-ink">Mes enfants</h1>
              <p className="break-words text-sm text-slate-500">Consultation limitée aux élèves rattachés à ce parent.</p>
            </div>
            <button onClick={markNotificationsRead} className="secondary-button">
              <Bell className="h-4 w-4" /> {unread} notification(s)
            </button>
          </div>
        </section>

        <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                {yearData.messages.filter((message) => message.threadParentId === user.parentId).map((message) => (
                  <div key={message.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                    <p className="break-words font-semibold text-ink">{message.subject}</p>
                    <p className="break-words text-slate-600">{message.body}</p>
                    <p className="mt-1 text-xs text-slate-400">{new Date(message.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                ))}
              </div>
            </FormPanel>
          </div>
        </section>
      </main>
    </div>
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
  updateData: (next: Partial<AppData>) => void;
  onOpenStudent: (studentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | "maternelle" | "primaire" | "secondaire">("all");
  const [classFilter, setClassFilter] = useState("");
  const [optionFilter, setOptionFilter] = useState("");
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
    return (
      (student.status ?? "ACTIVE") === "ACTIVE" &&
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
      auditLogs: [createAuditLog(user, school.id, year.id, "Soft delete élève", `${student.matricule} - ${reason}`), ...data.auditLogs],
    });
  }

  async function createParentForStudent() {
    setSaveError("");
    if (!quickParent.fullName || !quickParent.phone || !quickParent.email) return;
    const parentId = uid("parent");
    const existingUser = data.users.find((item) => item.email.toLowerCase() === quickParent.email.toLowerCase());
    let userId = existingUser?.id;
    if (!userId) {
      try {
        userId = await createFirebaseAuthUser(quickParent.email, quickParent.password || "parent123", uid("u-parent"));
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
      demoPassword: quickParent.password || undefined,
      status: "active",
      phone: parent.phone,
    };
    updateData({
      parents: [...data.parents, parent],
      users: existingUser ? data.users.map((item) => (item.id === existingUser.id ? { ...item, ...parentUser } : item)) : [...data.users, parentUser],
    });
    setForm({ ...form, parentId });
    setQuickParent({ fullName: "", phone: "", email: "", password: "" });
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
        <div className="mb-3 grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_180px_220px]">
          <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" className="min-w-0 flex-1 outline-none" />
          </label>
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
          <table className="min-w-[820px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Matricule</th>
                <th className="px-3 py-3">Nom complet</th>
                <th className="px-3 py-3">Sexe</th>
                <th className="px-3 py-3">Classe</th>
                <th className="px-3 py-3">Téléphone</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} className="border-t border-slate-100">
                  <td className="px-3 py-3 font-semibold text-ink">{student.matricule}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => onOpenStudent(student.id)} className="text-left font-semibold text-ink hover:text-blue-700 hover:underline">
                      {student.nom} {student.postnom} {student.prenom}
                    </button>
                  </td>
                  <td className="px-3 py-3">{student.sexe}</td>
                  <td className="px-3 py-3">{student.className}</td>
                  <td className="px-3 py-3">{student.phone}</td>
                  <td className="px-3 py-3">
                    {canEdit ? (
                      <div className="flex gap-1">
                        <IconButton label="Modifier" onClick={() => openEditStudentForm(student)} icon={Edit3} />
                        <IconButton label="Supprimer" onClick={() => removeStudent(student.id)} icon={Trash2} danger />
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Lecture seule</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {canEdit && showForm && (
        <div className="transition-all duration-300 ease-out">
          <FormPanel title={form.id.startsWith("new") ? "Ajouter un élève" : "Modifier l'élève"}>
            <button onClick={() => setShowForm(false)} className="secondary-button justify-center">
              <X className="h-4 w-4" /> Fermer
            </button>
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
          </FormPanel>
        </div>
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
              <span className="rounded bg-mint/10 px-2 py-1 text-xs font-semibold text-mint">{student.status ?? "ACTIVE"}</span>
            </div>
          </div>
        </div>
      </article>

      <section className="grid min-w-0 gap-4 lg:grid-cols-2">
        <FormPanel title="Informations générales">
          <Metric label="Sexe" value={student.sexe} />
          <Metric label="Date de naissance" value={student.birthDate} />
          <Metric label="Adresse" value={student.address} />
          <Metric label="Téléphone" value={student.phone} />
          <Metric label="Parent" value={parent?.fullName ?? "Non renseigné"} />
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
                    <button onClick={() => fee && generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Télécharger le reçu PDF">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="break-words text-slate-500">${payment.amount} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
          </div>
        </FormPanel>

        <FormPanel title="Résultats scolaires">
          <p className="text-sm text-slate-500">Structure prête pour les résultats scolaires.</p>
        </FormPanel>

        <FormPanel title="Présences">
          <p className="text-sm text-slate-500">Structure prête pour les présences.</p>
        </FormPanel>

        <FormPanel title="Documents">
          <p className="text-sm text-slate-500">Structure prête pour les documents.</p>
        </FormPanel>

        <FormPanel title="Observations">
          <p className="text-sm text-slate-500">{student.exitReasonDetails ?? "Aucune observation enregistrée."}</p>
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
  updateData: (next: Partial<AppData>) => void;
}) {
  const [form, setForm] = useState<ParentProfile>(() => emptyParent(school.id, year.id));
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [parentError, setParentError] = useState("");
  const filteredParents = yearData.parents.filter((parent) => {
    const text = `${parent.fullName} ${parent.email} ${parent.phone}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  async function saveParentProfile() {
    setParentError("");
    if (!form.fullName || !form.email || !form.phone) return;

    const isNew = form.id.startsWith("new");
    const parentId = isNew ? uid("parent") : form.id;
    const existingUser = data.users.find((item) => item.id === form.userId || item.parentId === parentId);
    const userId = isNew || !existingUser ? await createFirebaseAuthUser(form.email, password || "parent123", uid("u-parent")) : existingUser.id;
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
      demoPassword: password || undefined,
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

    updateData({ parents: nextParents, users: nextUsers, students: nextStudents });
    setForm(emptyParent(school.id, year.id));
    setPassword("");
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
        {form.id.startsWith("new") && <Field label="Mot de passe temporaire" value={password} onChange={setPassword} type="password" />}
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
  updateData: (next: Partial<AppData>) => void;
}) {
  const [studentId, setStudentId] = useState(yearData.students[0]?.id ?? "");
  const [feeTypeId, setFeeTypeId] = useState(yearData.feeTypes[0]?.id ?? "");
  const [amount, setAmount] = useState("100");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Fournitures");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [amountComparator, setAmountComparator] = useState<"all" | ">=" | "<">("all");
  const [amountThreshold, setAmountThreshold] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState("");
  const canPay = user.role === "cashier";
  const canCorrectPayments = user.role === "school_admin";
  const selectedPaymentStudent = yearData.students.find((student) => student.id === studentId);
  const payableFeeTypes = yearData.feeTypes.filter((fee) => !fee.className || !selectedPaymentStudent || fee.className === selectedPaymentStudent.className);
  const selectedFeeTypeValue = payableFeeTypes.some((fee) => fee.id === feeTypeId) ? feeTypeId : payableFeeTypes[0]?.id ?? "";
  const selectedHistoryStudent = yearData.students.find((student) => student.id === selectedHistoryStudentId);

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

  function studentFullName(student: Student) {
    return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
  }

  function formatMoney(value: number) {
    return `$${value.toFixed(2)}`;
  }

  function formatPaymentDate(value: string) {
    return new Date(value).toLocaleDateString("fr-FR");
  }

  function savePayment() {
    if (!studentId || !selectedFeeTypeValue) return;
    const student = data.students.find((item) => item.id === studentId);
    const payment: Payment = {
      id: uid("pay"),
      schoolId: school.id,
      schoolYearId: year.id,
      studentId,
      parentId: student?.parentId,
      feeTypeId: selectedFeeTypeValue,
      amount: Number(amount),
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
          body: `Un paiement de $${Number(amount).toFixed(2)} a été enregistré pour ${student.nom} ${student.prenom}.`,
          createdAt: new Date().toISOString(),
          read: false,
        }
      : undefined;
    updateData({
      payments: [...data.payments, payment],
      notifications: notification ? [notification, ...data.notifications] : data.notifications,
      auditLogs: [createAuditLog(user, school.id, year.id, "Création paiement", `${payment.receiptNumber} - $${payment.amount}`), ...data.auditLogs],
    });
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
    const reason = prompt("Motif obligatoire de correction");
    if (!reason) return;
    updateData({
      payments: data.payments.map((item) =>
        item.id === payment.id ? { ...item, amount: Number(nextAmount), updatedAt: new Date().toISOString(), correctionReason: reason } : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Correction paiement", `${payment.receiptNumber ?? payment.id}: ancien $${payment.amount}, nouveau $${Number(nextAmount)}. Motif: ${reason}`),
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

  function printFilteredStudents() {
    const printedAt = new Date().toLocaleString("fr-FR");
    const filterLabel =
      amountComparator === "all" || !amountThreshold
        ? "Montant payÃ© : tous"
        : `Montant payÃ© ${amountComparator} ${amountThreshold}`;
    const rowsHtml = rows
      .map(
        ({ student, balance }) => `
          <tr>
            <td>${student.nom} ${student.postnom} ${student.prenom}</td>
            <td>${student.matricule}</td>
            <td>${student.className}</td>
            <td>$${balance.expected}</td>
            <td>$${balance.paid}</td>
            <td>$${balance.remaining}</td>
          </tr>
        `,
      )
      .join("");
    const printWindow = window.open("", "_blank", "width=1024,height=720");
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>ContrÃ´le des paiements</title>
          <style>
            body { font-family: Arial, sans-serif; color: #14213d; margin: 32px; }
            h1 { margin: 0 0 8px; font-size: 22px; }
            p { margin: 4px 0; color: #475569; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 13px; }
            th, td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
            th { background: #f8fafc; color: #334155; text-transform: uppercase; font-size: 11px; }
          </style>
        </head>
        <body>
          <h1>${school.name}</h1>
          <p>AnnÃ©e scolaire : ${year.name}</p>
          <p>Date d'impression : ${printedAt}</p>
          <p>CritÃ¨re : ${filterLabel}</p>
          <table>
            <thead>
              <tr>
                <th>Nom de l'Ã©lÃ¨ve</th>
                <th>Matricule</th>
                <th>Classe</th>
                <th>Montant prÃ©vu</th>
                <th>Montant payÃ©</th>
                <th>Solde restant</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function createStudentHistoryPdf(action: "view" | "print") {
    if (!selectedHistoryStudent) return;

    const { default: jsPDF } = await import("jspdf");
    type StudentHistoryPdfDoc = InstanceType<typeof jsPDF> & {
      addPage: () => void;
      splitTextToSize: (text: string, maxWidth: number) => string[];
      output: (type: "bloburl") => URL | string;
      internal: InstanceType<typeof jsPDF>["internal"] & { pageSize: { getWidth: () => number; getHeight: () => number } };
    };
    const doc = new jsPDF() as StudentHistoryPdfDoc;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const tableWidth = pageWidth - margin * 2;
    let y = 18;

    function ensureSpace(height: number) {
      if (y + height <= pageHeight - 14) return;
      doc.addPage();
      y = 18;
    }

    doc.setFillColor(20, 33, 61);
    doc.rect(0, 0, pageWidth, 34, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.text(school.name, margin, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Annee scolaire : ${year.name}`, margin, 24);

    y = 48;
    doc.setTextColor(20, 33, 61);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Historique individuel des paiements", margin, y);
    y += 9;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`Date de generation : ${new Date().toLocaleString("fr-FR")}`, margin, y);
    y += 10;

    const identityRows = [
      ["Eleve", studentFullName(selectedHistoryStudent)],
      ["Matricule", selectedHistoryStudent.matricule],
      ["Classe", selectedHistoryStudent.className],
    ];
    identityRows.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(`${label} :`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(value, margin + 32, y);
      y += 6;
    });
    y += 6;

    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y - 5, tableWidth, 9, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Date", margin + 2, y);
    doc.text("Type de frais", margin + 36, y);
    doc.text("Montant paye", margin + 106, y);
    doc.text("Solde restant", margin + 150, y);
    y += 7;

    doc.setFont("helvetica", "normal");
    selectedHistoryRows.forEach((row) => {
      ensureSpace(8);
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y - 4, margin + tableWidth, y - 4);
      doc.text(formatPaymentDate(row.payment.paidAt), margin + 2, y);
      doc.text(doc.splitTextToSize(String(row.feeName), 62)[0] ?? String(row.feeName), margin + 36, y);
      doc.text(formatMoney(row.payment.amount), margin + 106, y);
      doc.text(formatMoney(row.remaining), margin + 150, y);
      y += 8;
    });

    if (selectedHistoryRows.length === 0) {
      doc.text("Aucun paiement enregistre pour cet eleve.", margin + 2, y);
      y += 8;
    }

    y += 6;
    ensureSpace(24);
    doc.setFillColor(245, 247, 251);
    doc.roundedRect(margin, y, tableWidth, 22, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Total paye : ${formatMoney(selectedHistoryBalance.paid)}`, margin + 6, y + 9);
    doc.text(`Total restant : ${formatMoney(selectedHistoryBalance.remaining)}`, margin + 6, y + 17);

    const pdfUrl = doc.output("bloburl").toString();
    if (action === "view") {
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      return;
    }

    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.src = pdfUrl;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 60000);
    };
    document.body.appendChild(frame);
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
          <button onClick={() => setHistoryOpen(true)} className="secondary-button">
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
                <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${balance.remaining === 0 ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                  {balance.remaining === 0 ? "En ordre" : "Non en ordre"}
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
      <div className="min-w-0 space-y-4">
        {canPay && (
          <FormPanel title="Enregistrer un paiement">
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="input">
              {yearData.students.map((student) => (
                <option key={student.id} value={student.id}>{student.nom} {student.prenom}</option>
              ))}
            </select>
            <select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} className="input">
              {payableFeeTypes.map((fee) => (
                <option key={fee.id} value={fee.id}>{fee.name} - ${fee.amount}</option>
              ))}
            </select>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
            <button onClick={savePayment} className="primary-button"><Plus className="h-4 w-4" /> Enregistrer</button>
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
      {historyOpen && (
        <div className="fixed inset-0 z-50 bg-ink/30 p-3 backdrop-blur-sm">
          <div className="ml-auto flex h-full w-full max-w-xl flex-col rounded border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <h2 className="break-words text-lg font-bold text-ink">Historique des paiements</h2>
              <button onClick={() => setHistoryOpen(false)} className="rounded bg-slate-100 p-2 text-slate-700" aria-label="Fermer l'historique">
                <X className="h-4 w-4" />
              </button>
            </div>
            <label className="mb-3 flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Rechercher par nom ou matricule"
              />
            </label>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              {filteredHistoryPayments.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
              {filteredHistoryPayments.map(({ payment, student, fee }) => {
                return (
                  <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Télécharger le reçu PDF">
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
          </div>
        </div>
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
  updateData: (next: Partial<AppData>) => void;
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
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  years: SchoolYear[];
  selectedYear: SchoolYear;
  onYearChange: (id: string) => void;
  updateData: (next: Partial<AppData>) => void;
}) {
  type MenuSection = "school" | "years" | "accounts" | "fees" | "financial";
  const [schoolForm, setSchoolForm] = useState(school);
  const [cashierName, setCashierName] = useState("");
  const [cashierPhone, setCashierPhone] = useState("");
  const [cashierEmail, setCashierEmail] = useState("");
  const [cashierPassword, setCashierPassword] = useState("");
  const [cashierError, setCashierError] = useState("");
  const [feeName, setFeeName] = useState<FeeKind>("Minerval");
  const [feeClassName, setFeeClassName] = useState<SchoolClass>(CLASSES[0]);
  const [feeAmount, setFeeAmount] = useState("100");
  const [editingFeeId, setEditingFeeId] = useState("");
  const [showNewFeeForm, setShowNewFeeForm] = useState(false);
  const [newFeeName, setNewFeeName] = useState("");
  const [activeMenuSection, setActiveMenuSection] = useState<MenuSection | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const canAdmin = user.role === "school_admin";
  const menuSections = [
    { id: "school", title: "Paramètres école", description: "Logo, coordonnées et informations de l'établissement.", icon: Settings },
    { id: "years", title: "Années scolaires", description: "Année active, années archivées et contexte global.", icon: BookOpen },
    { id: "accounts", title: "Créer un caissier", description: "Compte de connexion caissier lié à l'école.", icon: ShieldCheck },
    { id: "fees", title: "Types de frais", description: "Montants et catégories de frais scolaires.", icon: Banknote },
    { id: "financial", title: "Rapport financier", description: "Synthèse et exports des rapports financiers.", icon: BarChart3 },
  ] satisfies { id: MenuSection; title: string; description: string; icon: typeof Settings }[];
  const menuPanelOpen =
    activeMenuSection === "school" ||
    activeMenuSection === "years" ||
    activeMenuSection === "financial" ||
    (canAdmin && (activeMenuSection === "accounts" || activeMenuSection === "fees"));
  const feeKindChoices = Array.from(new Set([...FEE_KINDS, ...yearData.feeTypes.map((fee) => fee.name)]));

  useEffect(() => {
    if (!menuPanelOpen) return;

    function closeOnOutsideClick(event: MouseEvent) {
      if (menuPanelRef.current && !menuPanelRef.current.contains(event.target as Node)) {
        setActiveMenuSection(null);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActiveMenuSection(null);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuPanelOpen]);

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
    if (!cashierName || !cashierEmail || !cashierPassword) return;

    const existingUser = data.users.find((item) => item.email.toLowerCase() === cashierEmail.toLowerCase());
    let cashierId = existingUser?.id;
    if (!cashierId) {
      try {
        cashierId = await createFirebaseAuthUser(cashierEmail, cashierPassword, uid("u-cashier"));
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
      demoPassword: cashierPassword,
      phone: cashierPhone,
      status: "active",
      active: true,
      createdAt: new Date().toISOString(),
    };
    updateData({ users: existingUser ? data.users.map((item) => (item.id === existingUser.id ? { ...item, ...cashierUser } : item)) : [...data.users, cashierUser] });
    setCashierName("");
    setCashierPhone("");
    setCashierEmail("");
    setCashierPassword("");
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

  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-3">
        {menuSections.map((section) => {
          const Icon = section.icon;
          const active = activeMenuSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => {
                setActiveMenuSection(section.id);
              }}
              className={`min-w-0 rounded border p-4 text-left shadow-sm transition ${
                active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-mint"
              }`}
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
      </div>

      {menuPanelOpen && (
      <div
        ref={menuPanelRef}
        className="fixed inset-x-3 bottom-24 top-24 z-30 min-w-0 animate-[menuDrawerIn_180ms_ease-out] overflow-y-auto rounded border border-slate-200 bg-white p-3 shadow-2xl scrollbar-thin lg:static lg:inset-auto lg:z-auto lg:animate-[menuPanelIn_180ms_ease-out] lg:overflow-visible lg:bg-transparent lg:p-0 lg:shadow-none"
      >
      {activeMenuSection === "school" && (
      <FormPanel title="Paramètres école">
        <Field label="Logo URL" value={schoolForm.logoUrl ?? ""} onChange={(value) => setSchoolForm({ ...schoolForm, logoUrl: value })} disabled={!canAdmin} />
        <Field label="Nom de l'école" value={schoolForm.name} onChange={(value) => setSchoolForm({ ...schoolForm, name: value })} disabled={!canAdmin} />
        <Field label="Adresse" value={schoolForm.address} onChange={(value) => setSchoolForm({ ...schoolForm, address: value })} disabled={!canAdmin} />
        <Field label="Téléphone" value={schoolForm.phone} onChange={(value) => setSchoolForm({ ...schoolForm, phone: value })} disabled={!canAdmin} />
        <Field label="Email" value={schoolForm.email} onChange={(value) => setSchoolForm({ ...schoolForm, email: value })} disabled={!canAdmin} />
        <p className="rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">Année scolaire : {selectedYear.name}</p>
        {canAdmin && <button onClick={saveSchool} className="primary-button"><Settings className="h-4 w-4" /> Enregistrer</button>}
      </FormPanel>
      )}

      {activeMenuSection === "years" && (
      <FormPanel title="Années scolaires">
        <div className="space-y-2">
          {years.map((year) => (
            <div key={year.id} className={`flex min-w-0 flex-col gap-2 rounded border p-3 sm:flex-row sm:items-center sm:justify-between ${year.id === selectedYear.id ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-white"}`}>
              <button onClick={() => onYearChange(year.id)} className="min-w-0 text-left">
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
                  <button onClick={() => activateYear(year.id)} className="rounded bg-mint px-3 py-2 text-xs font-semibold text-white">Activer</button>
                  <button onClick={() => archiveYear(year.id)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Archiver</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </FormPanel>
      )}

      {canAdmin && activeMenuSection === "accounts" && (
        <FormPanel title="Créer un caissier">
          {cashierError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{cashierError}</p>}
          <Field label="Nom complet" value={cashierName} onChange={setCashierName} />
          <Field label="Téléphone" value={cashierPhone} onChange={setCashierPhone} />
          <Field label="Email" value={cashierEmail} onChange={setCashierEmail} />
          <Field label="Mot de passe temporaire" value={cashierPassword} onChange={setCashierPassword} type="password" />
          <button onClick={saveCashier} disabled={!cashierName || !cashierEmail || !cashierPassword} className="primary-button disabled:opacity-50">
            <UserRound className="h-4 w-4" /> Créer le caissier
          </button>
        </FormPanel>
      )}

      {canAdmin && activeMenuSection === "fees" && (
        <FormPanel title="Types de frais">
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
            <button onClick={saveFee} className="primary-button"><Plus className="h-4 w-4" /> {editingFeeId ? "Enregistrer" : "Ajouter"}</button>
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
        </FormPanel>
      )}

      {activeMenuSection === "financial" && (
        <div className="grid min-w-0 gap-4">
          <div className="mb-1 flex min-w-0 items-center gap-2">
            <button
              onClick={() => setActiveMenuSection(null)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded bg-white text-slate-600 transition hover:bg-slate-50 hover:text-ink"
              aria-label="Retour au menu"
              title="Retour au menu"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="break-words text-2xl font-bold text-ink">Rapport financier</h1>
          </div>
          <ReportsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} />
        </div>
      )}
      </div>
      )}
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
          <input value={quickParent.password} onChange={(event) => setQuickParent({ ...quickParent, password: event.target.value })} type="password" className="input" placeholder="Mot de passe temporaire" />
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
      <Field label="Photo URL" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} />
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
  const { default: jsPDF } = await import("jspdf");
  type StudentsPdfDoc = InstanceType<typeof jsPDF> & {
    addPage: () => void;
    splitTextToSize: (text: string, maxWidth: number) => string[];
    internal: InstanceType<typeof jsPDF>["internal"] & { pageSize: { getWidth: () => number; getHeight: () => number } };
  };
  const doc = new jsPDF() as StudentsPdfDoc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.text(`Liste des élèves - ${school.name}`, margin, y);
  y += 8;
  doc.setFontSize(10);
  doc.text(`Année scolaire : ${year.name}`, margin, y);
  y += 6;
  doc.text(`Date d'impression : ${new Date().toLocaleDateString("fr-FR")}`, margin, y);
  y += 6;
  doc.text(doc.splitTextToSize(`Filtres appliqués : ${filters.join(" | ")}`, pageWidth - margin * 2), margin, y);
  y += 14;

  const columns = [
    { label: "Matricule", x: margin },
    { label: "Nom complet", x: 42 },
    { label: "Sexe", x: 106 },
    { label: "Classe", x: 124 },
    { label: "Téléphone", x: 166 },
  ];

  function drawHeader() {
    doc.setFillColor(245, 247, 251);
    doc.rect(margin, y - 5, pageWidth - margin * 2, 8, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    columns.forEach((column) => doc.text(column.label, column.x, y));
    doc.setFont("helvetica", "normal");
    y += 7;
  }

  drawHeader();
  students.forEach((student) => {
    if (y > pageHeight - 18) {
      doc.addPage();
      y = 18;
      drawHeader();
    }
    doc.setFontSize(8);
    const fullName = `${student.nom} ${student.postnom} ${student.prenom}`.trim();
    doc.text(student.matricule || "-", margin, y);
    doc.text(doc.splitTextToSize(fullName || "-", 58)[0] ?? "-", 42, y);
    doc.text(student.sexe || "-", 106, y);
    doc.text(doc.splitTextToSize(student.className || "-", 38)[0] ?? "-", 124, y);
    doc.text(student.phone || "-", 166, y);
    y += 7;
  });

  if (students.length === 0) {
    doc.setFontSize(10);
    doc.text("Aucun élève ne correspond aux filtres appliqués.", margin, y);
  }

  doc.save(`eleves-${year.name}.pdf`);
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
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(`Rapport Acadéa - ${school.name}`, 14, 18);
  doc.setFontSize(10);
  doc.text(`Année scolaire: ${year.name}`, 14, 28);
  doc.text(`Période: ${startDate} au ${endDate}`, 14, 34);
  doc.text(`Paiements: $${paid.toFixed(2)} | Dépenses: $${spent.toFixed(2)} | Solde: $${(paid - spent).toFixed(2)} | Recouvrement: ${recovery}%`, 14, 44);
  let y = 58;
  doc.setFontSize(12);
  doc.text("Paiements", 14, y);
  y += 8;
  payments.slice(0, 24).forEach((payment) => {
    doc.setFontSize(9);
    doc.text(`${payment.paidAt} - ${payment.cashierName} - $${payment.amount.toFixed(2)} - ${payment.receiptNumber ?? payment.id}`, 14, y);
    y += 6;
  });
  y += 4;
  doc.setFontSize(12);
  doc.text("Dépenses", 14, y);
  y += 8;
  expenses.slice(0, 24).forEach((expense) => {
    doc.setFontSize(9);
    doc.text(`${expense.spentAt} - ${expense.category} - $${expense.amount.toFixed(2)} - ${expense.description}`, 14, y);
    y += 6;
  });
  doc.save(`rapport-${startDate}-${endDate}.pdf`);
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
