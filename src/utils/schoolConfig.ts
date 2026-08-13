import type { School, SchoolSection } from "../types";
import { CLASSES } from "../types";
import { getClassSection } from "./studentClasses";
import { SCHOOL_SECTIONS, normalizeSchoolSection } from "./schoolSections";

export type SchoolLevelChoice = "Maternelle" | "Primaire" | "CTEB" | "Secondaire" | "Primaire uniquement" | "CTEB uniquement" | "Secondaire uniquement";

export const schoolEducationLevelChoices = ["Maternelle", "Primaire", "CTEB", "Secondaire"];

export const schoolSectionOrder: SchoolSection[] = [...SCHOOL_SECTIONS];

export const schoolSectionLabels: Record<SchoolSection, string> = {
  Maternelle: "Maternelle",
  Primaire: "Primaire",
  CTEB: "CTEB",
  Secondaire: "Secondaire",
};

export function educationLevelsForSchoolLevel(level: SchoolLevelChoice) {
  if (level === "Maternelle") return ["Maternelle"];
  if (level === "Primaire uniquement") return ["Primaire"];
  if (level === "CTEB uniquement") return ["CTEB"];
  if (level === "Secondaire uniquement") return ["Secondaire"];
  if (level === "Primaire") return ["Maternelle", "Primaire"];
  if (level === "CTEB") return ["Maternelle", "Primaire", "CTEB"];
  return ["Maternelle", "Primaire", "CTEB", "Secondaire"];
}

export function normalizeEducationLevel(level: string): string {
  const normalized = level.trim().toLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  if (normalized === "primaire uniquement") return "Primaire uniquement";
  if (normalized === "cteb uniquement" || normalized === "cetb uniquement") return "CTEB uniquement";
  if (normalized === "secondaire uniquement") return "Secondaire uniquement";
  if (normalized === "mixte") return "Mixte";
  return level.trim();
}

export function getSchoolEducationLevels(school: Pick<School, "educationLevels" | "schoolType">) {
  if (school.schoolType === "Primaire uniquement") return ["Primaire"];
  if (school.schoolType === "CTEB uniquement") return ["CTEB"];
  if (school.schoolType === "Secondaire uniquement") return ["Secondaire"];
  const levels = (school.educationLevels ?? [])
    .map(normalizeEducationLevel)
    .flatMap((level) => {
      if (level === "Primaire uniquement") return ["Primaire"];
      if (level === "CTEB uniquement") return ["CTEB"];
      if (level === "Secondaire uniquement") return ["Secondaire"];
      if (level === "Mixte") return schoolEducationLevelChoices;
      return [level];
    })
    .filter(Boolean);
  if (levels.length > 0) {
    const uniqueLevels = Array.from(new Set(levels));
    return schoolEducationLevelChoices.filter((level) => uniqueLevels.includes(level));
  }
  if (school.schoolType === "Mixte") return schoolEducationLevelChoices;
  if (school.schoolType === "CTEB") return ["Maternelle", "Primaire", "CTEB"];
  if (school.schoolType === "Secondaire") return ["Maternelle", "Primaire", "CTEB", "Secondaire"];
  return school.schoolType ? [school.schoolType] : schoolEducationLevelChoices;
}

export function toggleSchoolEducationLevel(levels: readonly string[], level: string): string[] {
  const current = Array.from(new Set(levels.map(normalizeEducationLevel).filter((item) => schoolEducationLevelChoices.includes(item))));
  const target = normalizeEducationLevel(level);
  if (current.includes(target)) {
    const next = current.filter((item) => item !== target);
    return next.length ? next : current;
  }
  return schoolEducationLevelChoices.filter((item) => [...current, target].includes(item));
}

export function schoolSectionFromEducationLevel(level: string): SchoolSection | "" {
  return normalizeSchoolSection(level) ?? "";
}

export function getSchoolSections(school: Pick<School, "educationLevels" | "schoolType">): SchoolSection[] {
  const sections = getSchoolEducationLevels(school)
    .map(schoolSectionFromEducationLevel)
    .filter((section): section is SchoolSection => Boolean(section));
  return schoolSectionOrder.filter((section) => sections.includes(section));
}

export function getSchoolClassChoices(school: Pick<School, "educationLevels" | "schoolType">) {
  const levels = getSchoolEducationLevels(school);
  if (levels.includes("Mixte")) return CLASSES;
  const sections = getSchoolSections(school);
  return sections.length > 0 ? CLASSES.filter((className) => sections.includes(getClassSection(className))) : CLASSES;
}

export function schoolLevelFromConfig(school: Pick<School, "educationLevels" | "schoolType">): SchoolLevelChoice {
  const levels = getSchoolEducationLevels(school);
  const hasMaternelle = levels.includes("Maternelle");
  const hasPrimaire = levels.includes("Primaire");
  const hasCteb = levels.includes("CTEB");
  const hasSecondaire = levels.includes("Secondaire");
  if (hasSecondaire && !hasMaternelle && !hasPrimaire && !hasCteb) return "Secondaire uniquement";
  if (hasCteb && !hasMaternelle && !hasPrimaire && !hasSecondaire) return "CTEB uniquement";
  if (hasPrimaire && !hasMaternelle && !hasCteb && !hasSecondaire) return "Primaire uniquement";
  if (hasSecondaire) return "Secondaire";
  if (hasCteb) return "CTEB";
  if (hasPrimaire) return "Primaire";
  return "Maternelle";
}
