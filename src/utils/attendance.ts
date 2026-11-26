import type { AttendanceDaySchedule, AttendanceSchoolDay, AttendanceSettings, AttendanceStatus, SchoolSection, Student } from "../types";
import { getClassSection } from "./studentClasses";

export const attendanceSchoolDays: AttendanceSchoolDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export const defaultFiveSchoolDays: AttendanceSchoolDay[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];
export const defaultSixSchoolDays: AttendanceSchoolDay[] = [...attendanceSchoolDays];

export const attendanceSchoolDayLabels: Record<AttendanceSchoolDay, string> = {
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
  saturday: "Samedi",
};

const dateDayToAttendanceDay: Record<number, AttendanceSchoolDay | undefined> = {
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

export function attendanceRecordId(schoolId: string, schoolYearId: string, studentId: string, attendanceDate: string) {
  return `attendance__${[schoolId, schoolYearId, studentId, attendanceDate]
    .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_"))
    .join("__")}`;
}

export function attendanceSettingsId(schoolId: string, schoolYearId: string) {
  return `attendance-settings__${[schoolId, schoolYearId].map((part) => part.replace(/[^a-zA-Z0-9_-]/g, "_")).join("__")}`;
}

export function attendanceClassRuleKey(className: string, option?: string) {
  return option ? `${className}__${option}` : className;
}

export function parseTimeToMinutes(value?: string) {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function attendanceSchoolDayFromDate(date: Date) {
  return dateDayToAttendanceDay[date.getDay()];
}

function orderedSchoolDays(days?: readonly AttendanceSchoolDay[]) {
  const configuredDays = days?.filter((day): day is AttendanceSchoolDay => attendanceSchoolDays.includes(day)) ?? [];
  return attendanceSchoolDays.filter((day) => configuredDays.includes(day));
}

/** Jours de cours de l'école, ou ceux de la section quand elle en a de propres. */
export function resolveAttendanceSchoolDays(settings?: AttendanceSettings, section?: SchoolSection | null): AttendanceSchoolDay[] {
  const sectionDays = section ? orderedSchoolDays(settings?.sectionSchoolDays?.[section]) : [];
  if (sectionDays.length > 0) return sectionDays;
  const configuredDays = orderedSchoolDays(settings?.schoolDays);
  return configuredDays.length > 0 ? configuredDays : defaultSixSchoolDays;
}

/** Vrai seulement si au moins une section a ses propres jours de cours. */
export function hasSectionSchoolDays(settings?: AttendanceSettings) {
  return Object.values(settings?.sectionSchoolDays ?? {}).some((days) => orderedSchoolDays(days).length > 0);
}

/** Tous les jours où au moins une section a cours. Sans jours par section : exactement les jours de l'école. */
export function resolveAllAttendanceSchoolDays(settings?: AttendanceSettings): AttendanceSchoolDay[] {
  const schoolDays = resolveAttendanceSchoolDays(settings);
  if (!hasSectionSchoolDays(settings)) return schoolDays;
  const used = new Set<AttendanceSchoolDay>(schoolDays);
  Object.values(settings?.sectionSchoolDays ?? {}).forEach((days) => orderedSchoolDays(days).forEach((day) => used.add(day)));
  return attendanceSchoolDays.filter((day) => used.has(day));
}

export function resolveAttendanceDaySchedule(student: Student, settings: AttendanceSettings | undefined, date?: Date): AttendanceDaySchedule | undefined {
  if (!settings) return undefined;
  const schoolDay = date ? attendanceSchoolDayFromDate(date) : undefined;
  const section = getClassSection(student.className);
  const classKey = attendanceClassRuleKey(student.className, student.option);

  if (schoolDay) {
    if (!resolveAttendanceSchoolDays(settings, section).includes(schoolDay)) return undefined;
    const classSchedule = settings.classSchedule?.[classKey]?.[schoolDay];
    if (classSchedule?.lateAfter || classSchedule?.normalArrival) return classSchedule;
    const sectionSchedule = settings.sectionSchedule?.[section]?.[schoolDay];
    if (sectionSchedule?.lateAfter || sectionSchedule?.normalArrival) return sectionSchedule;
    const defaultSchedule = settings.defaultSchedule?.[schoolDay];
    if (defaultSchedule?.lateAfter || defaultSchedule?.normalArrival) return defaultSchedule;
  }

  const legacyClassRule = settings.classLateAfter?.[classKey];
  if (legacyClassRule) return { lateAfter: legacyClassRule };
  const legacySectionRule = settings.sectionLateAfter?.[section];
  if (legacySectionRule) return { lateAfter: legacySectionRule };
  return settings.defaultLateAfter ? { lateAfter: settings.defaultLateAfter } : undefined;
}

export function resolveLateAfterTime(student: Student, settings?: AttendanceSettings, date?: Date) {
  const schedule = resolveAttendanceDaySchedule(student, settings, date);
  return schedule?.lateAfter ?? schedule?.normalArrival;
}

export function resolveAttendanceStatusForArrival(student: Student, selectedStatus: AttendanceStatus, settings: AttendanceSettings | undefined, recordedAt: Date) {
  if (selectedStatus !== "present") return selectedStatus;
  const lateAfterMinutes = parseTimeToMinutes(resolveLateAfterTime(student, settings, recordedAt));
  if (lateAfterMinutes === null) return selectedStatus;
  const arrivalMinutes = recordedAt.getHours() * 60 + recordedAt.getMinutes();
  return arrivalMinutes <= lateAfterMinutes ? "present" : "late";
}

export function attendanceStatusText(status: AttendanceStatus) {
  if (status === "late") return "En retard";
  if (status === "excused") return "Absence justifiée";
  if (status === "absent") return "Absent";
  return "Présent à l'heure";
}
