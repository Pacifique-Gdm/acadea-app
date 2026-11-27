// Lot 11 : module du Conseiller d'orientation, construit à partir du module de la Direction des études.
// Remplacé : Dashboard (élèves suivis, notes de suivi du mois). Gardé en lecture : Élèves (fiche sans argent).
// Ajouté : notes de suivi confidentielles, résultats en lecture.
// Retiré : Enseignants, Horaires, création d'enseignant, publication des cotes, périodes, écriture du calendrier,
// demandes d'indisponibilité. AUCUN accès à l'argent. Rechargement par la flèche ronde de l'en-tête.
import { useMemo, useState, type ReactNode } from "react";
import { BellRing, BookOpen, CalendarDays, GraduationCap, LogOut, MessageSquare, NotebookPen, TrendingDown, UsersRound } from "lucide-react";
import { AppVersion } from "../../components/ui/AppVersion";
import { AdminDrawer, DashboardCard, ErrorNotice } from "../../components/ui";
import { PushNotificationSettings } from "../../components/notifications/PushNotificationPrompt";
import { MobileBottomNavigation } from "../../components/layout/MobileBottomNavigation";
import { OwnPayrollEntry } from "../../components/personnel/OwnPayrollEntry";
import { StaffChildrenEntry } from "../../components/personnel/StaffChildrenContent";
import { SchoolYearArchiveDrawer } from "../../components/archive/SchoolYearArchiveDrawer";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { FeeAllocationEntry } from "../menu/FeeAllocationDrawer";
import { LibraryDrawer } from "../library/LibraryDrawer";
import { MessagesModule } from "../messages/MessagesModule";
import { localDateKey } from "../studies/prefectDashboard";
import { AdvisorCalendarContent, AdvisorStudentsContent, sectionsNote } from "./AdvisorContents";
import { OrientationNotesContent, orientationDashboard, orientationPriorities, ORIENTATION_DIFFICULTY_THRESHOLD } from "./OrientationNotesContent";
import { DashboardCardButton } from "./DashboardCardButton";
import { filterAdvisorStudents, useAdvisorData, type AdvisorResult, type AdvisorStudent, type OrientationNote } from "./advisorService";
import { orientationAdvisorTabs, type OrientationAdvisorTab } from "./advisorNavigation";

type MenuDrawer = "library" | "messages" | "calendar" | "school-years" | null;
const menuButton = "flex items-center gap-3 rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600";
const card = "rounded border border-slate-200 bg-white p-3 shadow-sm";

function AdvisorResultsContent({ scope }: { scope: { uid: string; schoolId: string; schoolYearId: string } }) {
  const { value, loading, error, retry } = useAdvisorData<{ sections: string[]; results: AdvisorResult[] }>("advisor-results", scope);
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const rows = value?.results ?? [];
    const filtered = filterAdvisorStudents(rows.map((row) => ({ id: row.studentId, name: row.studentName, matricule: "", className: row.className, section: row.section, gender: "", status: "" })), search);
    const ids = new Set(filtered.map((row) => row.id));
    return rows.filter((row) => ids.has(row.studentId));
  }, [value, search]);
  return <div className="grid gap-3">
    <p className="text-sm text-slate-600">Résultats en lecture seule (dernière période complète de la classe) · {sectionsNote(value?.sections)}</p>
    <input className="input" placeholder="Rechercher un élève ou une classe" aria-label="Rechercher un résultat" value={search} onChange={(event) => setSearch(event.target.value)} />
    <ErrorNotice error={error} fallback="Résultats indisponibles." onRetry={retry} />
    {!value && loading && <p className="text-sm text-slate-500">Chargement des résultats…</p>}
    {value && shown.length === 0 && <p className={card}>Aucun résultat.</p>}
    {shown.slice(0, 300).map((row) => <article key={`${row.className}-${row.studentId}`} className={card}>
      <p className="font-semibold text-ink">{row.studentName} <span className="text-xs font-normal text-slate-500">· {row.className}</span></p>
      <p className="text-sm text-slate-600">{row.percentage === null ? "Pas encore de résultat complet" : `${row.percentage} % · ${row.rank}${row.rank === 1 ? "er" : "e"} sur ${row.evaluated} · ${row.slotLabel}`}</p>
    </article>)}
    {shown.length > 300 && <p className="text-xs text-slate-500">Seuls les 300 premiers résultats sont affichés : précisez la recherche.</p>}
  </div>;
}

