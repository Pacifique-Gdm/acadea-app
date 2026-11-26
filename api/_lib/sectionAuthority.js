// Périmètre de réglage par section (règle unique des sections), côté serveur.
// Même logique que l'écran : src/utils/sectionAuthority.ts (+ getSchoolSections
// de src/utils/schoolConfig.ts et userSectionIds de src/utils/userSections.ts).
// Un test vérifie que les deux côtés donnent toujours le même résultat.

export const SCHOOL_SECTIONS = ["Maternelle", "Primaire", "CTEB", "Secondaire"];
const EDUCATION_LEVEL_CHOICES = ["Maternelle", "Primaire", "CTEB", "Secondaire"];

export function normalizeSchoolSection(value) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  return undefined;
}

function normalizeSchoolSections(values) {
  return SCHOOL_SECTIONS.filter((section) => values.some((value) => normalizeSchoolSection(value) === section));
}

function normalizeEducationLevel(level) {
  const normalized = level.trim().toLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  if (normalized === "primaire uniquement") return "Primaire uniquement";
  if (normalized === "cteb uniquement" || normalized === "cetb uniquement") return "CTEB uniquement";
  if (normalized === "secondaire uniquement") return "Secondaire uniquement";
  if (normalized === "cteb et secondaire") return "CTEB et Secondaire";
  if (normalized === "mixte") return "Mixte";
  return level.trim();
}

function getSchoolEducationLevels(school) {
  if (school.schoolType === "Primaire uniquement") return ["Primaire"];
  if (school.schoolType === "CTEB uniquement") return ["CTEB"];
  if (school.schoolType === "Secondaire uniquement") return ["Secondaire"];
  if (school.schoolType === "CTEB et Secondaire") return ["CTEB", "Secondaire"];
  const levels = (Array.isArray(school.educationLevels) ? school.educationLevels : [])
    .filter((level) => typeof level === "string")
    .map(normalizeEducationLevel)
    .flatMap((level) => {
      if (level === "Primaire uniquement") return ["Primaire"];
      if (level === "CTEB uniquement") return ["CTEB"];
      if (level === "Secondaire uniquement") return ["Secondaire"];
      if (level === "CTEB et Secondaire") return ["CTEB", "Secondaire"];
      if (level === "Mixte") return EDUCATION_LEVEL_CHOICES;
      return [level];
    })
    .filter(Boolean);
  if (levels.length > 0) {
    const uniqueLevels = Array.from(new Set(levels));
    return EDUCATION_LEVEL_CHOICES.filter((level) => uniqueLevels.includes(level));
  }
  if (school.schoolType === "Mixte") return EDUCATION_LEVEL_CHOICES;
  if (school.schoolType === "CTEB") return ["Maternelle", "Primaire", "CTEB"];
  if (school.schoolType === "Secondaire") return ["Maternelle", "Primaire", "CTEB", "Secondaire"];
  return school.schoolType ? [school.schoolType] : EDUCATION_LEVEL_CHOICES;
}

/** Sections de l'école (même calcul que getSchoolSections de l'écran). */
export function getSchoolSections(school = {}) {
  const sections = getSchoolEducationLevels(school || {}).map(normalizeSchoolSection).filter(Boolean);
  return SCHOOL_SECTIONS.filter((section) => sections.includes(section));
}

/** Sections d'un compte `users` : `sectionIds`, sinon `section`. */
export function userSectionIds(user = {}) {
  const sections = normalizeSchoolSections(Array.isArray(user?.sectionIds) ? user.sectionIds : []);
  return sections.length ? sections : normalizeSchoolSections(user?.section ? [user.section] : []);
}

/**
 * Dit si le compte agit pour toute l'école et sur quelles sections.
 * `options.sectionSettingsManagers` (section → identifiant du compte désigné) est
 * le point d'extension du lot R6 : NON UTILISÉ pour l'instant.
 */
export function resolveSectionAuthority(user, school, options = {}) {
  const schoolSections = getSchoolSections(school);
  const assigned = userSectionIds(user);
  const wholeSchool = assigned.length === 0
    || (schoolSections.length > 0 && schoolSections.every((section) => assigned.includes(section)));
  return {
    wholeSchool,
    sections: wholeSchool ? [...schoolSections] : schoolSections.filter((section) => assigned.includes(section)),
    schoolSections,
  };
}

/** Section(s) vides = « toute l'école » : réservé à un compte qui agit pour toute l'école. */
export function canManageSections(authority, sections) {
  if (authority.wholeSchool) return true;
  if (!Array.isArray(sections) || sections.length === 0) return false;
  return sections.every((section) => authority.sections.includes(section));
}
