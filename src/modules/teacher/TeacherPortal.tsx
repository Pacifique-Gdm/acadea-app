import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, CalendarDays, ClipboardPenLine, Clock3, Gauge, Users, UserRoundCheck } from "lucide-react";
import { DashboardCard, FormPanel, LogoutButton, AdminDrawer } from "../../components/ui";
import { ActivityHistoryContent } from "../../components/history/ActivityHistoryContent";
import { TeacherBottomNavigation } from "../../components/layout/TeacherBottomNavigation";
import type { TeacherTab } from "../../components/layout/teacherNavigation";
import type { AppData, AppUser, School, SchoolYear } from "../../types";
import { orderedStudyDays, schoolCivilDateLabel, schoolStudyDay, teacherNextAvailableCourse, studyDayLabels, teacherEntriesForDay, weeklyWorkload } from "./teacherPortalData";
import { useTeacherPortalData } from "./useTeacherPortalData";
import { TeacherAvailabilityRequestsDrawer } from "./TeacherAvailabilityRequestsDrawer";
import { TeacherGradingDrawer } from "./TeacherGradingDrawer";
import { TeacherStudentsDrawer } from "./TeacherStudentsDrawer";
import { teacherClassScopeLabel } from "./teacherCourseLabels";
import { LibraryDrawer } from "../library/LibraryDrawer";
import { OwnPayrollEntry } from "../../components/personnel/OwnPayrollEntry";
import { schoolCivilDate, schoolCourseSuspended } from "../studies/schoolCalendar";
import { useSchoolCalendar } from "../studies/useSchoolCalendar";
import { studyClassSection } from "../studies/teacherAssignmentScope";
import { teacherDashboardYear } from "./teacherDashboardYear";
import { useTeacherSchoolYears } from "./useTeacherSchoolYears";

