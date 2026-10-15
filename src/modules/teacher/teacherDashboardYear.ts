import type { School, SchoolYear } from "../../types";

export type TeacherDashboardYear =
  | { status: "active"; year: SchoolYear }
  | { status: "missing" | "inconsistent" };

export function teacherDashboardYear(school: Pick<School, "id"> & { activeSchoolYearId?: School["activeSchoolYearId"] }, years: SchoolYear[]): TeacherDashboardYear {
  const scoped = years.filter((year) => year.schoolId === school.id);
  if (school.activeSchoolYearId) {
    const selected = scoped.find((year) => year.id === school.activeSchoolYearId);
    return selected?.status === "active" ? { status: "active", year: selected } : { status: "inconsistent" };
  }
  const active = scoped.filter((year) => year.status === "active");
  if (active.length > 1) return { status: "inconsistent" };
  return active.length === 1 ? { status: "active", year: active[0] } : { status: "missing" };
}
