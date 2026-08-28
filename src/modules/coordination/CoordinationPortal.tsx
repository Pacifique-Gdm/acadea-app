import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, getDocs, onSnapshot, query, where, type Firestore } from "@firebase/firestore";
import { Banknote, Bell, Building2, GraduationCap, LayoutDashboard, Menu, MessageSquare, RefreshCw } from "lucide-react";
import { db } from "../../firebase";
import type { AppUser, Coordination, CoordinationSchool, School, SubCoordination, SubCoordinationSchool } from "../../types";
import { AccessDenied } from "../../components/auth/AccessDenied";
import { MobileBottomNavigation } from "../../components/layout/MobileBottomNavigation";
import { CoordinationDashboard } from "./CoordinationDashboard";
import { CoordinationMessage } from "./CoordinationMessage";
import { CoordinationMenu } from "./CoordinationMenu";
import { CoordinationStudents } from "./CoordinationStudents";
import { CoordinationControl } from "./CoordinationControl";
import { loadCoordinationDashboardReadModel, type CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import { useCoordinationInbox } from "../../hooks/useCoordinationInbox";
import { MessagingDrawerShell } from "../../components/messages/MessagingDrawerShell";
import { MessageDrawerContent } from "../../components/messages/MessageDrawerContent";

type CoordinationTab = "dashboard" | "students" | "control" | "messages" | "menu";
const emptySupervisionModel: CoordinationDashboardReadModel = { students: [], feeTypes: [], payments: [], expenses: [], personnel: [], schoolYears: [] };

export function CoordinationPortal({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const [tab, setTab] = useState<CoordinationTab>("dashboard");
  const [coordination, setCoordination] = useState<Coordination | null>(null);
  const [subCoordination, setSubCoordination] = useState<SubCoordination | null>(null);
  const [relations, setRelations] = useState<Array<CoordinationSchool | SubCoordinationSchool>>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [supervisionModel, setSupervisionModel] = useState<CoordinationDashboardReadModel>(emptySupervisionModel);
  const [supervisionLoading, setSupervisionLoading] = useState(false);
  const [supervisionError, setSupervisionError] = useState("");
  const [loadedSupervisionScope, setLoadedSupervisionScope] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!["coordination_admin", "sub_coordination_admin"].includes(user.role) || !user.coordinationId || (user.role === "sub_coordination_admin" && !user.subCoordinationId) || !db) return undefined;
    const database = db as unknown as Firestore;
    const coordinationId = user.coordinationId;
    const stopCoordination = onSnapshot(doc(database, "coordinations", coordinationId), (snapshot) => {
      if (!snapshot.exists() || snapshot.data().status !== "active") { setError("Cette Coordination est inactive ou introuvable."); setCoordination(null); return; }
      setCoordination({ id: snapshot.id, ...snapshot.data() } as Coordination); setError("");
    }, () => setError("Impossible de charger la Coordination."));
    const relationCollection = user.role === "sub_coordination_admin" ? "subCoordinationSchools" : "coordinationSchools";
    const relationQuery = user.role === "sub_coordination_admin"
      ? query(collection(database, relationCollection), where("subCoordinationId", "==", user.subCoordinationId!), where("coordinationId", "==", coordinationId), where("active", "==", true))
      : query(collection(database, relationCollection), where("coordinationId", "==", coordinationId), where("active", "==", true));
    const stopRelations = onSnapshot(relationQuery, async (snapshot) => {
      const nextRelations = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CoordinationSchool | SubCoordinationSchool));
      setRelations(nextRelations);
      try {
        const schoolIds = [...new Set(nextRelations.map((relation) => relation.schoolId))];
        const loaded: School[] = [];
        for (let index = 0; index < schoolIds.length; index += 30) {
          const schoolsSnapshot = await getDocs(query(collection(database, "schools"), where(documentId(), "in", schoolIds.slice(index, index + 30))));
          schoolsSnapshot.docs.forEach((item) => loaded.push({ id: item.id, ...item.data() } as School));
        }
        setSchools(loaded);
        setSelectedSchoolId((current) => current && !nextRelations.some((item) => item.schoolId === current) ? "" : current);
      } catch { setError("Impossible de charger les écoles rattachées."); }
    }, () => setError("Impossible de charger les écoles rattachées."));
    const stopSubCoordination = user.role === "sub_coordination_admin" && user.subCoordinationId
      ? onSnapshot(doc(database, "subCoordinations", user.subCoordinationId), (snapshot) => {
        if (!snapshot.exists() || snapshot.data().active !== true || snapshot.data().status !== "active") { setSubCoordination(null); setError("Cette Sous-coordination est inactive ou introuvable."); return; }
        setSubCoordination({ id: snapshot.id, ...snapshot.data() } as SubCoordination);
      }, () => setError("Impossible de charger la Sous-coordination."))
      : undefined;
    return () => { stopCoordination(); stopRelations(); stopSubCoordination?.(); };
  }, [user.coordinationId, user.role, user.subCoordinationId]);

  const activeSchools = useMemo(() => schools.filter((school) => school.status === "active" && relations.some((relation) => relation.schoolId === school.id)), [relations, schools]);
  const supervisionScope = useMemo(() => activeSchools.map((school) => school.id).sort().join("|"), [activeSchools]);
  const inbox = useCoordinationInbox(user, activeSchools, refreshToken);

  const loadSupervision = useCallback(async () => {
    if (!supervisionScope) { setSupervisionModel(emptySupervisionModel); setLoadedSupervisionScope(""); return; }
    setSupervisionLoading(true); setSupervisionError("");
    try {
      const model = await loadCoordinationDashboardReadModel(activeSchools.map((school) => school.id));
      setSupervisionModel(model); setLoadedSupervisionScope(supervisionScope);
    } catch {
      setSupervisionError("Impossible de charger les données de supervision.");
      throw new Error("Chargement de la supervision impossible.");
    } finally { setSupervisionLoading(false); }
  }, [activeSchools, supervisionScope]);

  useEffect(() => {
    if (!["dashboard", "students", "control"].includes(tab) || !supervisionScope || loadedSupervisionScope === supervisionScope) return;
    void loadSupervision().catch(() => undefined);
  }, [loadSupervision, loadedSupervisionScope, supervisionScope, tab]);

  async function refreshCoordination() {
    if (refreshing) return;
    setRefreshing(true); setRefreshError(""); setRefreshToken((value) => value + 1);
    try {
      if (["dashboard", "students", "control"].includes(tab)) await loadSupervision();
    } catch { setRefreshError("Actualisation impossible. Veuillez réessayer."); }
    finally { setRefreshing(false); }
  }

  function openNotifications() {
    setNotificationsOpen(true);
    void inbox.markAllRead().catch(() => setRefreshError("Impossible de marquer les notifications comme lues."));
  }

  if (!["coordination_admin", "sub_coordination_admin"].includes(user.role) || !user.coordinationId || (user.role === "sub_coordination_admin" && !user.subCoordinationId)) return <AccessDenied onLogout={onLogout} />;
  const tabs = [
    { id: "dashboard" as const, label: "Dashboard", icon: LayoutDashboard },
    { id: "students" as const, label: "Élèves", icon: GraduationCap },
    { id: "control" as const, label: "Contrôle", icon: Banknote },
    { id: "messages" as const, label: "Message", icon: MessageSquare },
    { id: "menu" as const, label: "Menu", icon: Menu },
  ];

  return <main className="min-h-screen overflow-x-clip bg-[#F5F7FB] pb-24 text-ink">
    <header className="sticky top-0 z-20 w-full border-b border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100">{coordination?.logoUrl ? <img src={coordination.logoUrl} alt={`Logo ${coordination.name}`} className="h-full w-full object-contain"/> : <Building2 className="h-6 w-6 text-blue-700"/>}</div>
          <div className="min-w-0"><h1 className="truncate text-lg font-bold">{coordination?.name ?? "Coordination"}</h1><p className="text-xs text-slate-500">Supervision multi-écoles · lecture sécurisée</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => void refreshCoordination()} disabled={refreshing} className="inline-flex h-9 w-9 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50" aria-label="Actualiser" title="Actualiser"><RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}/></button>
          <button type="button" onClick={openNotifications} disabled={activeSchools.length === 0} className="relative inline-flex h-9 w-9 items-center justify-center rounded text-slate-500 transition hover:bg-slate-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50" aria-label="Boîte à Messagerie" title="Boîte à Messagerie"><Bell className="h-4 w-4"/>{inbox.unreadCount > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-bold text-white">{inbox.unreadCount}</span>}</button>
        </div>
      </div>
      {(refreshError || inbox.error) && <p role="alert" className="mx-auto mt-2 max-w-6xl text-xs font-semibold text-red-600">{refreshError || inbox.error}</p>}
    </header>
    <section className="mx-auto grid max-w-6xl gap-4 px-4 py-5">
      {tab !== "dashboard" && <div className="rounded border border-blue-100 bg-blue-50 p-4 text-sm"><b>École</b><select className="input mt-2 w-full" aria-label="Filtrer par école" value={selectedSchoolId} onChange={(event) => setSelectedSchoolId(event.target.value)}><option value="">{user.role === "sub_coordination_admin" ? "Toutes mes écoles" : "Toutes les écoles"} ({activeSchools.length})</option>{activeSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></div>}
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {tab === "dashboard" && coordination && <CoordinationDashboard coordination={coordination} schools={activeSchools} selectedSchoolId={selectedSchoolId} onSchoolChange={setSelectedSchoolId} user={user} model={supervisionModel} loading={supervisionLoading} loadError={supervisionError} />}
      {tab === "students" && coordination && (
        <CoordinationStudents user={user} coordination={coordination} schools={activeSchools} selectedSchoolId={selectedSchoolId} model={supervisionModel} loading={supervisionLoading} loadError={supervisionError}/>
      )}
      {tab === "control" && coordination && (
        <CoordinationControl user={user} coordination={coordination} schools={activeSchools} selectedSchoolId={selectedSchoolId} model={supervisionModel} loading={supervisionLoading} loadError={supervisionError}/>
      )}
      {tab === "messages" && <CoordinationMessage schools={activeSchools} schoolId={selectedSchoolId} refreshToken={refreshToken}/>}
      {tab === "menu" && coordination && (
        <CoordinationMenu
          coordination={coordination}
          schools={activeSchools}
          selectedSchoolId={selectedSchoolId}
          principalCoordinatorName={user.name}
          user={user}
          subCoordination={subCoordination}
          onLogout={onLogout}
          refreshToken={refreshToken}
        />
      )}
    </section>
    {notificationsOpen && activeSchools[0] && <MessagingDrawerShell onClose={() => setNotificationsOpen(false)}><MessageDrawerContent user={user} data={{ users: [] }} yearData={{ auditLogs: [], messages: inbox.messages, notifications: inbox.notifications, parents: [], students: [], users: [] }} school={activeSchools[0]} notifications={inbox.notifications} realtimeMessages={inbox.messages} roleLabels={{ super_admin: "Super Administrateur", coordination_admin: "Coordinateur", sub_coordination_admin: "Sous-coordinateur", school_admin: "Administrateur", cashier: "Caissier", discipline_director: "Directeur de Discipline", study_director: "Directeur des études", secretary: "Secrétaire", teacher: "Enseignant", parent: "Parent" }}/></MessagingDrawerShell>}
    <MobileBottomNavigation ariaLabel="Navigation Coordination" items={tabs} activeId={tab} onSelect={setTab} maxWidthClass="max-w-4xl" />
  </main>;
}
