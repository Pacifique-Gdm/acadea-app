import type { AppUser, School, SchoolSection } from "../types";
import { getSchoolSections } from "./schoolConfig";

const validSections = new Set<SchoolSection>(["maternelle", "primaire", "cteb", "secondaire"]);

export function normalizeSectionIds(values: readonly unknown[]): SchoolSection[] {
  return [...new Set(values.flatMap((value): SchoolSection[] => {
    if (typeof value !== "string") return [];
    const lowered = value.trim().toLocaleLowerCase();
    const normalized = lowered === "cetb" ? "cteb" : lowered;
    return validSections.has(normalized as SchoolSection) ? [normalized as SchoolSection] : [];
  }))];
}

export function userSectionIds(user: Pick<AppUser, "section" | "sectionIds">): SchoolSection[] {
  const sections = normalizeSectionIds(user.sectionIds ?? []);
  return sections.length ? sections : normalizeSectionIds(user.section ? [user.section] : []);
}

/** Les comptes historiques sans section conservent leur périmètre antérieur non borné. */
export function isSectionAllowed(user: Pick<AppUser, "section" | "sectionIds">, section?: SchoolSection | null): boolean {
  const allowed = userSectionIds(user);
  return allowed.length === 0 || Boolean(section && allowed.includes(section));
}

export function filterByAllowedSections<T>(user: Pick<AppUser, "section" | "sectionIds">, values: readonly T[], resolveSection: (value: T) => SchoolSection | undefined): T[] {
  return values.filter((value) => isSectionAllowed(user, resolveSection(value)));
}

export function sectionsAvailableToUser(user: Pick<AppUser, "section" | "sectionIds">, school: Pick<School, "educationLevels" | "schoolType">): SchoolSection[] {
  const configured = getSchoolSections(school);
  const assigned = userSectionIds(user);
  return assigned.length ? configured.filter((section) => assigned.includes(section)) : configured;
}
