import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyDay, StudyRoom, StudySubject, StudyTeacher, TimetableEntry } from "../studies/studyTypes";

export type TeacherPortalData = {
  teacher?: StudyTeacher;
  assignments: PedagogicalAssignment[];
  subjects: StudySubject[];
  classes: StudyClass[];
  rooms: StudyRoom[];
  periods: SchedulePeriod[];
  entries: TimetableEntry[];
  loading: boolean;
  error: string;
};

export const studyDayLabels: Record<StudyDay, string> = { monday: "Lundi", tuesday: "Mardi", wednesday: "Mercredi", thursday: "Jeudi", friday: "Vendredi", saturday: "Samedi" };
export const orderedStudyDays = Object.keys(studyDayLabels) as StudyDay[];

export function currentStudyDay(date = new Date()): StudyDay | undefined {
  return ([undefined, "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const)[date.getDay()];
}

export function teacherEntriesForDay(entries: TimetableEntry[], periods: SchedulePeriod[], day: StudyDay | undefined) {
  if (!day) return [];
  const order = new Map(periods.map((period) => [period.id, period.order]));
  return entries.filter((entry) => entry.dayOfWeek === day).sort((left, right) => (order.get(left.periodId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.periodId) ?? Number.MAX_SAFE_INTEGER));
}

export function nextTeacherEntry(entries: TimetableEntry[], periods: SchedulePeriod[], date = new Date()) {
  const today = teacherEntriesForDay(entries, periods, currentStudyDay(date));
  const now = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return today.find((entry) => (periods.find((period) => period.id === entry.periodId)?.endTime ?? "") > now);
}

export function weeklyWorkload(assignments: PedagogicalAssignment[]) {
  return assignments.filter((item) => item.active).reduce((total, item) => total + item.weeklyPeriods, 0);
}
