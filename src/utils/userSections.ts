import type { AppUser, School, SchoolSection } from "../types";
import { getSchoolSections } from "./schoolConfig";
import { normalizeSchoolSections } from "./schoolSections";

type SectionUser = Pick<AppUser, "section" | "sectionIds"> & Partial<Pick<AppUser, "role" | "schoolId">>;
function requiresExplicitScope(user: SectionUser) {
  return ["kindergarten_admin", "primary_admin", "studies_prefect"].includes(user.role ?? "");
}
function validExplicitScope(user: SectionUser) {
  const known = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);
  return Boolean(user.schoolId && Array.isArray(user.sectionIds) && user.sectionIds.length
    && user.sectionIds.every(section => known.has(section)));
}

export function normalizeSectionIds(values: readonly unknown[]): SchoolSection[] {
  return normalizeSchoolSections(values);
}

export function userSectionIds(user: SectionUser): SchoolSection[] {
  const sections = normalizeSectionIds(user.sectionIds ?? []);
  return sections.length ? sections : normalizeSectionIds(user.section ? [user.section] : []);
}

/** Les comptes historiques sans section conservent leur périmètre antérieur non borné. */
export function isSectionAllowed(user: SectionUser, section?: SchoolSection | null): boolean {
  if (requiresExplicitScope(user) && !validExplicitScope(user)) return false;
  const allowed = userSectionIds(user);
  return allowed.length === 0 || Boolean(section && allowed.includes(section));
}

export function filterByAllowedSections<T>(user: SectionUser, values: readonly T[], resolveSection: (value: T) => SchoolSection | undefined): T[] {
  return values.filter((value) => {
    if (requiresExplicitScope(user) && (!value || typeof value !== "object" || !("schoolId" in value) || value.schoolId !== user.schoolId || !("section" in value) || value.section !== resolveSection(value))) return false;
    return isSectionAllowed(user, resolveSection(value));
  });
}

export function sectionsAvailableToUser(user: SectionUser, school: Pick<School, "educationLevels" | "schoolType">): SchoolSection[] {
  if (requiresExplicitScope(user) && !validExplicitScope(user)) return [];
  const configured = getSchoolSections(school);
  const assigned = userSectionIds(user);
  return assigned.length ? configured.filter((section) => assigned.includes(section)) : configured;
}