export function OrientationAdvisorPortal({ user, school, year, appData, updateData, createId, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; appData: AppData; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void; createId: (prefix: string) => string; renderHeader: () => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<OrientationAdvisorTab>("dashboard");
  const [drawer, setDrawer] = useState<MenuDrawer>(null);
  const scope = { uid: user.id, schoolId: school.id, schoolYearId: year.id };
  const notes = useAdvisorData<{ notes: OrientationNote[] }>("orientation-notes-list", scope, activeTab === "dashboard");
  const figures = notes.value ? orientationDashboard(notes.value.notes, localDateKey()) : undefined;
  // Lot H : 3 cartes de plus (mêmes lectures que les onglets « Élèves » et « Résultats »).
  const students = useAdvisorData<{ students: AdvisorStudent[] }>("advisor-students", scope, activeTab === "dashboard");
  const results = useAdvisorData<{ sections: string[]; results: AdvisorResult[] }>("advisor-results", scope, activeTab === "dashboard");
  const priorities = orientationPriorities(students.value?.students, results.value?.results, notes.value?.notes);
  const close = () => setDrawer(null);
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#f6f8fb]">{renderEnvironmentBanner()}{renderHeader()}<main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
    {activeTab === "dashboard" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Conseiller d'orientation</h1><p className="mt-1 break-words text-sm text-slate-600">{school.name} · Année scolaire {year.name}</p></div>
      <ErrorNotice error={notes.error} fallback="Notes de suivi indisponibles." onRetry={notes.retry} />
      <ErrorNotice error={students.error} fallback="Élèves indisponibles." onRetry={students.retry} />
      <ErrorNotice error={results.error} fallback="Résultats indisponibles." onRetry={results.retry} />
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DashboardCard title="Élèves suivis" value={figures?.followedStudents ?? "—"} icon={UsersRound} tone="bg-blue-50 text-blue-700" />
        <DashboardCard title="Notes de suivi du mois" value={figures?.notesThisMonth ?? "—"} icon={NotebookPen} tone="bg-amber-50 text-amber-700" />
        <DashboardCard title="Notes de suivi (année)" value={figures?.totalNotes ?? "—"} icon={BookOpen} tone="bg-emerald-50 text-emerald-700" />
        <DashboardCardButton title="Élèves de mes sections" value={priorities.students ?? "—"} icon={GraduationCap} tone="bg-violet-50 text-violet-700" onClick={() => setActiveTab("students")} />
        <DashboardCardButton title="Élèves en difficulté" value={priorities.struggling ?? "—"} icon={TrendingDown} tone="bg-red-50 text-red-700" onClick={() => setActiveTab("results")}><p className="text-xs text-slate-500">moyenne &lt; {ORIENTATION_DIFFICULTY_THRESHOLD} % · dernière période complète</p></DashboardCardButton>
        <DashboardCardButton title="En difficulté, sans suivi" value={priorities.strugglingWithoutNote ?? "—"} icon={BellRing} tone="bg-orange-50 text-orange-700" onClick={() => setActiveTab("notes")}><p className="text-xs text-slate-500">aucune note de suivi cette année</p></DashboardCardButton>
      </div></section>}
    {activeTab === "students" && <section className="grid gap-3"><h1 className="text-2xl font-bold text-ink">Élèves</h1><AdvisorStudentsContent scope={scope} /></section>}
    {activeTab === "notes" && <section className="grid gap-3"><h1 className="text-2xl font-bold text-ink">Notes de suivi</h1><OrientationNotesContent scope={scope} canWrite readOnlyYear={year.status === "archived"} /></section>}
    {activeTab === "results" && <section className="grid gap-3"><h1 className="text-2xl font-bold text-ink">Résultats</h1><AdvisorResultsContent scope={scope} /></section>}
    {activeTab === "menu" && <section className="grid gap-3">
      <OwnPayrollEntry user={user} school={school} />
      <StaffChildrenEntry school={school} />
      <FeeAllocationEntry user={user} schools={[school]} />
      <PushNotificationSettings user={user} />
      <button type="button" className={menuButton} onClick={() => setDrawer("library")}><BookOpen className="h-5 w-5 shrink-0"/><strong>Bibliothèque</strong></button>
      <button type="button" className={menuButton} onClick={() => setDrawer("messages")}><MessageSquare className="h-5 w-5 shrink-0"/><strong>Message</strong></button>
      <button type="button" className={menuButton} onClick={() => setDrawer("calendar")}><CalendarDays className="h-5 w-5 shrink-0"/><strong>Calendrier scolaire</strong></button>
      <button type="button" className={menuButton + " w-full"} onClick={() => setDrawer("school-years")}><CalendarDays className="h-5 w-5 shrink-0"/><strong>Année scolaire</strong></button>
      <button type="button" onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"><LogOut className="h-4 w-4"/> Déconnexion</button>
      <AppVersion />
    </section>}
  </main>
  {drawer === "library" && <LibraryDrawer audience="study_director" onClose={close} />}
  {drawer === "messages" && <AdminDrawer title="Message" closeLabel="Fermer la messagerie" onClose={close}><MessagesModule user={user} data={appData} yearData={{ parents: [], students: [], messages: appData.messages }} school={school} year={year} updateData={updateData} createId={createId} /></AdminDrawer>}
  {drawer === "calendar" && <AdminDrawer title="Calendrier scolaire" closeLabel="Fermer le calendrier" onClose={close}><AdvisorCalendarContent user={user} school={school} year={year} /></AdminDrawer>}
  {drawer === "school-years" && <SchoolYearArchiveDrawer schoolId={school.id} activeSchoolYearId={school.activeSchoolYearId} onClose={close} />}
  <MobileBottomNavigation ariaLabel="Navigation Conseiller d'orientation" items={orientationAdvisorTabs} activeId={activeTab} onSelect={setActiveTab} maxWidthClass="max-w-3xl" />
  </div>;
}
