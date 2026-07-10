import type { School, SchoolYear } from "../types";

export function resolveDefaultSchoolYear(school: School | undefined, schoolYears: SchoolYear[]) {
  if (!school) return undefined;

  const schoolActiveYear = schoolYears.find((year) => year.id === school.activeSchoolYearId && year.status === "active");
  if (schoolActiveYear) return schoolActiveYear;

  return schoolYears.find((year) => year.status === "active");
}
