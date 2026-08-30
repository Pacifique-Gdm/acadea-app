import type { SchoolClassRecord, Student } from "../../src/types";
import type { ArchivedStudentsImportStatus } from "../../src/services/provisioning";
export const ARCHIVED_IMPORT_CHUNK_SIZE: number;
export function importedStudentDocument(source: Student, schoolId: string, yearId: string, classes: SchoolClassRecord[]): Student;
export function importArchivedStudents(input: {
  db: unknown; caller: { uid: string; role?: string; schoolId?: string }; body: Record<string, unknown>;
}): Promise<ArchivedStudentsImportStatus>;
