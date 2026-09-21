import type { Student } from "../types";

export function normalizeStudentSearch(value: unknown): string;
export function studentSearchFields(student: Partial<Student>): { searchPrefixes: string[]; searchArchived: boolean; sortName: string };
export function studentAlphabeticalKey(student: Partial<Student>): string;
export function compareStudentsAlphabetically<T extends Partial<Student> & { id?: string }>(left: T, right: T): number;
export function isStudentDocument(value: unknown): value is Student;
