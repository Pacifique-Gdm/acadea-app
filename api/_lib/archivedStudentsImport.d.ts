import type { SchoolClassRecord, Student } from "../../src/types";
import type { ArchivedStudentsImportStatus } from "../../src/services/provisioning";
export const ARCHIVED_IMPORT_CHUNK_SIZE: number;
export const TERMINAL_REENROLLMENT_CONFIRMATION: string;
export function importedStudentDocument(source: Student, schoolId: string, yearId: string, classes: SchoolClassRecord[], school?: Record<string, unknown>): Student | undefined;
export function importArchivedStudents(input: {
  db: unknown; caller: { uid: string; role?: string; schoolId?: string }; body: Record<string, unknown>;
}): Promise<ArchivedStudentsImportStatus>;
export function reenrollTerminalStudent(input: {
  db: unknown; caller: { uid: string; role?: string; schoolId?: string }; body: Record<string, unknown>;
}): Promise<Record<string, unknown>>;
