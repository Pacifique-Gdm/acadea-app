import type { School, SchoolYear } from "../types";

export function resolveDefaultSchoolYear(school: School | undefined, schoolYears: SchoolYear[]) {
  if (!school) return undefined;

  const schoolActiveYear = schoolYears.find((year) => year.id === school.activeSchoolYearId && year.status === "active");
  if (schoolActiveYear) return schoolActiveYear;

  return schoolYears.find((year) => year.status === "active");
}

function schoolYearStart(year: SchoolYear) {
  const named = year.name.match(/(?:^|\D)(\d{4})\s*[-–/]\s*(\d{4})(?:\D|$)/);
  if (named) return Number(named[1]);
  const dated = year.startsAt?.match(/^(\d{4})-/);
  return dated ? Number(dated[1]) : Number.POSITIVE_INFINITY;
}

export function orderSchoolYears(years: readonly SchoolYear[], activeYearId?: string) {
  const active = years.find((year) => year.id === activeYearId && year.status === "active")
    ?? years.find((year) => year.status === "active");
  const activeStart = active ? schoolYearStart(active) : Number.NEGATIVE_INFINITY;
  const group = (year: SchoolYear) => year.id === active?.id ? 0 : schoolYearStart(year) > activeStart ? 1 : 2;
  return [...years].sort((left, right) => {
    const groupDifference = group(left) - group(right);
    if (groupDifference) return groupDifference;
    const yearDifference = group(left) === 2
      ? schoolYearStart(right) - schoolYearStart(left)
      : schoolYearStart(left) - schoolYearStart(right);
    return yearDifference || left.name.localeCompare(right.name, "fr", { numeric: true }) || left.id.localeCompare(right.id);
  });
}
