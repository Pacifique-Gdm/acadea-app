import { useState } from "react";
import {
  Banknote,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Download,
  Edit3,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  MessageSquare,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { demoData } from "./data/demoData";
import { firebaseReady } from "./firebase";
import { getDefaultRoute, signIn, signOutUser, validatePlatformAdmin, validateSchoolAdmin } from "./services/auth";
import { generateReceiptPdf } from "./utils/pdf";
import { buildStats, getStudentBalance } from "./utils/stats";
import type {
  AppData,
  AppUser,
  FeeKind,
  Message,
  ParentProfile,
  Payment,
  School,
  SchoolClass,
  SchoolYear,
  Student,
} from "./types";
import { CLASSES, FEE_KINDS } from "./types";

type Tab = "dashboard" | "students" | "control" | "messages" | "menu";
type PaymentFilter = "all" | "paid" | "due";

const roleLabels: Record<AppUser["role"], string> = {
  super_admin: "Super Administrateur",
  school_admin: "Administrateur d'école",
  cashier: "Caissier",
  parent: "Parent",
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export default function App() {
  const [data, setData] = useState<AppData>(demoData);
  const [user, setUser] = useState<AppUser | null>(null);
  const [selectedYearId, setSelectedYearId] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [route, setRoute] = useState(() => (window.location.pathname === "/platform" ? "/platform" : "/login"));

  const school = data.schools.find((item) => item.id === user?.schoolId);
  const schoolYears = school ? data.schoolYears.filter((year) => year.schoolId === school.id) : [];
  const selectedYear = schoolYears.find((year) => year.id === selectedYearId);

  function navigate(nextRoute: "/login" | "/dashboard" | "/platform") {
    window.history.pushState({}, "", nextRoute);
    setRoute(nextRoute);
  }

  function enterSchoolYear(yearId: string) {
    setSelectedYearId(yearId);
    setUser((currentUser) => (currentUser ? { ...currentUser, activeSchoolYearId: yearId } : currentUser));
    setData((prev) => ({
      ...prev,
      users: prev.users.map((item) => (item.id === user?.id ? { ...item, activeSchoolYearId: yearId } : item)),
    }));
  }

  async function loginWithCredentials(email: string, password: string) {
    const nextUser = await signIn(email, password, data);
    const nextRoute = getDefaultRoute(nextUser.role);

    if (nextRoute === "/platform" && !validatePlatformAdmin(nextUser)) {
      throw new Error("Accès plateforme refusé.");
    }

    if (nextRoute === "/dashboard") {
      if (!validateSchoolAdmin(nextUser)) {
        throw new Error("Seuls les administrateurs d'école peuvent accéder au dashboard école.");
      }

      const nextSchool = data.schools.find((item) => item.id === nextUser.schoolId);
      if (!nextSchool) {
        throw new Error("Aucune école n'est associée à ce compte.");
      }

      if (nextSchool.status !== "active") {
        throw new Error("Cette école est suspendue. Contactez la plateforme Acadéa.");
      }

      setSelectedYearId(nextUser.activeSchoolYearId ?? nextSchool.activeSchoolYearId);
    }

    setUser(nextUser);
    setActiveTab("dashboard");
    navigate(nextRoute);
  }

  async function logout() {
    await signOutUser();
    setUser(null);
    setSelectedYearId("");
    setActiveTab("dashboard");
    navigate("/login");
  }

  function updateData(next: Partial<AppData>) {
    setData((prev) => ({ ...prev, ...next }));
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

  if (!validateSchoolAdmin(user) || !school) {
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

  const yearData = scopeData(data, school.id, selectedYear.id, user);

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <Header
        user={user}
        school={school}
        year={selectedYear}
        years={schoolYears}
        activeTab={activeTab}
        onTab={setActiveTab}
        onYearChange={enterSchoolYear}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {activeTab === "dashboard" && <Dashboard data={yearData} />}
        {activeTab === "students" && (
          <StudentsModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
        )}
        {activeTab === "control" && (
          <ControlModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
        )}
        {activeTab === "messages" && (
          <MessagesModule user={user} data={data} yearData={yearData} school={school} year={selectedYear} updateData={updateData} />
        )}
        {activeTab === "menu" && (
          <MenuModule
            user={user}
            data={data}
            yearData={yearData}
            school={school}
            years={schoolYears}
            selectedYear={selectedYear}
            updateData={updateData}
          />
        )}
      </main>
    </div>
  );
}

function scopeData(data: AppData, schoolId: string, schoolYearId: string, user: AppUser) {
  const students =
    user.role === "parent"
      ? data.students.filter((student) => user.studentIds?.includes(student.id) && student.schoolYearId === schoolYearId)
      : data.students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId);
  const studentIds = students.map((student) => student.id);

  return {
    students,
    parents:
      user.role === "parent"
        ? data.parents.filter((parent) => parent.id === user.parentId && parent.schoolYearId === schoolYearId)
        : data.parents.filter((parent) => parent.schoolId === schoolId && parent.schoolYearId === schoolYearId),
    feeTypes: data.feeTypes.filter((fee) => fee.schoolId === schoolId && fee.schoolYearId === schoolYearId),
    payments: data.payments.filter((payment) => payment.schoolId === schoolId && payment.schoolYearId === schoolYearId && studentIds.includes(payment.studentId)),
    messages: data.messages.filter((message) => {
      const sameScope = message.schoolId === schoolId && message.schoolYearId === schoolYearId;
      if (!sameScope) return false;
      if (user.role !== "parent") return true;
      return message.recipientParentId === "all" || message.recipientParentId === user.parentId;
    }),
  };
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("direction@acadea.demo");
  const [password, setPassword] = useState("ecole123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    <main className="flex min-h-screen items-center justify-center bg-[#edf4f2] p-4">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-xl lg:grid-cols-[1fr_1.1fr]">
        <div className="bg-ink p-8 text-white sm:p-10">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded bg-mint font-bold">A</div>
            <div>
              <h1 className="text-3xl font-bold tracking-normal">Acadéa</h1>
              <p className="text-sm text-white/75">Gestion scolaire sécurisée par école</p>
            </div>
          </div>
          <div className="space-y-5">
            <p className="text-2xl font-semibold">Connexion</p>
            <p className="max-w-sm text-sm leading-6 text-white/75">
              Authentification obligatoire par email et mot de passe avant tout accès école ou plateforme.
            </p>
            <div className="rounded border border-white/15 bg-white/10 p-3 text-xs text-white/70">
              Firebase SDK: {firebaseReady ? "configuré" : "mode démonstration local"}
            </div>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <div className="mb-5">
            <p className="text-sm font-semibold uppercase text-mint">Accès sécurisé</p>
            <h2 className="text-2xl font-bold text-ink">Se connecter</h2>
          </div>
          <form onSubmit={submit} className="grid gap-4">
            <Field label="Email" value={email} onChange={setEmail} type="email" />
            <Field label="Mot de passe" value={password} onChange={setPassword} type="password" />
            {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700">{error}</p>}
            <button disabled={loading} className="primary-button disabled:opacity-60">
              <ShieldCheck className="h-4 w-4" /> {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>
          {!firebaseReady && (
            <div className="mt-5 rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              Démo: direction@acadea.demo / ecole123 pour l'école, admin@acadea.demo / admin123 pour la plateforme.
            </div>
          )}
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
  years,
  activeTab,
  onTab,
  onYearChange,
  onLogout,
}: {
  user: AppUser;
  school: School;
  year: SchoolYear;
  years: SchoolYear[];
  activeTab: Tab;
  onTab: (tab: Tab) => void;
  onYearChange: (id: string) => void;
  onLogout: () => void;
}) {
  const tabs = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "students", label: "Élèves", icon: GraduationCap },
    { id: "control", label: "Contrôle", icon: Banknote },
    { id: "messages", label: "Messages", icon: MessageSquare },
    { id: "menu", label: "Menu", icon: MenuIcon },
  ] as const;

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-ink font-bold text-white">A</div>
            <div className="min-w-0">
              <p className="truncate text-lg font-bold text-ink">{school.name}</p>
              <p className="text-xs text-slate-500">{roleLabels[user.role]} | {year.name}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select value={year.id} onChange={(event) => onYearChange(event.target.value)} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm">
              {years.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button onClick={onLogout} className="inline-flex items-center justify-center gap-2 rounded border border-slate-200 px-3 py-2 text-sm">
              <LogOut className="h-4 w-4" /> Sortir
            </button>
          </div>
        </div>
        <nav className="grid grid-cols-5 gap-2 overflow-x-auto md:flex md:flex-nowrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => onTab(tab.id)}
                className={`inline-flex min-w-0 items-center justify-center gap-2 rounded px-2 py-2 text-sm font-semibold transition sm:px-4 ${
                  activeTab === tab.id ? "bg-ink text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

function Dashboard({ data }: { data: ReturnType<typeof scopeData> }) {
  const stats = buildStats(data.students, data.parents, data.feeTypes, data.payments);
  const cards = [
    { label: "Nombre total d'élèves", value: stats.students, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre total de parents", value: stats.parents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Garçons", value: stats.boys, icon: UserRound, tone: "bg-blue-100 text-blue-700" },
    { label: "Filles", value: stats.girls, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Montant total encaissé", value: `$${stats.paid.toFixed(2)}`, icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant restant à payer", value: `$${stats.remaining.toFixed(2)}`, icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
    { label: "Nombre de classes", value: stats.classes, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
  ];

  return (
    <section>
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-slate-500">Statistiques limitées à l'année scolaire sélectionnée.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="rounded border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-1 text-2xl font-bold text-ink">{card.value}</p>
            </article>
          );
        })}
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
  const [schoolName, setSchoolName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [subscriptionPlan, setSubscriptionPlan] = useState<School["subscriptionPlan"]>("Standard");
  const totalRevenue = data.schools.reduce((sum, school) => sum + school.subscriptionAmount, 0);
  const totalStudents = data.students.length;
  const activeSchools = data.schools.filter((school) => school.status === "active").length;
  const suspendedSchools = data.schools.filter((school) => school.status === "suspended").length;

  function createSchool() {
    if (!schoolName || !adminEmail || !adminPassword) return;

    const schoolId = uid("school");
    const yearId = uid("year");
    const adminId = uid("u-school-admin");
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
      status: "active",
      subscriptionPlan,
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
    };

    updateData({
      schools: [...data.schools, school],
      schoolYears: [...data.schoolYears, year],
      users: [...data.users, adminUser],
    });
    setSchoolName("");
    setAdminEmail("");
    setAdminPassword("");
  }

  function updateSchool(schoolId: string, next: Partial<School>) {
    updateData({ schools: data.schools.map((school) => (school.id === schoolId ? { ...school, ...next } : school)) });
  }

  function updateSubscription(schoolId: string, plan: School["subscriptionPlan"]) {
    const amount = plan === "Starter" ? 29 : plan === "Premium" ? 99 : 49;
    updateSchool(schoolId, { subscriptionPlan: plan, subscriptionAmount: amount });
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded bg-ink font-bold text-white">A</div>
            <div>
              <p className="text-lg font-bold text-ink">Plateforme Acadéa</p>
              <p className="text-xs text-slate-500">{roleLabels[user.role]} | statistiques anonymisées</p>
            </div>
          </div>
          <button onClick={onLogout} className="secondary-button">
            <LogOut className="h-4 w-4" /> Sortir
          </button>
        </div>
      </header>
      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PlatformCard label="Écoles" value={data.schools.length} icon={BookOpen} />
          <PlatformCard label="Élèves totalisés" value={totalStudents} icon={GraduationCap} />
          <PlatformCard label="Revenus globaux" value={`$${totalRevenue.toFixed(2)}`} icon={Banknote} />
          <PlatformCard label="Actives / suspendues" value={`${activeSchools} / ${suspendedSchools}`} icon={BarChart3} />
        </section>

        <section className="grid gap-4 xl:grid-cols-[380px_1fr]">
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

          <div className="grid gap-3">
            {data.schools.map((school) => (
              <article key={school.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-bold text-ink">{school.name}</h2>
                    <p className="text-sm text-slate-500">
                      {school.subscriptionPlan} | ${school.subscriptionAmount}/mois | {school.status}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => updateSchool(school.id, { status: school.status === "active" ? "suspended" : "active" })}
                      className={`rounded px-3 py-2 text-xs font-semibold ${school.status === "active" ? "bg-amber-100 text-amber-700" : "bg-mint/10 text-mint"}`}
                    >
                      {school.status === "active" ? "Suspendre" : "Activer"}
                    </button>
                    {(["Starter", "Standard", "Premium"] as School["subscriptionPlan"][]).map((plan) => (
                      <button key={plan} onClick={() => updateSubscription(school.id, plan)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
                        {plan}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PlatformCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof BookOpen }) {
  return (
    <article className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded bg-mint/10 text-mint">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink">{value}</p>
    </article>
  );
}

function AccessDenied({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-4">
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

function StudentsModule({
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
  const [query, setQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [form, setForm] = useState<Student>(() => emptyStudent(school.id, year.id));
  const canEdit = user.role === "school_admin";

  const students = yearData.students.filter((student) => {
    const text = `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom}`.toLowerCase();
    return text.includes(query.toLowerCase()) && (!classFilter || student.className === classFilter);
  });

  function saveStudent() {
    const student = { ...form, schoolId: school.id, schoolYearId: year.id };
    const exists = data.students.some((item) => item.id === student.id);
    updateData({
      students: exists ? data.students.map((item) => (item.id === student.id ? student : item)) : [...data.students, student],
    });
    setForm(emptyStudent(school.id, year.id));
  }

  function removeStudent(id: string) {
    updateData({
      students: data.students.filter((student) => student.id !== id),
      payments: data.payments.filter((payment) => payment.studentId !== id),
      parents: data.parents.map((parent) => ({ ...parent, studentIds: parent.studentIds.filter((studentId) => studentId !== id) })),
    });
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">
        <SectionTitle title="Élèves" subtitle="Ajouter, modifier, supprimer, rechercher et filtrer par classe." />
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_220px]">
          <label className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher" className="min-w-0 flex-1 outline-none" />
          </label>
          <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)} className="rounded border border-slate-200 bg-white px-3 py-2">
            <option value="">Toutes les classes</option>
            {CLASSES.map((className) => (
              <option key={className} value={className}>{className}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
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
                  <td className="px-3 py-3">{student.nom} {student.postnom} {student.prenom}</td>
                  <td className="px-3 py-3">{student.sexe}</td>
                  <td className="px-3 py-3">{student.className}</td>
                  <td className="px-3 py-3">{student.phone}</td>
                  <td className="px-3 py-3">
                    {canEdit ? (
                      <div className="flex gap-1">
                        <IconButton label="Modifier" onClick={() => setForm(student)} icon={Edit3} />
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
      {canEdit && (
        <FormPanel title={form.id.startsWith("new") ? "Ajouter un élève" : "Modifier l'élève"}>
          <StudentForm form={form} setForm={setForm} onSave={saveStudent} onReset={() => setForm(emptyStudent(school.id, year.id))} />
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
  updateData: (next: Partial<AppData>) => void;
}) {
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [studentId, setStudentId] = useState(yearData.students[0]?.id ?? "");
  const [feeTypeId, setFeeTypeId] = useState(yearData.feeTypes[0]?.id ?? "");
  const [amount, setAmount] = useState("100");
  const canPay = user.role !== "parent";

  const rows = yearData.students
    .map((student) => ({ student, balance: getStudentBalance(student.id, yearData.feeTypes, yearData.payments) }))
    .filter((row) => filter === "all" || (filter === "paid" ? row.balance.remaining === 0 : row.balance.remaining > 0));

  function savePayment() {
    if (!studentId || !feeTypeId) return;
    const payment: Payment = {
      id: uid("pay"),
      schoolId: school.id,
      schoolYearId: year.id,
      studentId,
      feeTypeId,
      amount: Number(amount),
      paidAt: new Date().toISOString().slice(0, 10),
      cashierName: user.name,
    };
    updateData({ payments: [...data.payments, payment] });
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en dollar américain." />
        <div className="mb-3 flex flex-wrap gap-2">
          {(["all", "paid", "due"] as PaymentFilter[]).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={`rounded px-3 py-2 text-sm font-semibold ${filter === item ? "bg-ink text-white" : "bg-white text-slate-700"}`}
            >
              {item === "all" ? "Tous" : item === "paid" ? "Élèves en ordre" : "Élèves non en ordre"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ student, balance }) => (
            <article key={student.id} className="rounded border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-ink">{student.nom} {student.prenom}</h3>
                  <p className="text-sm text-slate-500">{student.matricule} | {student.className}</p>
                </div>
                <span className={`rounded px-2 py-1 text-xs font-semibold ${balance.remaining === 0 ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
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
      <div className="space-y-4">
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
        <FormPanel title="Historique des paiements">
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {yearData.payments.map((payment) => {
              const student = yearData.students.find((item) => item.id === payment.studentId);
              const fee = yearData.feeTypes.find((item) => item.id === payment.feeTypeId);
              if (!student || !fee) return null;
              return (
                <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{student.nom} {student.prenom}</p>
                    <button onClick={() => generateReceiptPdf(payment, student, fee, school)} className="rounded bg-slate-100 p-2" title="Télécharger le reçu PDF">
                      <Download className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-slate-500">{fee.name} | ${payment.amount} | {payment.paidAt}</p>
                </div>
              );
            })}
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
    const message: Message = {
      id: uid("msg"),
      schoolId: school.id,
      schoolYearId: year.id,
      senderId: user.id,
      recipientParentId,
      subject,
      body,
      createdAt: new Date().toISOString(),
    };
    updateData({ messages: [message, ...data.messages] });
    setSubject("");
    setBody("");
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[380px_1fr]">
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
        <div className="space-y-3">
          {yearData.messages.map((message) => {
            const recipient = message.recipientParentId === "all" ? "Tous les parents" : yearData.parents.find((parent) => parent.id === message.recipientParentId)?.fullName;
            return (
              <article key={message.id} className="rounded border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-bold text-ink">{message.subject}</h3>
                    <p className="text-xs text-slate-500">{recipient} | {new Date(message.createdAt).toLocaleString("fr-FR")}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-700">{message.body}</p>
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
  updateData,
}: {
  user: AppUser;
  data: AppData;
  yearData: ReturnType<typeof scopeData>;
  school: School;
  years: SchoolYear[];
  selectedYear: SchoolYear;
  updateData: (next: Partial<AppData>) => void;
}) {
  const [schoolForm, setSchoolForm] = useState(school);
  const [parentForm, setParentForm] = useState<ParentProfile>(() => emptyParent(school.id, selectedYear.id));
  const [feeName, setFeeName] = useState<FeeKind>("Minerval");
  const [feeAmount, setFeeAmount] = useState("100");
  const canAdmin = user.role === "school_admin";

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
  }

  function archiveYear(yearId: string) {
    updateData({ schoolYears: data.schoolYears.map((year) => (year.id === yearId ? { ...year, status: "archived" } : year)) });
  }

  function saveParent() {
    const userId = uid("u-parent");
    const parent = { ...parentForm, id: parentForm.id.startsWith("new") ? uid("parent") : parentForm.id, schoolId: school.id, schoolYearId: selectedYear.id, userId };
    const parentUser: AppUser = {
      id: userId,
      name: parent.fullName,
      email: parent.email,
      role: "parent",
      schoolId: school.id,
      parentId: parent.id,
      studentIds: parent.studentIds,
    };
    updateData({ parents: [...data.parents, parent], users: [...data.users, parentUser] });
    setParentForm(emptyParent(school.id, selectedYear.id));
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
    <section className="grid gap-4 xl:grid-cols-2">
      <FormPanel title="Paramètres école">
        <Field label="Logo URL" value={schoolForm.logoUrl ?? ""} onChange={(value) => setSchoolForm({ ...schoolForm, logoUrl: value })} disabled={!canAdmin} />
        <Field label="Nom de l'école" value={schoolForm.name} onChange={(value) => setSchoolForm({ ...schoolForm, name: value })} disabled={!canAdmin} />
        <Field label="Adresse" value={schoolForm.address} onChange={(value) => setSchoolForm({ ...schoolForm, address: value })} disabled={!canAdmin} />
        <Field label="Téléphone" value={schoolForm.phone} onChange={(value) => setSchoolForm({ ...schoolForm, phone: value })} disabled={!canAdmin} />
        <Field label="Email" value={schoolForm.email} onChange={(value) => setSchoolForm({ ...schoolForm, email: value })} disabled={!canAdmin} />
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Année scolaire active
          <select value={schoolForm.activeSchoolYearId} onChange={(event) => setSchoolForm({ ...schoolForm, activeSchoolYearId: event.target.value })} disabled={!canAdmin} className="input">
            {years.map((year) => (
              <option key={year.id} value={year.id}>{year.name}</option>
            ))}
          </select>
        </label>
        {canAdmin && <button onClick={saveSchool} className="primary-button"><Settings className="h-4 w-4" /> Enregistrer</button>}
      </FormPanel>

      <FormPanel title="Années scolaires">
        <div className="space-y-2">
          {years.map((year) => (
            <div key={year.id} className="flex flex-col gap-2 rounded border border-slate-100 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-ink">{year.name}</p>
                <p className="text-xs text-slate-500">{year.status}</p>
              </div>
              {canAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => activateYear(year.id)} className="rounded bg-mint px-3 py-2 text-xs font-semibold text-white">Activer</button>
                  <button onClick={() => archiveYear(year.id)} className="rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">Archiver</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </FormPanel>

      {canAdmin && (
        <FormPanel title="Parents et comptes de connexion">
          <Field label="Nom complet" value={parentForm.fullName} onChange={(value) => setParentForm({ ...parentForm, fullName: value })} />
          <Field label="Téléphone" value={parentForm.phone} onChange={(value) => setParentForm({ ...parentForm, phone: value })} />
          <Field label="Email" value={parentForm.email} onChange={(value) => setParentForm({ ...parentForm, email: value })} />
          <Field label="Adresse" value={parentForm.address} onChange={(value) => setParentForm({ ...parentForm, address: value })} />
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Associer les élèves
            <select
              multiple
              value={parentForm.studentIds}
              onChange={(event) => setParentForm({ ...parentForm, studentIds: Array.from(event.target.selectedOptions).map((option) => option.value) })}
              className="input min-h-32"
            >
              {yearData.students.map((student) => (
                <option key={student.id} value={student.id}>{student.nom} {student.prenom}</option>
              ))}
            </select>
          </label>
          <button onClick={saveParent} className="primary-button"><UsersRound className="h-4 w-4" /> Créer le parent</button>
        </FormPanel>
      )}

      {canAdmin && (
        <FormPanel title="Types de frais">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
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
              <div key={fee.id} className="flex justify-between rounded bg-slate-50 p-3 text-sm">
                <span>{fee.name}</span>
                <strong>${fee.amount}</strong>
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
  onSave,
  onReset,
}: {
  form: Student;
  setForm: (student: Student) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <Field label="Matricule" value={form.matricule} onChange={(value) => setForm({ ...form, matricule: value })} />
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
        Classe
        <select value={form.className} onChange={(event) => setForm({ ...form, className: event.target.value as SchoolClass })} className="input">
          {CLASSES.map((className) => (
            <option key={className} value={className}>{className}</option>
          ))}
        </select>
      </label>
      <Field label="Photo URL" value={form.photoUrl ?? ""} onChange={(value) => setForm({ ...form, photoUrl: value })} />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={onReset} className="secondary-button">Réinitialiser</button>
        <button onClick={onSave} className="primary-button"><CheckCircle2 className="h-4 w-4" /> Sauver</button>
      </div>
    </>
  );
}

function emptyStudent(schoolId: string, schoolYearId: string): Student {
  return {
    id: `new-${crypto.randomUUID()}`,
    schoolId,
    schoolYearId,
    matricule: "",
    nom: "",
    postnom: "",
    prenom: "",
    sexe: "M",
    birthDate: "",
    address: "",
    phone: "",
    className: "1ère Primaire",
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
  };
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function FormPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-bold text-ink">{title}</h2>
      <div className="grid gap-3">{children}</div>
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
    <label className="grid gap-1 text-sm font-medium text-slate-700">
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
    <div className="rounded bg-slate-50 p-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-bold text-ink">{value}</p>
    </div>
  );
}
