import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyDay, StudyRoom, StudySubject, StudyTeacher, Timetable, TimetableEntry } from "../studies/studyTypes";
import type { AppUser } from "../../types";
import { isSectionAllowed } from "../../utils/userSections";
import { studyClassSection } from "../studies/teacherAssignmentScope";
import { assignmentsForClasses, subjectsReferencedByAssignments } from "../studies/studyAssignments";
import { schoolCivilDate, schoolCourseSuspended, type SchoolCalendar } from "../studies/schoolCalendar";

export type TeacherPortalData = {
  teacher?: StudyTeacher;
  activeTimetable?: Timetable;
  assignments: PedagogicalAssignment[];
  subjects: StudySubject[];
  classes: StudyClass[];
  rooms: StudyRoom[];
  periods: SchedulePeriod[];
  entries: TimetableEntry[];
  loading: boolean;
  error: string;
};

export function scopeTeacherPortalData(user: Pick<AppUser, "section" | "sectionIds">, data: TeacherPortalData): TeacherPortalData {
  const classes = data.classes.filter((item) => isSectionAllowed(user, studyClassSection(item, data.classes)));
  const classIds = new Set(classes.map((item) => item.id));
  const assignments = assignmentsForClasses(data.assignments, classIds, classes);
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const subjectIds = new Set(assignments.map((item) => item.subjectId));
  return {
    ...data,
    classes,
    assignments,
    subjects: subjectsReferencedByAssignments(data.subjects, assignments).filter((item) => subjectIds.has(item.id)),
    entries: data.entries.filter((item) => (!item.assignmentId || assignmentIds.has(item.assignmentId))),
  };
}

export const studyDayLabels: Record<StudyDay, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi" };
export const orderedStudyDays = Object.keys(studyDayLabels) as StudyDay[];

export function schoolCivilDateLabel(civilDate: string | undefined) {
  if (!civilDate || !/^\d{4}-\d{2}-\d{2}$/.test(civilDate)) return undefined;
  const date = new Date(`${civilDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== civilDate) return undefined;
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return { weekday: part("weekday")?.toLocaleUpperCase("fr-FR"), date: `${part("day")} ${part("month")} ${part("year")}` };
}

export function schoolStudyDay(date: Date, timeZone: string | undefined): StudyDay | undefined {
  if (!timeZone) return undefined;
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date).toLowerCase();
    return orderedStudyDays.find((day) => day === weekday);
  } catch {
    return undefined;
  }
}

export type TeacherCourseState =
  | { status: "unpublished" | "timezone-missing" | "no-courses" | "incomplete" | "overlap" | "finished" }
  | { status: "before" | "during" | "between"; entry: TimetableEntry };

export function teacherCourseState(entries: TimetableEntry[], periods: SchedulePeriod[], date: Date, timeZone: string | undefined, hasPublished: boolean): TeacherCourseState {
  if (!hasPublished) return { status: "unpublished" };
  if (!timeZone) return { status: "timezone-missing" };
  let day: StudyDay | undefined;
  let now = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value.toLowerCase();
    day = orderedStudyDays.find((item) => item === weekday);
    now = `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
  } catch {
    return { status: "timezone-missing" };
  }
  if (!day) return { status: "no-courses" };
  const todaysEntries = entries.filter((entry) => entry.active !== false && entry.dayOfWeek === day);
  if (!todaysEntries.length) return { status: "no-courses" };
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const courses = todaysEntries.map((entry) => ({ entry, period: periodById.get(entry.periodId) }));
  if (courses.some(({ period }) => !period || !/^\d{2}:\d{2}$/.test(period.startTime) || !/^\d{2}:\d{2}$/.test(period.endTime) || period.startTime >= period.endTime)) return { status: "incomplete" };
  const ordered = courses.sort((left, right) => left.period!.startTime.localeCompare(right.period!.startTime) || left.entry.id.localeCompare(right.entry.id));
  if (ordered.some((course, index) => index > 0 && ordered[index - 1].period!.endTime > course.period!.startTime)) return { status: "overlap" };
  const current = ordered.find(({ period }) => period!.startTime <= now && now < period!.endTime);
  if (current) return { status: "during", entry: current.entry };
  const next = ordered.find(({ period }) => now < period!.startTime);
  if (next) return { status: next === ordered[0] ? "before" : "between", entry: next.entry };
  return { status: "finished" };
}

