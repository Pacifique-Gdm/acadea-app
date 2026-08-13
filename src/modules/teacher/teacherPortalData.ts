import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyDay, StudyRoom, StudySubject, StudyTeacher, Timetable, TimetableEntry } from "../studies/studyTypes";
import type { AppUser } from "../../types";
import { isSectionAllowed } from "../../utils/userSections";
import { studyClassSection } from "../studies/teacherAssignmentScope";

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
  const classes = data.classes.filter((item) => isSectionAllowed(user, studyClassSection(item)));
  const classIds = new Set(classes.map((item) => item.id));
  const assignments = data.assignments.filter((item) => classIds.has(item.classId));
  const assignmentIds = new Set(assignments.map((item) => item.id));
  const subjectIds = new Set(assignments.map((item) => item.subjectId));
  return {
    ...data,
    classes,
    assignments,
    subjects: data.subjects.filter((item) => subjectIds.has(item.id)),
    entries: data.entries.filter((item) => classIds.has(item.classId) && (!item.assignmentId || assignmentIds.has(item.assignmentId))),
  };
}

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
