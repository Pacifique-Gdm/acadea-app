function schoolOptionKey(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

const sciencesAliases = new Set(["science", "sciences", "scientifique", "section scientifique"]);

export const SCHOOL_OPTION_DELETE_CONFIRMATION = "SUPPRIMER CETTE OPTION";

export function isSchoolOptionDeleteConfirmation(value: string) {
  return value === SCHOOL_OPTION_DELETE_CONFIRMATION;
}

/** Canonicalise uniquement un libellé du référentiel des options scolaires. */
export function canonicalSchoolOption(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return sciencesAliases.has(schoolOptionKey(trimmed)) ? "Sciences" : trimmed;
}

function normalizedStrings(values: unknown[]) {
  const options = new Map<string, string>();
  values
    .filter((value): value is string => typeof value === "string")
    .map(canonicalSchoolOption)
    .filter(Boolean)
    .forEach((option) => {
      const key = schoolOptionKey(option);
      if (!options.has(key)) options.set(key, option);
    });
  return [...options.values()];
}

/** Normalise le tableau actuel et les anciennes représentations Firestore connues. */
export function normalizeSchoolOptions(value: unknown): string[] {
  if (Array.isArray(value)) return normalizedStrings(value);
  if (!value || typeof value !== "object") return [];

  const legacy = value as Record<string, unknown>;
  for (const field of ["options", "values", "items"]) {
    if (Array.isArray(legacy[field])) return normalizedStrings(legacy[field]);
  }

  return normalizedStrings(
    Object.entries(legacy).flatMap(([option, enabled]) => {
      if (enabled === true) return [option];
      if (typeof enabled === "string") return [enabled];
      return [];
    }),
  );
}

export function mergeSchoolOptions(current: unknown, additions: readonly string[]) {
  return normalizedStrings([...normalizeSchoolOptions(current), ...additions]);
}

export type SchoolOptionStudentReference = {
  schoolId?: unknown;
  option?: unknown;
};

/**
 * Builds the canonical school option list from legacy student values without
 * modifying students. The school id and all school years are considered
 * because an option is a school-level reference, not a year-level setting.
 */
export function reconcileSchoolOptionsFromStudents(current: unknown, students: readonly SchoolOptionStudentReference[], schoolId: string) {
  const legacyOptions = students
    .filter((student) => student.schoolId === schoolId)
    .map((student) => (typeof student.option === "string" ? student.option : ""));
  return mergeSchoolOptions(current, legacyOptions);
}

/** Préserve les ajouts concurrents tout en appliquant les retraits du formulaire. */
export function reconcileSchoolOptions(current: unknown, baseline: unknown, desired: unknown) {
  const currentOptions = normalizeSchoolOptions(current);
  const baselineKeys = new Set(normalizeSchoolOptions(baseline).map(schoolOptionKey));
  const desiredOptions = normalizeSchoolOptions(desired);
  const desiredKeys = new Set(desiredOptions.map(schoolOptionKey));
  const removedKeys = new Set([...baselineKeys].filter((key) => !desiredKeys.has(key)));
  const retained = currentOptions.filter((option) => !removedKeys.has(schoolOptionKey(option)));
  const additions = desiredOptions.filter((option) => !baselineKeys.has(schoolOptionKey(option)));
  return normalizedStrings([...retained, ...additions]);
}