export function currentStudyDay(date = new Date()): StudyDay | undefined {
  return ([undefined, "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[date.getDay()];
}

export function teacherEntriesForDay(entries: TimetableEntry[], periods: SchedulePeriod[], day: StudyDay | undefined) {
  if (!day) return [];
  const order = new Map(periods.map((period) => [period.id, period.order]));
  return entries.filter((entry) => entry.active !== false && entry.dayOfWeek === day).sort((left, right) => (order.get(left.periodId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.periodId) ?? Number.MAX_SAFE_INTEGER));
}

export type TeacherNextCourse = TeacherCourseState | { status: "future"; entry: TimetableEntry; date: string };

export function teacherNextAvailableCourse(entries: TimetableEntry[], periods: SchedulePeriod[], now: Date, timeZone: string | undefined, hasPublished: boolean, calendar?: SchoolCalendar, classes: StudyClass[] = []): TeacherNextCourse {
  if (!hasPublished) return { status: "unpublished" };
  const today = schoolCivilDate(now, timeZone);
  if (!today) return { status: "timezone-missing" };
  const byId = new Map(periods.map((period) => [period.id, period]));
  let hadCoursesToday = false;
  for (let offset = 0; offset <= 7; offset++) {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    const civil = date.toISOString().slice(0, 10);
    const day = orderedStudyDays.find((item) => studyDayLabels[item] && ({ monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 } as Record<StudyDay, number>)[item] === date.getUTCDay());
    if (!day) continue;
    const raw = teacherEntriesForDay(entries, periods, day);
    if (offset === 0) hadCoursesToday = raw.length > 0;
    if (raw.some((entry) => { const period = byId.get(entry.periodId); return !period || !/^\d{2}:\d{2}$/.test(period.startTime) || !/^\d{2}:\d{2}$/.test(period.endTime) || period.startTime >= period.endTime; })) return { status: "incomplete" };
    const available = raw.filter((entry) => {
      const period = byId.get(entry.periodId);
      const studyClass = classes.find((item) => item.id === entry.classId);
      return period && !schoolCourseSuspended(calendar, civil, period.startTime, period.endTime, studyClass ? studyClassSection(studyClass, classes) : undefined);
    });
    if (!available.length) continue;
    if (offset === 0) {
      const state = teacherCourseState(available, periods, now, timeZone, true);
      if (state.status === "before" || state.status === "during" || state.status === "between" || state.status === "overlap" || state.status === "incomplete") return state;
      continue;
    }
    return { status: "future", entry: available[0], date: civil };
  }
  return { status: hadCoursesToday ? "finished" : "no-courses" };
}

export function nextTeacherEntry(entries: TimetableEntry[], periods: SchedulePeriod[], date = new Date()) {
  const dayIndexes: Record<StudyDay, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const periodById = new Map(periods.map((period) => [period.id, period]));
  const now = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return entries
    .filter((entry) => entry.active !== false)
    .map((entry) => ({
      entry,
      daysAhead: (dayIndexes[entry.dayOfWeek] - date.getDay() + 7) % 7,
      period: periodById.get(entry.periodId),
    }))
    .filter(({ daysAhead, period }) => Boolean(period) && (daysAhead > 0 || period!.endTime > now))
    .sort((left, right) => left.daysAhead - right.daysAhead || left.period!.order - right.period!.order)[0]?.entry;
}

export function weeklyWorkload(assignments: PedagogicalAssignment[]) {
  return assignments.filter((item) => item.active).reduce((total, item) => total + item.weeklyPeriods, 0);
}
