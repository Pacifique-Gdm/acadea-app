import type { AppUser, AttendanceRecord, DisciplineSanction, ParentProfile, Student } from "../types";
import { getStudentSection } from "./studentClasses";
import { userSectionIds } from "./userSections";

export function disciplineStudentScope(user: Pick<AppUser, "role" | "section" | "sectionIds">, students: readonly Student[]) {
  if (user.role !== "discipline_director") return [...students];
  const assigned = userSectionIds(user);
  if (assigned.length === 0) return [];
  return students.filter((student) => assigned.includes(getStudentSection(student)));
}

export function disciplineParentScope(user: Pick<AppUser, "role" | "section" | "sectionIds">, parents: readonly ParentProfile[], students: readonly Student[]) {
  const allowedStudentIds = new Set(disciplineStudentScope(user, students).map((student) => student.id));
  if (user.role !== "discipline_director") return [...parents];
  return parents.filter((parent) => parent.studentIds.some((studentId) => allowedStudentIds.has(studentId)));
}

export function disciplineSanctionScope(user: Pick<AppUser, "role" | "section" | "sectionIds">, sanctions: readonly DisciplineSanction[], students: readonly Student[]) {
  const allowedStudentIds = new Set(disciplineStudentScope(user, students).map((student) => student.id));
  if (user.role !== "discipline_director") return [...sanctions];
  return sanctions.filter((sanction) => allowedStudentIds.has(sanction.studentId));
}

export function disciplineAttendanceScope(user: Pick<AppUser, "role" | "section" | "sectionIds">, records: readonly AttendanceRecord[], students: readonly Student[]) {
  const allowedStudentIds = new Set(disciplineStudentScope(user, students).map((student) => student.id));
  if (user.role !== "discipline_director") return [...records];
  return records.filter((record) => allowedStudentIds.has(record.studentId));
}
