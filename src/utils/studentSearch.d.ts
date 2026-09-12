import type { Student } from "../types";

export function normalizeStudentSearch(value: unknown): string;
export function studentSearchFields(student: Partial<Student>): { searchPrefixes: string[]; searchArchived: boolean };
export function isStudentDocument(value: unknown): value is Student;
