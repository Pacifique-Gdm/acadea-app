import { useState } from "react";
import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { StudyDirectorBottomNavigation } from "../../components/layout/StudyDirectorBottomNavigation";
import type { StudyDirectorTab } from "../../components/layout/studyDirectorNavigation";
import type { AppUser, School, SchoolYear } from "../../types";
import { studyDashboardMetrics } from "./studyAssignments";
import { StudyTeachersModule } from "./StudyTeachersModule";
import { useStudyData } from "./useStudyData";
import { StudyPeriodsModule } from "./StudyPeriodsModule";
import { phase3DashboardMetrics } from "./studySchedule";
import { StudySchedulesModule } from "./StudySchedulesModule";
import { StudyRoomsModule } from "./StudyRoomsModule";
import { StudyAiAssistant } from "./StudyAiAssistant";

export function StudyDirectorPortal({ user, school, year, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; renderHeader: () => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<StudyDirectorTab>("dashboard");
  const studyData = useStudyData(user, school.id, year.id);
  const metrics = studyDashboardMetrics(studyData.teachers, studyData.assignments);
  const scheduleMetrics = phase3DashboardMetrics(studyData.availabilities, studyData.periods);
  return <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">
    {renderEnvironmentBanner()}
    {renderHeader()}
    <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
      {activeTab === "dashboard" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Direction des études</h1><p className="mt-1 text-sm text-slate-600">{school.name} · Année scolaire {year.name}</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["Enseignants", metrics.teachers], ["Matières utilisées", metrics.subjects], ["Affectations", metrics.assignments], ["Charge totale", metrics.workload], ["Sans affectation", metrics.teachersWithoutAssignment]].map(([label, value]) => <article key={label} className="rounded border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-ink">{value}</p></article>)}</div></section>}
      {activeTab === "teachers" && <StudyTeachersModule user={user} school={school} year={year} data={studyData} />}
      {activeTab === "schedules" && <StudySchedulesModule user={user} school={school} year={year} data={studyData} />}
      {activeTab === "menu" && <section className="grid gap-4"><StudyAiAssistant user={user} school={school} year={year} data={studyData}/><StudyPeriodsModule user={user} school={school} year={year} data={studyData}/><StudyRoomsModule user={user} school={school} year={year} data={studyData}/><div className="rounded border border-slate-200 bg-white p-5 shadow-sm"><button type="button" onClick={onLogout} className="secondary-button"><LogOut className="h-4 w-4" /> Déconnexion</button></div></section>}
      {activeTab === "dashboard" && <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Enseignants avec indisponibilités",scheduleMetrics.teachersWithUnavailability],["Enseignants avec jours de repos",scheduleMetrics.teachersWithRestDays],["Périodes de cours actives",scheduleMetrics.activeCoursePeriods],["Pauses / récréations actives",scheduleMetrics.activeNonTeachingPeriods]].map(([label,value])=><article key={label} className="rounded border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-ink">{value}</p></article>)}</section>}
    </main>
    <StudyDirectorBottomNavigation activeTab={activeTab} onTab={setActiveTab} />
  </div>;
}
