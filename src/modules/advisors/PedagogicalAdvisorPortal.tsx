// Lot 10 : module du Conseiller pédagogique, construit à partir du module de la Direction des études.
// Gardé en lecture : Dashboard (compteurs), Enseignants (affectations), Élèves (sans argent), Horaires.
// Ajouté : cotes en lecture, fiches de visite de classe (ses fiches).
// Retiré : création d'enseignant, publication des cotes, périodes, écriture du calendrier, demandes d'indisponibilité.
// AUCUN accès à l'argent de l'école. Rechargement par la flèche ronde de l'en-tête (pas de bouton « Actualiser »).
import { useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, BookOpenCheck, CalendarDays, Clock3, GraduationCap, LogOut, MessageSquare, UsersRound } from "lucide-react";
import { AppVersion } from "../../components/ui/AppVersion";
import { AdminDrawer, DashboardCard } from "../../components/ui";
import { PushNotificationSettings } from "../../components/notifications/PushNotificationPrompt";
import { MobileBottomNavigation } from "../../components/layout/MobileBottomNavigation";
import { OwnPayrollEntry } from "../../components/personnel/OwnPayrollEntry";
import { StaffChildrenEntry } from "../../components/personnel/StaffChildrenContent";
import { SchoolYearArchiveDrawer } from "../../components/archive/SchoolYearArchiveDrawer";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { FeeAllocationEntry } from "../menu/FeeAllocationDrawer";
import { LibraryDrawer } from "../library/LibraryDrawer";
import { MessagesModule } from "../messages/MessagesModule";
import { PublishedTimetableReadOnly } from "../studies/PublishedTimetableReadOnly";
import { AdvisorCalendarContent, AdvisorGradesContent, AdvisorStudentsContent, AdvisorTeachersContent, sectionsNote } from "./AdvisorContents";
import { ClassVisitsContent } from "./ClassVisitsContent";
import { useAdvisorData, type AdvisorOverview } from "./advisorService";
import { pedagogicalAdvisorTabs, type PedagogicalAdvisorTab } from "./advisorNavigation";

type MenuDrawer = "students" | "grades" | "library" | "messages" | "calendar" | "school-years" | null;
const menuButton = "flex items-center gap-3 rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600";

export function PedagogicalAdvisorPortal({ user, school, year, appData, updateData, createId, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; appData: AppData; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void; createId: (prefix: string) => string; renderHeader: () => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<PedagogicalAdvisorTab>("dashboard");
  const [drawer, setDrawer] = useState<MenuDrawer>(null);
  const scope = { uid: user.id, schoolId: school.id, schoolYearId: year.id };
  const overview = useAdvisorData<AdvisorOverview>("advisor-overview", scope);
  const metrics = overview.value?.metrics;
  const cards = [
    ["Enseignants", metrics?.teachers, UsersRound, "bg-blue-50 text-blue-700"],
    ["Matières utilisées", metrics?.subjects, GraduationCap, "bg-violet-50 text-violet-700"],
    ["Affectations", metrics?.assignments, BookOpenCheck, "bg-emerald-50 text-emerald-700"],
    ["Charge totale", metrics?.workload, Clock3, "bg-amber-50 text-amber-700"],
    ["Sans affectation", metrics?.teachersWithoutAssignment, AlertTriangle, "bg-red-50 text-red-700"],
  ] as const;
  const close = () => setDrawer(null);
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#f6f8fb]">{renderEnvironmentBanner()}{renderHeader()}<main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
    {activeTab === "dashboard" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Conseiller pédagogique</h1><p className="mt-1 break-words text-sm text-slate-600">{school.name} · Année scolaire {year.name} · {sectionsNote(overview.value?.sections)}</p></div>
      {overview.error ? null : !overview.value && overview.loading && <p className="text-sm text-slate-500">Chargement…</p>}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value, Icon, tone]) => <DashboardCard key={label} title={label} value={value ?? "—"} icon={Icon} tone={tone} />)}</div></section>}
    {activeTab === "teachers" && <AdvisorTeachersContent overview={overview.value} loading={overview.loading} error={overview.error} onRetry={overview.retry} />}
    {activeTab === "visits" && <section className="grid gap-3"><h1 className="text-2xl font-bold text-ink">Fiches de visite</h1><ClassVisitsContent scope={scope} overview={overview.value} canWrite readOnlyYear={year.status === "archived"} /></section>}
    {activeTab === "schedules" && <section className="grid gap-3"><h1 className="text-2xl font-bold text-ink">Horaires</h1><p className="text-sm text-slate-600">Horaire publié, en lecture seule.</p><PublishedTimetableReadOnly user={user} school={school} year={year} /></section>}
    {activeTab === "menu" && <section className="grid gap-3">
      <button type="button" className={menuButton} onClick={() => setDrawer("students")}><GraduationCap className="h-5 w-5 shrink-0"/><strong>Élèves</strong></button>
      <button type="button" className={menuButton} onClick={() => setDrawer("grades")}><BookOpenCheck className="h-5 w-5 shrink-0"/><strong>Cotes (lecture)</strong></button>
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
  {drawer === "students" && <AdminDrawer title="Élèves" closeLabel="Fermer les élèves" onClose={close}><AdvisorStudentsContent scope={scope} /></AdminDrawer>}
  {drawer === "grades" && <AdminDrawer title="Cotes (lecture)" closeLabel="Fermer les cotes" onClose={close}><AdvisorGradesContent scope={scope} /></AdminDrawer>}
  {drawer === "library" && <LibraryDrawer audience="study_director" onClose={close} />}
  {drawer === "messages" && <AdminDrawer title="Message" closeLabel="Fermer la messagerie" onClose={close}><MessagesModule user={user} data={appData} yearData={{ parents: [], students: [], messages: appData.messages }} school={school} year={year} updateData={updateData} createId={createId} /></AdminDrawer>}
  {drawer === "calendar" && <AdminDrawer title="Calendrier scolaire" closeLabel="Fermer le calendrier" onClose={close}><AdvisorCalendarContent user={user} school={school} year={year} /></AdminDrawer>}
  {drawer === "school-years" && <SchoolYearArchiveDrawer schoolId={school.id} activeSchoolYearId={school.activeSchoolYearId} onClose={close} />}
  <MobileBottomNavigation ariaLabel="Navigation Conseiller pédagogique" items={pedagogicalAdvisorTabs} activeId={activeTab} onSelect={setActiveTab} maxWidthClass="max-w-3xl" />
  </div>;
}