export function TeacherPortal({ user, school, year, appData, refreshToken = 0, renderHeader, renderEnvironmentBanner, onLogout }: { user: AppUser; school: School; year: SchoolYear; appData: AppData; refreshToken?: number; renderHeader: (state: { isRefreshing: boolean; refreshError: string }) => ReactNode; renderEnvironmentBanner: () => ReactNode; onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<TeacherTab>("dashboard");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); timeout = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 25); };
    timeout = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 25);
    return () => clearTimeout(timeout);
  }, []);
  const [requestsOpen, setRequestsOpen] = useState(false);
  const [gradingOpen, setGradingOpen] = useState(false);
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const schoolYears = useTeacherSchoolYears(user, school.id);
  const resolvedYear = schoolYears.loading || schoolYears.error ? undefined : teacherDashboardYear(school, schoolYears.years);
  const civilDate = schoolCivilDate(now, school.timeZone);
  const currentSchoolDay = schoolCivilDateLabel(civilDate);
  const dashboardYear = resolvedYear?.status === "active" ? resolvedYear.year : undefined;
  const displayedYearId = activeTab === "dashboard" ? dashboardYear?.id ?? "" : year.id;
  const data = useTeacherPortalData(user, school.id, displayedYearId, refreshToken);
  const calendarState = useSchoolCalendar(user, school.id, dashboardYear?.id);
  const calendar = !calendarState.loading && !calendarState.error && calendarState.calendar?.status === "validated" ? calendarState.calendar : undefined;
  const dashboardMessage = schoolYears.loading ? "Chargement de l’année scolaire active…"
    : schoolYears.error ? "Impossible de charger l’année scolaire active."
    : resolvedYear?.status === "missing" ? "Aucune année scolaire active n'est définie pour cet établissement."
    : resolvedYear?.status === "inconsistent" ? "Année scolaire active incohérente pour cet établissement."
    : !civilDate ? "Fuseau horaire de l’établissement non configuré ou invalide."
    : data.loading ? "Chargement des cours…"
    : data.error ? "Impossible de déterminer les cours aujourd’hui." : "";
  const canShowCourses = !dashboardMessage && data.activeTimetable?.schoolYearId === dashboardYear?.id;
  const periods = useMemo(() => [...data.periods].filter((item) => item.active).sort((left, right) => left.order - right.order), [data.periods]);
  const today = useMemo(() => canShowCourses ? teacherEntriesForDay(data.entries, periods, schoolStudyDay(now, school.timeZone)) : [], [canShowCourses, data.entries, periods, now, school.timeZone]);
  const next = useMemo(() => teacherNextAvailableCourse(canShowCourses ? data.entries : [], periods, now, school.timeZone, Boolean(data.activeTimetable), calendar, data.classes), [canShowCourses, data.entries, periods, now, school.timeZone, data.activeTimetable, calendar, data.classes]);
  const label = (items: Array<{ id: string; name: string }>, id: string, fallback: string) => items.find((item) => item.id === id)?.name ?? fallback;
  const classLabel = (classId: string, assignmentId: string) => { const name = label(data.classes, classId, "Classe non renseignée"); const assignment = data.assignments.find((item) => item.id === assignmentId); return assignment ? teacherClassScopeLabel(name, assignment, data.classes) : name; };
  const periodLabel = (id: string) => { const period = periods.find((item) => item.id === id); return period ? `${period.label} · ${period.startTime}–${period.endTime}` : "Période indisponible"; };
  const courseDetails = (entry: (typeof data.entries)[number], suspended = false) => <div key={entry.id} className="border-t border-slate-100 py-2 first:border-t-0 first:pt-0 last:pb-0"><p className="font-bold text-ink">{label(data.subjects, entry.subjectId, "Matière non renseignée")}{suspended && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Suspendu</span>}</p><p className="mt-1 text-sm text-slate-600">{classLabel(entry.classId, entry.assignmentId)} · {periodLabel(entry.periodId)}</p>{data.rooms.find((room) => room.id === entry.roomId)?.name && <p className="mt-1 text-xs font-semibold text-blue-700">Salle : {label(data.rooms, entry.roomId ?? "", "")}</p>}</div>;
  const courseCard = (entry: (typeof data.entries)[number]) => <article key={entry.id} className="rounded border border-slate-200 bg-white p-4 shadow-sm">{courseDetails(entry)}</article>;

  return <div className="flex h-screen flex-col overflow-hidden bg-[#f6f8fb]">{renderEnvironmentBanner()}{renderHeader({ isRefreshing: data.loading, refreshError: data.error })}<main className="mx-auto w-full max-w-7xl min-w-0 flex-1 overflow-y-auto px-3 py-5 pb-28 sm:px-6 sm:pb-32 lg:px-8">
    {data.loading && <p className="rounded bg-white p-6 text-center text-sm text-slate-500">Chargement de votre espace Enseignant…</p>}
    {data.error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{data.error}</p>}
    {activeTab === "dashboard" && <section className="grid gap-4">
      <div><h1 className="text-2xl font-bold text-ink">Dashboard Enseignant</h1><p className="mt-1 text-sm text-slate-600">{school.name}{dashboardYear ? ` · Année scolaire ${dashboardYear.name}` : ""}</p></div>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <DashboardCard title={currentSchoolDay?.weekday ? `Cours aujourd'hui – ${currentSchoolDay.weekday}` : "Cours aujourd'hui"} icon={CalendarDays}>{dashboardMessage ? <p className="text-sm text-slate-500">{dashboardMessage}</p> : !canShowCourses ? <p className="text-sm text-slate-500">Aucun horaire publié pour cette année scolaire.</p> : today.length ? <div className="grid gap-2">{today.map((entry) => { const period = periods.find((item) => item.id === entry.periodId); const studyClass = data.classes.find((item) => item.id === entry.classId); const section = studyClass ? studyClassSection(studyClass, data.classes) : undefined; return courseDetails(entry, Boolean(civilDate && period && schoolCourseSuspended(calendar, civilDate, period.startTime, period.endTime, section))); })}</div> : <p className="text-sm text-slate-500">Aucun cours n'est programmé pour aujourd'hui.</p>}</DashboardCard>
        <DashboardCard title="Charge hebdomadaire" icon={Gauge} tone="bg-emerald-50 text-emerald-700" value={`${weeklyWorkload(data.assignments)} périodes`} />
        <DashboardCard title="Affectations actives" icon={ClipboardPenLine} tone="bg-amber-50 text-amber-700" value={data.assignments.length} />
        <DashboardCard title="Prochain cours" icon={Clock3} tone="bg-violet-50 text-violet-700">{dashboardMessage ? <p className="text-sm text-slate-500">{dashboardMessage}</p> : next.status === "before" || next.status === "during" || next.status === "between" || next.status === "future" ? <><p className="mb-2 text-sm font-semibold text-violet-700">{next.status === "during" ? "Cours en cours" : next.status === "future" ? `Prochain cours le : ${schoolCivilDateLabel(next.date)?.weekday} – ${schoolCivilDateLabel(next.date)?.date}` : next.status === "before" ? `Prochain cours le : ${currentSchoolDay?.weekday} – ${currentSchoolDay?.date}` : `Prochain cours le : ${currentSchoolDay?.weekday} – ${currentSchoolDay?.date}`}</p>{courseDetails(next.entry)}</> : <p className="text-sm text-slate-500">{next.status === "finished" ? "Vos cours de la journée sont terminés." : next.status === "no-courses" ? "Aucun prochain cours disponible." : next.status === "unpublished" ? "Aucun horaire publié pour cette année scolaire." : next.status === "overlap" ? "Des cours se chevauchent dans l’horaire publié. Contactez la Direction des études." : next.status === "incomplete" ? "Certaines périodes de l’horaire publié sont indisponibles." : "Fuseau horaire de l’établissement non configuré ou invalide."}</p>}</DashboardCard>
      </div>
    </section>}
    {!data.loading && data.teacher && activeTab === "courses" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Mes cours</h1><p className="text-sm text-slate-600">Affectations définies par la Direction des études, en lecture seule.</p></div><FormPanel title=""><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.assignments.map((assignment) => <article key={assignment.id} className="rounded border border-slate-200 bg-white p-4 shadow-sm"><p className="font-bold text-ink">{label(data.subjects, assignment.subjectId, "Matière non renseignée")}</p><p className="mt-1 text-sm text-slate-600">{teacherClassScopeLabel(label(data.classes, assignment.classId, "Classe non renseignée"), assignment, data.classes)}</p><p className="mt-3 text-sm font-semibold text-blue-700">{assignment.weeklyPeriods} périodes/semaine</p>{assignment.preferredRoomId && <p className="mt-1 text-xs text-slate-500">Salle préférée : {label(data.rooms, assignment.preferredRoomId, "Non renseignée")}</p>}<span className="mt-3 inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-semibold text-green-800">Actif</span></article>)}{data.assignments.length === 0 && <p className="text-sm text-slate-500">Aucune affectation active.</p>}</div></FormPanel></section>}
    {!data.loading && data.teacher && activeTab === "schedule" && <section className="grid gap-4" data-active-schedule-id={data.activeTimetable?.id ?? "none"}><div><h1 className="text-2xl font-bold text-ink">Mon horaire</h1><p className="text-sm text-slate-600">Horaire publié actif, en lecture seule.{data.activeTimetable ? ` Version ${data.activeTimetable.version}.` : ""}</p></div><FormPanel title="">{data.entries.length === 0 ? <p className="text-sm text-slate-500">Aucun horaire publié pour cette année scolaire.</p> : <div className="grid gap-4">{orderedStudyDays.map((day) => { const entries = teacherEntriesForDay(data.entries, periods, day); if (!entries.length) return null; return <section key={day} className="rounded border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-bold text-ink">{studyDayLabels[day]}</h2><div className="mt-3 grid gap-2">{entries.map(courseCard)}</div></section>; })}</div>}</FormPanel></section>}
    {!data.loading && data.teacher && activeTab === "menu" && <section className="grid gap-4"><div><h1 className="text-2xl font-bold text-ink">Menu</h1><p className="text-sm text-slate-600">Fonctions secondaires de votre espace.</p></div><div className="grid gap-3"><OwnPayrollEntry user={user} school={school} /><button type="button" onClick={()=>setGradingOpen(true)} className="rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="flex items-center gap-3"><ClipboardPenLine className="h-5 w-5 shrink-0"/><span className="font-semibold">Fiche de cotation</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Saisie et consolidation</p></button><button type="button" onClick={()=>setStudentsOpen(true)} className="rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="flex items-center gap-3"><Users className="h-5 w-5 shrink-0"/><span className="font-semibold">Mes élèves</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Suivi de mes classes</p></button><button type="button" onClick={()=>setLibraryOpen(true)} className="rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="flex items-center gap-3"><BookOpen className="h-5 w-5 shrink-0"/><span className="font-semibold">Bibliothèque</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Ressources éducatives externes</p></button><button type="button" onClick={()=>setRequestsOpen(true)} className="rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="flex items-center gap-3"><UserRoundCheck className="h-5 w-5 shrink-0"/><span className="font-semibold">Mes demandes</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Indisponibilités</p></button><button type="button" onClick={()=>setHistoryOpen(true)} className="rounded border border-slate-200 bg-white p-4 text-left text-ink shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600"><span className="flex items-center gap-3"><Clock3 className="h-5 w-5 shrink-0"/><span className="font-semibold">Historique</span></span><p className="mt-1 pl-8 text-xs text-slate-500">Vos activités</p></button></div><LogoutButton onClick={onLogout} /></section>}
    {requestsOpen&&data.teacher&&<TeacherAvailabilityRequestsDrawer user={user} school={school} year={year} teacher={data.teacher} onClose={()=>setRequestsOpen(false)}/>}
    {gradingOpen&&<TeacherGradingDrawer user={user} school={school} year={year} portalData={data} onClose={()=>setGradingOpen(false)}/>}
    {studentsOpen&&<TeacherStudentsDrawer user={user} school={school} year={year} data={data} onClose={()=>setStudentsOpen(false)}/>}
    {libraryOpen&&<LibraryDrawer audience="teacher" onClose={()=>setLibraryOpen(false)}/>}
    {historyOpen&&<AdminDrawer title="Historique" closeLabel="Fermer l’historique" onClose={()=>setHistoryOpen(false)}><ActivityHistoryContent user={user} data={appData} yearData={appData} role="teacher" /></AdminDrawer>}
  </main><TeacherBottomNavigation activeTab={activeTab} onTab={setActiveTab}/></div>;
}
