import type { ParentProfile, SchoolClass, SchoolSection, Student } from "../types";
import { CLASSES } from "../types";

export type ParentsDirectoryChild = Student & {
  displayName: string;
  classLabel: string;
  statusLabel: string;
};

export type ParentsDirectoryEntry = {
  parent: ParentProfile;
  children: ParentsDirectoryChild[];
  searchableText: string;
};

type DirectoryScope = {
  schoolId: string;
  schoolYearId: string;
};

export function fallbackText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "Non renseigné";
}

export function normalizeParentsDirectorySearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function getClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

export function formatDirectoryStudentName(student: Pick<Student, "nom" | "postnom" | "prenom">) {
  return [student.nom, student.postnom, student.prenom].map((part) => part.trim()).filter(Boolean).join(" ") || "Non renseigné";
}

export function formatDirectoryStudentClass(student: Pick<Student, "className" | "option">) {
  if (getClassSection(student.className) !== "secondaire") return student.className;
  const option = student.option?.trim();
  if (!option) return student.className;
  const classLabel = student.className.replace(/\s+Humanit[ée]s?$/i, "").trim();
  return `${classLabel || student.className} ${option}`;
}

export function formatDirectoryStudentStatus(student: Pick<Student, "status">) {
  return !student.status || student.status === "ACTIVE" ? "Actif" : "Archivé";
}

export function buildParentsDirectory(parents: ParentProfile[], students: Student[], scope: DirectoryScope) {
  const scopedStudents = students.filter((student) => student.schoolId === scope.schoolId && student.schoolYearId === scope.schoolYearId);
  const scopedStudentIds = new Set(scopedStudents.map((student) => student.id));
  const studentsByParentId = new Map<string, Student[]>();

  for (const student of scopedStudents) {
    if (!student.parentId) continue;
    const current = studentsByParentId.get(student.parentId) ?? [];
    current.push(student);
    studentsByParentId.set(student.parentId, current);
  }

  const entries = parents
    .filter(
      (parent) =>
        parent.schoolId === scope.schoolId &&
        (parent.schoolYearId === scope.schoolYearId ||
          studentsByParentId.has(parent.id) ||
          parent.studentIds.some((studentId) => scopedStudentIds.has(studentId))),
    )
    .map((parent) => {
      const childrenById = new Map<string, Student>();
      for (const student of studentsByParentId.get(parent.id) ?? []) {
        childrenById.set(student.id, student);
      }
      for (const studentId of parent.studentIds) {
        const student = scopedStudents.find((candidate) => candidate.id === studentId);
        if (student) childrenById.set(student.id, student);
      }

      const children = Array.from(childrenById.values())
        .map((student) => ({
          ...student,
          displayName: formatDirectoryStudentName(student),
          classLabel: formatDirectoryStudentClass(student),
          statusLabel: formatDirectoryStudentStatus(student),
        }))
        .sort((first, second) => {
          const firstClassIndex = CLASSES.indexOf(first.className);
          const secondClassIndex = CLASSES.indexOf(second.className);
          if (firstClassIndex !== secondClassIndex) return firstClassIndex - secondClassIndex;
          return first.displayName.localeCompare(second.displayName, "fr");
        });

      const searchableText = normalizeParentsDirectorySearch(
        [
          parent.fullName,
          parent.phone,
          parent.email,
          parent.address,
          ...children.flatMap((child) => [
            child.displayName,
            child.matricule,
            child.className,
            child.option ?? "",
            child.classLabel,
            child.statusLabel,
          ]),
        ].join(" "),
      );

      return { parent, children, searchableText };
    })
    .sort((first, second) => first.parent.fullName.localeCompare(second.parent.fullName, "fr"));

  return entries;
}

export function filterParentsDirectory(entries: ParentsDirectoryEntry[], query: string) {
  const normalizedQuery = normalizeParentsDirectorySearch(query);
  if (!normalizedQuery) return entries;
  return entries.filter((entry) => entry.searchableText.includes(normalizedQuery));
}
