import type { AttendanceSettings, AttendanceStatus, Student } from "../types";
import { getClassSection } from "./studentClasses";

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

export function resolveLateAfterTime(student: Student, settings?: AttendanceSettings) {
  if (!settings) return undefined;
  const classRule = settings.classLateAfter?.[attendanceClassRuleKey(student.className, student.option)];
  if (classRule) return classRule;
  const sectionRule = settings.sectionLateAfter?.[getClassSection(student.className)];
  return sectionRule || settings.defaultLateAfter;
}

export function resolveAttendanceStatusForArrival(student: Student, selectedStatus: AttendanceStatus, settings: AttendanceSettings | undefined, recordedAt: Date) {
  if (selectedStatus !== "present") return selectedStatus;
  const lateAfterMinutes = parseTimeToMinutes(resolveLateAfterTime(student, settings));
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
