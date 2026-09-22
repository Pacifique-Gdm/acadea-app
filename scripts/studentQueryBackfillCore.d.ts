import type { Student } from "../src/types";

type Projection = { sortName: string; searchPrefixes: string[]; searchArchived: boolean };
type Original = Record<string, { existed: boolean; value: unknown }>;
type Plan = { changes: Partial<Projection>; original: Original; projected: Projection; changedFields: string[] };
type Projector = (student: Partial<Student>) => Projection;
type UpdateTime = { seconds: number; nanoseconds: number };

export const TECHNICAL_FIELDS: readonly ["sortName", "searchPrefixes", "searchArchived"];
export function planStudentQueryFields(student: Partial<Student>, projector: Projector): Plan;
export function virtualSecondRun(student: Partial<Student>, firstPlan: Plan, projector: Projector): number;
export function sameUpdateTime(left: UpdateTime | undefined, right: UpdateTime | undefined): boolean;
export function rollbackStudentQueryFields(original: Original, changedFields: string[], deleteValue: unknown): Record<string, unknown>;
