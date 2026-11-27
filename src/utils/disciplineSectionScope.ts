import type { AppUser, AttendanceRecord, DisciplineSanction, ParentProfile, Student } from "../types";
import { getStudentSection } from "./studentClasses";
import { userSectionIds } from "./userSections";

/** Le compte a-t-il des sections renseignées (valides ou non) ? */
export function hasDeclaredSections(user: Pick<AppUser, "section" | "sectionIds">) {
  return Boolean(user.sectionIds?.length || user.section);
}

export function disciplineStudentScope(user: Pick<AppUser, "role" | "section" | "sectionIds">, students: readonly Student[]) {
  if (user.role !== "discipline_director") return [...students];
  const assigned = userSectionIds(user);
  // Règle unique des sections (lot B) : sans section = toute l'école.
  // Sections renseignées mais toutes invalides : aucun élève (jamais élargi).
  if (assigned.length === 0) return hasDeclaredSections(user) ? [] : [...students];
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
