import type { SchoolClass, SchoolSection, Student } from "../types";
export const CLASSES: SchoolClass[];
export const ANNUAL_TRANSITION_RESULTS: Readonly<{
  PROMOTED: "PROMOTED";
  TERMINAL_EXIT: "TERMINAL_EXIT";
  SCHOOL_CYCLE_EXIT: "SCHOOL_CYCLE_EXIT";
  SKIPPED_INACTIVE: "SKIPPED_INACTIVE";
}>;
export function normalizeAnnualClassName(value: unknown): string;
export function canonicalAnnualClassName(value: unknown): SchoolClass | undefined;
export function getClassSection(className: SchoolClass): SchoolSection;
export function isEligibleForAnnualTransition(student: Partial<Student> & { active?: boolean; archivedAt?: string }): boolean;
export function annualStudentTransition(student: Omit<Partial<Student>, "className"> & { className?: string; active?: boolean; archivedAt?: string }, targetClassAvailable?: boolean): {
  result: "PROMOTED" | "TERMINAL_EXIT" | "SCHOOL_CYCLE_EXIT" | "SKIPPED_INACTIVE" | "INVALID_CLASS";
  sourceClassName?: SchoolClass;
  className?: SchoolClass;
  option?: string;
  promoted?: boolean;
  transition?: "maternelle-primaire" | "primaire-cteb" | "cteb-humanites";
  optionPending?: boolean;
};
export function promoteStudentForNewYear(student: Student): {
  className: SchoolClass; option?: string; promoted: boolean;
  transition?: "maternelle-primaire" | "primaire-cteb" | "cteb-humanites"; optionPending: boolean;
  result?: string;
};
export function studentForPersistence<T>(value: T): T;
export function studentImportKey(student: Pick<Student, "matricule" | "nom" | "postnom" | "prenom" | "birthDate">): string;
