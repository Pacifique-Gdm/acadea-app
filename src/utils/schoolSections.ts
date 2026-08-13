import type { SchoolSection } from "../types";

export const SCHOOL_SECTIONS: readonly SchoolSection[] = [
  "Maternelle",
  "Primaire",
  "CTEB",
  "Secondaire",
];

export function normalizeSchoolSection(
  value: unknown,
): SchoolSection | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  return undefined;
}
export function normalizeSchoolSections(
  values: readonly unknown[],
): SchoolSection[] {
  return SCHOOL_SECTIONS.filter((section) =>
    values.some((value) => normalizeSchoolSection(value) === section),
  );
}

export function legacySectionQueryValues(
  sections: readonly SchoolSection[],
): string[] {
  return [
    ...new Set(
      sections.flatMap((section) =>
        section === "CTEB"
          ? ["CTEB", "cteb", "CETB", "cetb"]
          : [section, section.toLocaleLowerCase()],
      ),
    ),
  ];
}

export function normalizeSectionField<T extends object>(
  value: T,
): T & { section?: SchoolSection; sectionIds?: SchoolSection[] } {
  const fields = value as T & { section?: unknown; sectionIds?: unknown };
  const section = normalizeSchoolSection(fields.section);
  const sectionIds = Array.isArray(fields.sectionIds)
    ? normalizeSchoolSections(fields.sectionIds)
    : undefined;
  return {
    ...value,
    ...(section ? { section } : {}),
    ...(sectionIds?.length ? { sectionIds } : {}),
  };
}
