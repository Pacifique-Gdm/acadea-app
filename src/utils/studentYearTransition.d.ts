import type { SchoolClass, SchoolSection, Student } from "../types";
export const CLASSES: SchoolClass[];
export function getClassSection(className: SchoolClass): SchoolSection;
export function promoteStudentForNewYear(student: Student): {
  className: SchoolClass; option?: string; promoted: boolean;
  transition?: "maternelle-primaire" | "primaire-cteb" | "cteb-humanites"; optionPending: boolean;
};
export function studentForPersistence<T>(value: T): T;
export function studentImportKey(student: Pick<Student, "matricule" | "nom" | "postnom" | "prenom" | "birthDate">): string;
