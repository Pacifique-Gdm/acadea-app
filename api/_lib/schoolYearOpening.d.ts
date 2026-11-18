export function normalizeSchoolYearName(name: unknown): string;
export function schoolYearStartOf(name: unknown): number | null;
export function schoolYearDatesFromName(name: unknown): { startsAt: string; endsAt: string } | null;
export function currentSchoolYearStart(now?: Date): number;
export function schoolYearOpeningDecision(name: unknown, options?: { now?: Date; existingNames?: readonly string[] }):
  | { ok: true; name: string; startsAt: string; endsAt: string }
  | { ok: false; code: "invalid-name" | "year-too-early" | "year-in-past" | "year-already-exists"; message: string };
