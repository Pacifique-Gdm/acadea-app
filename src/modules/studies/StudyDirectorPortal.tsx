import { useState } from "react";
import { AlertTriangle, BarChart3, BookOpenCheck, CalendarClock, Clock3, GraduationCap, History, LogOut, PauseCircle, UserRoundCheck, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { AdminDrawer, DashboardCard } from "../../components/ui";
import { AgeHomogeneityDrawer } from "../../components/students/StudentAdministrativeTools";
import { StudyDirectorBottomNavigation } from "../../components/layout/StudyDirectorBottomNavigation";
import type { StudyDirectorTab } from "../../components/layout/studyDirectorNavigation";
import type { AppUser, School, SchoolYear } from "../../types";
import { userSectionIds } from "../../utils/userSections";
import { studyDashboardMetrics } from "./studyAssignments";
import { phase3DashboardMetrics } from "./studySchedule";
import { StudyTeachersModule } from "./StudyTeachersModule";
import { StudentsModule } from "../students/StudentsModule";
import { StudentDetailPage } from "../../components/students/StudentDetailPage";
import type { AppData } from "../../types";
import { StudySchedulesModule } from "./StudySchedulesModule";
import { StudyPeriodsModule } from "./StudyPeriodsModule";
import { StudyAiAssistant } from "./StudyAiAssistant";
import { StudyAvailabilityRequestsDrawer } from "./StudyAvailabilityRequestsDrawer";
import { StudyScheduleHistory } from "./StudyScheduleHistory";
import { useStudyData } from "./useStudyData";

type MenuDrawer = "requests" | "history" | "periods" | "age" | null;
const menuButton = "flex items-center gap-3 rounded border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600";

export function StudyDirectorPortal({ user, school, year, appData, refreshToken = 0, updateData, createId, formatArchiveDate, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; appData: AppData; refreshToken?: number; updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void; createId: (prefix: string) => string; formatArchiveDate: (value?: string) => string; renderHeader: () => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<StudyDirectorTab>("dashboard"), [drawer, setDrawer] = useState<MenuDrawer>(null), [selectedStudentId, setSelectedStudentId] = useState<string>();
  const data = useStudyData(user, school.id, year.id, refreshToken);
  const metrics = studyDashboardMetrics(data.teachers, data.assignments), scheduleMetrics = phase3DashboardMetrics(data.availabilities, data.periods);
  const dashboardCards = [
    ["Enseignants", metrics.teachers, UsersRound, "bg-blue-50 text-blue-700"],
    ["Matières utilisées", metrics.subjects, GraduationCap, "bg-violet-50 text-violet-700"],
    ["Affectations", metrics.assignments, BookOpenCheck, "bg-emerald-50 text-emerald-700"],
    ["Charge totale", metrics.workload, Clock3, "bg-amber-50 text-amber-700"],
    ["Sans affectation", metrics.teachersWithoutAssignment, AlertTriangle, "bg-red-50 text-red-700"],
    ["Avec indisponibilités", scheduleMetrics.teachersWithUnavailability, CalendarClock, "bg-orange-50 text-orange-700"],
    ["Avec jours de repos", scheduleMetrics.teachersWithRestDays, PauseCircle, "bg-slate-100 text-slate-700"],
    ["Périodes actives", scheduleMetrics.activeCoursePeriods, BarChart3, "bg-cyan-50 text-cyan-700"],
    ["Pauses / récréations", scheduleMetrics.activeNonTeachingPeriods, PauseCircle, "bg-fuchsia-50 text-fuchsia-700"],
  ] as const;
  return <div className="flex h-screen min-w-0 flex-col overflow-hidden bg-[#f6f8fb]">{renderEnvironmentBanner()}{renderHeader()}<main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
    {activeTab === "dashboard" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Direction des études</h1><p className="mt-1 break-words text-sm text-slate-600">{school.name} · Année scolaire {year.name}</p></div><div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{dashboardCards.map(([label, value, Icon, tone]) => <DashboardCard key={label} title={label} value={value} icon={Icon} tone={tone} />)}</div></section>}
    {activeTab === "teachers" && <StudyTeachersModule user={user} school={school} year={year} data={data} />}{activeTab === "students" && (selectedStudentId ? <StudentDetailPage studentId={selectedStudentId} user={user} data={appData} yearData={{ students: data.students, parents: appData.parents, feeTypes: appData.feeTypes, payments: appData.payments, auditLogs: appData.auditLogs }} year={year} school={school} updateData={updateData} onBack={() => setSelectedStudentId(undefined)} createId={createId} formatArchiveDate={formatArchiveDate} canLinkParent={false} /> : <StudentsModule user={user} data={appData} yearData={{ students: data.students, parents: appData.parents }} school={school} year={year} updateData={updateData} onOpenStudent={setSelectedStudentId} uid={createId} formatArchiveDate={formatArchiveDate} allowedSections={userSectionIds(user)} capabilities={{ canCreate: false, canEdit: false, canArchive: false, canReactivate: false, canCreateParent: false, canManageOptions: false }} />)}{activeTab === "schedules" && <StudySchedulesModule user={user} school={school} year={year} data={data} />}
    {activeTab === "menu" && <section className="grid gap-3"><StudyAiAssistant user={user} school={school} year={year} data={data} /><button type="button" className={menuButton} onClick={() => setDrawer("age")}><BarChart3 className="h-5 w-5 shrink-0"/><strong>Tableau d’homogénéité d’âge</strong></button><button type="button" className={menuButton} onClick={() => setDrawer("requests")}><UserRoundCheck className="h-5 w-5 shrink-0"/><strong>Demandes d’indisponibilité</strong></button><button type="button" className={menuButton} onClick={() => setDrawer("history")}><History className="h-5 w-5 shrink-0"/><strong>Historique des versions</strong></button><button type="button" className={menuButton} onClick={() => setDrawer("periods")}><CalendarClock className="h-5 w-5 shrink-0"/><strong>Périodes & tranches horaires</strong></button><button type="button" onClick={onLogout} className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500"><LogOut className="h-4 w-4"/> Déconnexion</button></section>}
  </main>
  {drawer === "age" && <AgeHomogeneityDrawer open onClose={() => setDrawer(null)} user={user} school={school} year={year} studentSource={data.students} classSource={data.classes} allowedSections={userSectionIds(user)} />}
  {drawer === "requests" && <StudyAvailabilityRequestsDrawer user={user} school={school} year={year} teachers={data.teachers} availabilities={data.availabilities} timetables={data.timetables} entries={data.timetableEntries} periods={data.periods} subjects={data.subjects} classes={data.classes} onClose={() => setDrawer(null)} />}
  {drawer === "history" && <AdminDrawer title="Historique des versions" closeLabel="Fermer l’historique" onClose={() => setDrawer(null)}><StudyScheduleHistory items={data.timetables}/></AdminDrawer>}{drawer === "periods" && <AdminDrawer title="Périodes & tranches horaires" closeLabel="Fermer" onClose={() => setDrawer(null)}><StudyPeriodsModule user={user} school={school} year={year} data={data}/></AdminDrawer>}<StudyDirectorBottomNavigation activeTab={activeTab} onTab={setActiveTab}/></div>;
}
