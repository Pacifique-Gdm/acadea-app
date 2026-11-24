import type { ParentProfile, Student, ValvePublication } from "../types";

export const MAX_VALVE_AUDIENCE_PARENTS: number;
export function normalizeValveAudienceVisibility(value: unknown): string;
export function valveStudentClassKey(student: Pick<Student, "className" | "option">): string;
export function isEnrolledValveStudent(student: Pick<Student, "status">): boolean;
export function valveTargetsStudent(publication: Pick<ValvePublication, "visibility" | "targetClassKey">, student: Pick<Student, "className" | "option">): boolean;
export function computeValveAudience(
  publication: Pick<ValvePublication, "visibility" | "targetClassKey" | "schoolId" | "schoolYearId">,
  parents?: Array<Pick<ParentProfile, "id" | "studentIds"> & { schoolId?: string }>,
  students?: Array<Pick<Student, "id" | "parentId" | "className" | "option" | "status" | "schoolId"> & { schoolYearId?: string }>,
): { audienceAll: boolean; audienceParentIds: string[] };
export function valveAudienceDoubt(publication: Partial<ValvePublication>, knownSections?: string[]): string;
