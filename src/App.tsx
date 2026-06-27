import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpDown,
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
type PaymentFilter = "all" | "paid" | "due";

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

  function openNotification(notification: AppNotification) {
    markNotificationsRead(notification.id);
    setNotificationsOpen(false);
    if (notification.type === "message") {
      setActiveTab("messages");
      saveSession(user, currentYear.id, "messages");
      navigate("/dashboard");
    }
  }

  if (validateParent(user)) {
    return <ParentPortal user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} onRefresh={refreshData} onLogout={logout} />;
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f8fb] pb-24 sm:pb-28">
      <EnvironmentBanner />
      <Header
        user={user}
        school={school}
        year={selectedYear}
        notifications={yearData.notifications}
        unreadNotifications={unreadNotifications}
        notificationsOpen={notificationsOpen}
        onRefresh={refreshData}
        onToggleNotifications={openNotifications}
        onOpenNotification={openNotification}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-7xl min-w-0 px-3 py-5 sm:px-6 lg:px-8">
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
          <FinancialReportPage user={user} data={data} yearData={yearData} school={school} year={selectedYear} />
        ) : activeTab === "dashboard" && <Dashboard data={yearData} />}
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
            onOpenFinancialReport={() => navigate("/admin/rapport-financier")}
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
    <main className="flex min-h-screen w-full flex-col items-center justify-center overflow-x-hidden bg-[#F5F7FB] px-3 py-4 sm:px-6 sm:py-8">
      <EnvironmentBanner />
      <style>{`
        @keyframes loginCardIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <section className="w-full max-w-[460px] overflow-hidden rounded-[22px] border border-white/80 bg-white p-4 shadow-[0_24px_80px_rgba(15,23,42,0.10)] [animation:loginCardIn_520ms_ease-out] sm:rounded-[24px] sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-[22px] bg-ink text-2xl font-bold text-white shadow-[0_14px_30px_rgba(20,33,61,0.22)]">
            {logoPreview ? <img src={logoPreview} alt="Logo Acadéa" className="h-full w-full object-cover" /> : "A"}
          </div>
          <h1 className="mt-4 break-words text-3xl font-bold tracking-normal text-ink">Acadéa</h1>
          <p className="mt-2 break-words text-sm font-medium text-slate-500">Gestion scolaire sécurisée par école</p>
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

        <div className="mt-6 text-center sm:mt-8">
          <h2 className="text-2xl font-bold text-ink">Connexion</h2>
          <p className="mt-2 text-sm text-slate-500">Entrez vos identifiants pour continuer</p>
        </div>

        <form onSubmit={submit} className="mt-6 grid min-w-0 gap-4 sm:mt-7">
          <label className="group grid gap-2 text-sm font-semibold text-slate-700">
            Email
            <span className="flex h-14 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:px-4">
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
            <span className="flex h-14 min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-[#F8FAFC] px-3 transition duration-200 group-focus-within:border-blue-500 group-focus-within:bg-white group-focus-within:shadow-[0_0_0_4px_rgba(59,130,246,0.12)] sm:px-4">
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
            className="mt-1 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-white shadow-[0_16px_34px_rgba(20,33,61,0.22)] transition duration-200 hover:bg-[#0f1a30] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-2 text-sm font-medium text-slate-500">
          <ShieldCheck className="h-4 w-4 text-mint" />
          Espace sécurisé
        </div>

        <div className="mt-6 break-words rounded-2xl border border-slate-200 bg-[#F8FAFC] p-3 text-center text-xs leading-5 text-slate-500">
          Firebase SDK : {firebaseReady ? "configuré" : "mode démonstration local"}
        </div>

        {!firebaseReady && (
          <div className="mt-3 break-words rounded-2xl border border-slate-200 bg-white p-3 text-center text-xs leading-5 text-slate-500">
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
  notifications,
  unreadNotifications,
  notificationsOpen,
  onRefresh,
  onToggleNotifications,
  onOpenNotification,
  onLogout,
}: {
  user: AppUser;
  school: School;
  year: SchoolYear;
  notifications: AppNotification[];
  unreadNotifications: number;
  notificationsOpen: boolean;
  onRefresh: () => void;
  onToggleNotifications: () => void;
  onOpenNotification: (notification: AppNotification) => void;
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
            <span className="rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-600">Année scolaire : {year.name}</span>
            <button onClick={onRefresh} className="inline-flex items-center justify-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm" title="Actualiser">
              <RefreshCw className="h-4 w-4" /> Actualiser
            </button>
            <button onClick={onToggleNotifications} className="relative inline-flex items-center justify-center rounded border border-slate-200 px-3 py-2 text-sm" title="Notifications">
              <Bell className="h-4 w-4" />
              {unreadNotifications > 0 && (
                <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">
                  {unreadNotifications}
                </span>
              )}
            </button>
            <button onClick={onLogout} className="inline-flex items-center justify-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
              <LogOut className="h-4 w-4" /> Sortir
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-full min-w-72 rounded border border-slate-200 bg-white p-3 text-sm shadow-xl sm:w-80">
                <p className="mb-2 font-bold text-ink">Notifications</p>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                  {notifications.length === 0 && <p className="text-slate-500">Aucune notification.</p>}
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => onOpenNotification(notification)}
                      className="block w-full rounded bg-slate-50 p-3 text-left hover:bg-slate-100"
                    >
                      <p className="font-semibold text-ink">{notification.title}</p>
                      <p className="mt-1 break-words text-xs text-slate-500">{notification.body}</p>
                    </button>
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

function Dashboard({ data }: { data: ReturnType<typeof scopeData> }) {
  const stats = buildStats(data.students, data.parents, data.feeTypes, data.payments);
  const today = new Date().toISOString().slice(0, 10);
  const todayPayments = data.payments.filter((payment) => payment.paidAt === today);
  const todayExpenses = data.expenses.filter((expense) => expense.spentAt === today);
  const totalTodayPayments = todayPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalTodayExpenses = todayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const recoveryRate = stats.expected > 0 ? Math.round((stats.paid / stats.expected) * 100) : 0;
  const recoveryTone = recoveryRate >= 80 ? "text-mint bg-mint/10" : recoveryRate >= 50 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-50";
  const admins = data.users.filter((item) => item.role === "school_admin").length;
  const cashiers = data.users.filter((item) => item.role === "cashier").length;
  const classRows = CLASSES.map((className) => {
    const students = data.students.filter((student) => student.className === className && (student.status ?? "ACTIVE") === "ACTIVE");
    return {
      className,
      girls: students.filter((student) => student.sexe === "F").length,
      boys: students.filter((student) => student.sexe === "M").length,
      total: students.length,
    };
  }).filter((row) => row.total > 0);
  const transactions = [
    ...data.payments.map((payment) => ({ id: payment.id, type: "Paiement", label: payment.cashierName, amount: payment.amount, date: payment.createdAt ?? payment.paidAt })),
    ...data.expenses.map((expense) => ({ id: expense.id, type: "Dépense", label: expense.category, amount: -expense.amount, date: expense.createdAt })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  const cards = [
    { label: "Nombre total d'élèves", value: stats.students, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre total de parents", value: stats.parents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Administrateurs", value: admins, icon: ShieldCheck, tone: "bg-blue-100 text-blue-700" },
    { label: "Caissiers", value: cashiers, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Montant total encaissé", value: `$${stats.paid.toFixed(2)}`, icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant attendu", value: `$${stats.expected.toFixed(2)}`, icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
    { label: "Montant restant à payer", value: `$${stats.remaining.toFixed(2)}`, icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
    { label: "Nombre de classes", value: stats.classes, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
  ];

  return (
    <section>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-slate-500">Statistiques limitées à l'année scolaire sélectionnée.</p>
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
      <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="grid min-w-0 gap-4">
          <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-bold text-ink">KPI financier</h2>
                <p className="text-sm text-slate-500">Recouvrement sur l'année scolaire sélectionnée.</p>
              </div>
              <span className={`rounded px-3 py-2 text-sm font-bold ${recoveryTone}`}>{recoveryRate}% recouvré</span>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
              <div className="h-full rounded bg-mint" style={{ width: `${Math.min(100, recoveryRate)}%` }} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <Metric label="Jour encaissé" value={`$${totalTodayPayments.toFixed(2)}`} />
              <Metric label="Jour dépenses" value={`$${totalTodayExpenses.toFixed(2)}`} />
              <Metric label="Attendu" value={`$${stats.expected.toFixed(2)}`} />
              <Metric label="Reste" value={`$${stats.remaining.toFixed(2)}`} />
            </div>
          </div>

          <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-bold text-ink">Élèves par classe</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Classe</th>
                    <th className="py-2">Filles</th>
                    <th className="py-2">Garçons</th>
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
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <FormPanel title="Transactions récentes">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {transactions.map((transaction) => (
              <div key={transaction.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-slate-50 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{transaction.type}</p>
                  <p className="break-words text-xs text-slate-500">{transaction.label} | {transaction.date.slice(0, 10)}</p>
                </div>
                <span className={transaction.amount >= 0 ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>
                  {transaction.amount >= 0 ? "+" : "-"}${Math.abs(transaction.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </FormPanel>
      </div>
    </section>
  );
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
              const balance = getStudentBalance(student.id, yearData.feeTypes, yearData.payments);
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
  const [form, setForm] = useState<Student>(() => emptyStudent(school.id, year.id));
  const [quickParent, setQuickParent] = useState({ fullName: "", phone: "", email: "", password: "" });
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const canEdit = user.role === "school_admin";
  const availableClasses = CLASSES.filter((className) => sectionFilter === "all" || getClassSection(className) === sectionFilter);

  const students = yearData.students.filter((student) => {
    const text = `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom}`.toLowerCase();
    return (
      (student.status ?? "ACTIVE") === "ACTIVE" &&
      text.includes(query.toLowerCase()) &&
      (sectionFilter === "all" || getClassSection(student.className) === sectionFilter) &&
      (!classFilter || student.className === classFilter)
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
    const userId = await createFirebaseAuthUser(quickParent.email, quickParent.password || "parent123", uid("u-parent"));
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
    updateData({ parents: [...data.parents, parent], users: [...data.users, parentUser] });
    setForm({ ...form, parentId });
    setQuickParent({ fullName: "", phone: "", email: "", password: "" });
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
            <option value="all">Toutes directions</option>
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

  const balance = getStudentBalance(student.id, yearData.feeTypes, yearData.payments);
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
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  year: SchoolYear;
}) {
  return (
    <section className="grid min-w-0 gap-4">
      <SectionTitle title="Rapport financier" subtitle="Rapports financiers dédiés à l'année scolaire sélectionnée." />
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
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [studentId, setStudentId] = useState(yearData.students[0]?.id ?? "");
  const [feeTypeId, setFeeTypeId] = useState(yearData.feeTypes[0]?.id ?? "");
  const [amount, setAmount] = useState("100");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Fournitures");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [amountComparator, setAmountComparator] = useState<"all" | ">=" | "<=">("all");
  const [amountThreshold, setAmountThreshold] = useState("");
  const canPay = user.role === "cashier";
  const canCorrectPayments = user.role === "school_admin";

  const rows = yearData.students
    .map((student) => ({ student, balance: getStudentBalance(student.id, yearData.feeTypes, yearData.payments) }))
    .filter((row) => filter === "all" || (filter === "paid" ? row.balance.remaining === 0 : row.balance.remaining > 0))
    .filter((row) => {
      if (amountComparator === "all" || !amountThreshold) return true;
      return amountComparator === ">=" ? row.balance.paid >= Number(amountThreshold) : row.balance.paid <= Number(amountThreshold);
    });

  function savePayment() {
    if (!studentId || !feeTypeId) return;
    const student = data.students.find((item) => item.id === studentId);
    const payment: Payment = {
      id: uid("pay"),
      schoolId: school.id,
      schoolYearId: year.id,
      studentId,
      parentId: student?.parentId,
      feeTypeId,
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

  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0">
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en dollar américain." />
        <div className="mb-3 flex min-w-0 flex-wrap gap-2">
          {(["all", "paid", "due"] as PaymentFilter[]).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded px-3 py-2 text-sm font-semibold ${filter === item ? "bg-ink text-white" : "bg-white text-slate-700"}`}
            >
              {item === "all" ? "Tous" : item === "paid" ? "Élèves en ordre" : "Élèves non en ordre"}
            </button>
          ))}
          <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value as typeof amountComparator)} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <option value="all">Montant payé</option>
            <option value=">=">Payé &gt;=</option>
            <option value="<=">Payé &lt;=</option>
          </select>
          <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="w-32 max-w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Montant" />
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {rows.map(({ student, balance }) => (
            <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-bold text-ink">{student.nom} {student.prenom}</h3>
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
            <select value={feeTypeId} onChange={(event) => setFeeTypeId(event.target.value)} className="input">
              {yearData.feeTypes.map((fee) => (
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
        <FormPanel title="Historique des paiements">
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {yearData.payments.map((payment) => {
              const student = yearData.students.find((item) => item.id === payment.studentId);
              const fee = yearData.feeTypes.find((item) => item.id === payment.feeTypeId);
              if (!student || !fee) return null;
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
        </FormPanel>
      </div>
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
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const canSend = user.role !== "parent";

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

  return (
    <section className="grid min-w-0 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      {canSend && (
        <FormPanel title="Envoyer un message">
          <select value={recipientParentId} onChange={(event) => setRecipientParentId(event.target.value)} className="input">
            <option value="all">Tous les parents</option>
            {yearData.parents.map((parent) => (
              <option key={parent.id} value={parent.id}>{parent.fullName}</option>
            ))}
          </select>
          <input value={subject} onChange={(event) => setSubject(event.target.value)} className="input" placeholder="Objet" />
          <textarea value={body} onChange={(event) => setBody(event.target.value)} className="input min-h-32" placeholder="Message" />
          <button onClick={sendMessage} disabled={!subject || !body} className="primary-button disabled:opacity-50">
            <MessageSquare className="h-4 w-4" /> Envoyer
          </button>
        </FormPanel>
      )}
      <div className="min-w-0">
        <SectionTitle title="Messages" subtitle={user.role === "parent" ? "Messages reçus par le parent connecté." : "Historique des messages envoyés."} />
        <div className="min-w-0 space-y-3">
          {yearData.messages.map((message) => {
            const recipient =
              message.recipientParentId === "all"
                ? "Tous les parents"
                : message.recipientParentId === "school"
                  ? "École"
                  : yearData.parents.find((parent) => parent.id === message.recipientParentId)?.fullName;
            const threadParent = message.threadParentId ? yearData.parents.find((parent) => parent.id === message.threadParentId) : undefined;
            return (
              <article key={message.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="break-words font-bold text-ink">{message.subject}</h3>
                    <p className="break-words text-xs text-slate-500">{recipient}{threadParent ? ` | ${threadParent.fullName}` : ""} | {new Date(message.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                  {message.recipientParentId === "school" && threadParent && (
                    <button
                      onClick={() => {
                        setRecipientParentId(threadParent.id);
                        setSubject(`Re: ${message.subject}`);
                      }}
                      className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      Répondre
                    </button>
                  )}
                </div>
                <p className="mt-3 break-words text-sm leading-6 text-slate-700">{message.body}</p>
              </article>
            );
          })}
        </div>
      </div>
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
  onOpenFinancialReport,
  updateData,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  years: SchoolYear[];
  selectedYear: SchoolYear;
  onYearChange: (id: string) => void;
  onOpenFinancialReport: () => void;
  updateData: (next: Partial<AppData>) => void;
}) {
  type MenuSection = "school" | "years" | "accounts" | "fees" | "financial";
  const [schoolForm, setSchoolForm] = useState(school);
  const [cashierName, setCashierName] = useState("");
  const [cashierPhone, setCashierPhone] = useState("");
  const [cashierEmail, setCashierEmail] = useState("");
  const [cashierPassword, setCashierPassword] = useState("");
  const [feeName, setFeeName] = useState<FeeKind>("Minerval");
  const [feeAmount, setFeeAmount] = useState("100");
  const [activeMenuSection, setActiveMenuSection] = useState<MenuSection | null>(null);
  const canAdmin = user.role === "school_admin";
  const menuSections = [
    { id: "school", title: "Paramètres école", description: "Logo, coordonnées et informations de l'établissement.", icon: Settings },
    { id: "years", title: "Années scolaires", description: "Année active, années archivées et contexte global.", icon: BookOpen },
    { id: "accounts", title: "Créer un caissier", description: "Compte de connexion caissier lié à l'école.", icon: ShieldCheck },
    { id: "fees", title: "Types de frais", description: "Montants et catégories de frais scolaires.", icon: Banknote },
    { id: "financial", title: "Rapport financier", description: "Synthèse et exports des rapports financiers.", icon: BarChart3 },
  ] satisfies { id: MenuSection; title: string; description: string; icon: typeof Settings }[];

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
    if (!cashierName || !cashierEmail || !cashierPassword) return;

    const cashierId = await createFirebaseAuthUser(cashierEmail, cashierPassword, uid("u-cashier"));
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
    updateData({ users: [...data.users, cashierUser] });
    setCashierName("");
    setCashierPhone("");
    setCashierEmail("");
    setCashierPassword("");
  }

  function addFee() {
    updateData({
      feeTypes: [
        ...data.feeTypes,
        { id: uid("fee"), schoolId: school.id, schoolYearId: selectedYear.id, name: feeName, amount: Number(feeAmount) },
      ],
    });
  }

  return (
    <section className="grid min-w-0 gap-4 xl:grid-cols-2">
      <div className="grid min-w-0 gap-3 xl:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
        {menuSections.map((section) => {
          const Icon = section.icon;
          const active = activeMenuSection === section.id;
          return (
            <button
              key={section.id}
              onClick={() => {
                if (section.id === "financial") {
                  onOpenFinancialReport();
                  return;
                }
                setActiveMenuSection(section.id);
              }}
              className={`min-w-0 rounded border p-4 text-left shadow-sm transition ${
                active ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:border-mint"
              }`}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded bg-slate-100 text-ink">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="break-words font-bold text-ink">{section.title}</h2>
              <p className="mt-1 break-words text-sm text-slate-500">{section.description}</p>
            </button>
          );
        })}
      </div>

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
          <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <select value={feeName} onChange={(event) => setFeeName(event.target.value as FeeKind)} className="input">
              {FEE_KINDS.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
            <input value={feeAmount} onChange={(event) => setFeeAmount(event.target.value)} type="number" className="input" />
            <button onClick={addFee} className="primary-button"><Plus className="h-4 w-4" /> Ajouter</button>
          </div>
          <div className="space-y-2">
            {yearData.feeTypes.map((fee) => (
              <div key={fee.id} className="flex min-w-0 justify-between gap-3 rounded bg-slate-50 p-3 text-sm">
                <span className="min-w-0 break-words">{fee.name}</span>
                <strong className="shrink-0">${fee.amount}</strong>
              </div>
            ))}
          </div>
        </FormPanel>
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
  onCreateParent,
  onSave,
  onReset,
}: {
  form: Student;
  setForm: (student: Student) => void;
  parents: ParentProfile[];
  quickParent: { fullName: string; phone: string; email: string; password: string };
  setQuickParent: (parent: { fullName: string; phone: string; email: string; password: string }) => void;
  onCreateParent: () => void;
  onSave: () => void;
  onReset: () => void;
}) {
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
          {CLASSES.map((className) => (
            <option key={className} value={className}>{className}</option>
          ))}
        </select>
      </label>
      {getClassSection(form.className) === "secondaire" && (
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Option
          <input value={form.option ?? ""} onChange={(event) => setForm({ ...form, option: event.target.value })} className="input" placeholder="Littéraire, Sciences, Pédagogique..." />
        </label>
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
