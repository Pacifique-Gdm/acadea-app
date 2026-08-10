import { useState } from "react";
import { CalendarClock, History, LogOut, UserRoundCheck } from "lucide-react";
import type { ReactNode } from "react";
import { AdminDrawer } from "../../components/ui";
import { StudyDirectorBottomNavigation } from "../../components/layout/StudyDirectorBottomNavigation";
import type { StudyDirectorTab } from "../../components/layout/studyDirectorNavigation";
import type { AppUser, School, SchoolYear } from "../../types";
import { studyDashboardMetrics } from "./studyAssignments";
import { phase3DashboardMetrics } from "./studySchedule";
import { StudyTeachersModule } from "./StudyTeachersModule";
import { StudySchedulesModule } from "./StudySchedulesModule";
import { StudyPeriodsModule } from "./StudyPeriodsModule";
import { StudyAiAssistant } from "./StudyAiAssistant";
import { StudyAvailabilityRequestsDrawer } from "./StudyAvailabilityRequestsDrawer";
import { StudyScheduleHistory } from "./StudyScheduleHistory";
import { useStudyData } from "./useStudyData";

type MenuDrawer = "requests" | "history" | "periods" | null;
const menuButton = "rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600";

export function StudyDirectorPortal({ user, school, year, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; renderHeader: () => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<StudyDirectorTab>("dashboard");
  const [drawer, setDrawer] = useState<MenuDrawer>(null);
  const data = useStudyData(user, school.id, year.id);
  const metrics = studyDashboardMetrics(data.teachers, data.assignments);
  const scheduleMetrics = phase3DashboardMetrics(data.availabilities, data.periods);
  const dashboardCards = [["Enseignants", metrics.teachers], ["Matières utilisées", metrics.subjects], ["Affectations", metrics.assignments], ["Charge totale", metrics.workload], ["Sans affectation", metrics.teachersWithoutAssignment], ["Avec indisponibilités", scheduleMetrics.teachersWithUnavailability], ["Avec jours de repos", scheduleMetrics.teachersWithRestDays], ["Périodes actives", scheduleMetrics.activeCoursePeriods], ["Pauses / récréations", scheduleMetrics.activeNonTeachingPeriods]] as const;
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#f6f8fb]">{renderEnvironmentBanner()}{renderHeader()}<main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">{activeTab === "dashboard" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Direction des études</h1><p className="mt-1 break-words text-sm text-slate-600">{school.name} · Année scolaire {year.name}</p></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{dashboardCards.map(([label, value]) => <article key={label} className="flex min-h-28 flex-col justify-between rounded border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-ink">{value}</p></article>)}</div></section>}{activeTab === "teachers" && <StudyTeachersModule user={user} school={school} year={year} data={data} />}{activeTab === "schedules" && <StudySchedulesModule user={user} school={school} year={year} data={data} />}{activeTab === "menu" && <section className="grid gap-3"><StudyAiAssistant user={user} school={school} year={year} data={data} /><button type="button" className={menuButton} onClick={() => setDrawer("requests")}><UserRoundCheck className="h-5 w-5" /><strong className="mt-2 block">Demandes d’indisponibilité</strong></button><button type="button" className={menuButton} onClick={() => setDrawer("history")}><History className="h-5 w-5" /><strong className="mt-2 block">Historique des versions</strong></button><button type="button" className={menuButton} onClick={() => setDrawer("periods")}><CalendarClock className="h-5 w-5" /><strong className="mt-2 block">Périodes & tranches horaires</strong></button><button type="button" onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"><LogOut className="h-4 w-4" /> Déconnexion</button></section>}</main>{drawer === "requests" && <StudyAvailabilityRequestsDrawer user={user} school={school} year={year} teachers={data.teachers} availabilities={data.availabilities} timetables={data.timetables} entries={data.timetableEntries} periods={data.periods} subjects={data.subjects} classes={data.classes} onClose={() => setDrawer(null)} />}{drawer === "history" && <AdminDrawer title="Historique des versions" closeLabel="Fermer l’historique" onClose={() => setDrawer(null)}><StudyScheduleHistory items={data.timetables} /></AdminDrawer>}{drawer === "periods" && <AdminDrawer title="Périodes & tranches horaires" closeLabel="Fermer" onClose={() => setDrawer(null)}><StudyPeriodsModule user={user} school={school} year={year} data={data} /></AdminDrawer>}<StudyDirectorBottomNavigation activeTab={activeTab} onTab={setActiveTab} /></div>;
}
