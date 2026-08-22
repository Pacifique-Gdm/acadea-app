import type { School, Student } from "../types";
import { canonicalSchoolOption } from "./schoolOptions";
import { isArchivedStudent } from "./studentUtils";

export type CoordinationStudentStatus = "active" | "archived" | "all";

export type ScopedChoice = {
  value: string;
  label: string;
  schoolId: string;
};

export function coordinationStudentClassKey(student: Pick<Student, "schoolId" | "classId" | "className">) {
  return `${student.schoolId}::${student.classId || student.className}`;
}

export function coordinationStudentOptionKey(student: Pick<Student, "schoolId" | "classOptionKey" | "option">) {
  const option = student.classOptionKey || canonicalSchoolOption(student.option ?? "");
  return option ? `${student.schoolId}::${option}` : "";
}

export function buildCoordinationClassChoices(students: readonly Student[], schools: readonly School[], selectedSchoolId: string) {
  const schoolNames = new Map(schools.map((school) => [school.id, school.name]));
  const byKey = new Map<string, ScopedChoice>();
  students.forEach((student) => {
    if (selectedSchoolId && student.schoolId !== selectedSchoolId) return;
    const value = coordinationStudentClassKey(student);
    if (byKey.has(value)) return;
    const schoolContext = selectedSchoolId ? "" : ` — ${schoolNames.get(student.schoolId) ?? student.schoolId}`;
    byKey.set(value, { value, label: `${student.className}${schoolContext}`, schoolId: student.schoolId });
  });
  return [...byKey.values()].sort((left, right) => left.label.localeCompare(right.label, "fr"));
}

export function buildCoordinationOptionChoices(students: readonly Student[], schools: readonly School[], selectedSchoolId: string, classKey = "") {
  const schoolNames = new Map(schools.map((school) => [school.id, school.name]));
  const byKey = new Map<string, ScopedChoice>();
  students.forEach((student) => {
    if (selectedSchoolId && student.schoolId !== selectedSchoolId) return;
    if (classKey && coordinationStudentClassKey(student) !== classKey) return;
    const value = coordinationStudentOptionKey(student);
    if (!value || byKey.has(value)) return;
    const schoolContext = selectedSchoolId ? "" : ` — ${schoolNames.get(student.schoolId) ?? student.schoolId}`;
    byKey.set(value, { value, label: `${student.option ?? "Option"}${schoolContext}`, schoolId: student.schoolId });
  });
  return [...byKey.values()].sort((left, right) => left.label.localeCompare(right.label, "fr"));
}

export function filterCoordinationStudents(input: {
  students: readonly Student[];
  selectedSchoolId: string;
  search: string;
  status: CoordinationStudentStatus;
  classKey: string;
  optionKey: string;
}) {
  const search = input.search.trim().toLocaleLowerCase("fr");
  return input.students.filter((student) => {
    const archived = isArchivedStudent(student);
    const searchable = `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom} ${student.className} ${student.option ?? ""}`.toLocaleLowerCase("fr");
    return (!input.selectedSchoolId || student.schoolId === input.selectedSchoolId)
      && (!search || searchable.includes(search))
      && (input.status === "all" || (input.status === "archived" ? archived : !archived))
      && (!input.classKey || coordinationStudentClassKey(student) === input.classKey)
      && (!input.optionKey || coordinationStudentOptionKey(student) === input.optionKey);
  });
}
