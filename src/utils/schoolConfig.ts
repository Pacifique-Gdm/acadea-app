import type { School } from "../types";
import { CLASSES } from "../types";
import { getClassSection } from "./studentClasses";

export type SchoolLevelChoice = "Maternelle" | "Primaire" | "Secondaire" | "Primaire uniquement" | "Secondaire uniquement";

const schoolEducationLevelChoices = ["Maternelle", "Primaire", "Secondaire"];

export function educationLevelsForSchoolLevel(level: SchoolLevelChoice) {
  if (level === "Maternelle") return ["Maternelle"];
  if (level === "Primaire uniquement") return ["Primaire"];
  if (level === "Secondaire uniquement") return ["Secondaire"];
  if (level === "Primaire") return ["Maternelle", "Primaire"];
  return ["Maternelle", "Primaire", "Secondaire"];
}

export function normalizeEducationLevel(level: string): string {
  const normalized = level.trim().toLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "secondaire") return "Secondaire";
  if (normalized === "primaire uniquement") return "Primaire uniquement";
  if (normalized === "secondaire uniquement") return "Secondaire uniquement";
  if (normalized === "mixte") return "Mixte";
  return level.trim();
}

export function getSchoolEducationLevels(school: Pick<School, "educationLevels" | "schoolType">) {
  const levels = (school.educationLevels ?? [])
    .map(normalizeEducationLevel)
    .flatMap((level) => {
      if (level === "Primaire uniquement") return ["Primaire"];
      if (level === "Secondaire uniquement") return ["Secondaire"];
      if (level === "Mixte") return schoolEducationLevelChoices;
      return [level];
    })
    .filter(Boolean);
  if (levels.length > 0) return Array.from(new Set(levels));
  if (school.schoolType === "Mixte") return schoolEducationLevelChoices;
  if (school.schoolType === "Primaire uniquement") return ["Primaire"];
  if (school.schoolType === "Secondaire uniquement") return ["Secondaire"];
  return school.schoolType ? [school.schoolType] : schoolEducationLevelChoices;
}

export function getSchoolClassChoices(school: Pick<School, "educationLevels" | "schoolType">) {
  const levels = getSchoolEducationLevels(school);
  if (levels.includes("Mixte")) return CLASSES;
  const sections = levels
    .map((level) => (level === "Maternelle" ? "maternelle" : level === "Primaire" ? "primaire" : level === "Secondaire" ? "secondaire" : ""))
    .filter(Boolean);
  return sections.length > 0 ? CLASSES.filter((className) => sections.includes(getClassSection(className))) : CLASSES;
}

export function schoolLevelFromConfig(school: Pick<School, "educationLevels" | "schoolType">): SchoolLevelChoice {
  const levels = getSchoolEducationLevels(school);
  const hasMaternelle = levels.includes("Maternelle");
  const hasPrimaire = levels.includes("Primaire");
  const hasSecondaire = levels.includes("Secondaire");
  if (hasSecondaire && !hasMaternelle && !hasPrimaire) return "Secondaire uniquement";
  if (hasPrimaire && !hasMaternelle && !hasSecondaire) return "Primaire uniquement";
  if (hasSecondaire) return "Secondaire";
  if (hasPrimaire) return "Primaire";
  return "Maternelle";
}
