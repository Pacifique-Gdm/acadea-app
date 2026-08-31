// Shared by the browser and the authoritative annual transition API. Keep this
// module Firebase-free so every business branch can be covered by unit tests.
export const CLASSES = [
  "Maternelle 1", "Maternelle 2", "Maternelle 3",
  "1ère Primaire", "2ème Primaire", "3ème Primaire", "4ème Primaire", "5ème Primaire", "6ème Primaire",
  "7ème CTEB", "8ème CTEB", "1ère Humanité", "2ème Humanité", "3ème Humanité", "4ème Humanité",
];

export const ANNUAL_TRANSITION_RESULTS = Object.freeze({
  PROMOTED: "PROMOTED",
  TERMINAL_EXIT: "TERMINAL_EXIT",
  SCHOOL_CYCLE_EXIT: "SCHOOL_CYCLE_EXIT",
  SKIPPED_INACTIVE: "SKIPPED_INACTIVE",
});

export function normalizeAnnualClassName(value) {
  if (typeof value !== "string") return "";
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  return normalized.replace(/\bcetb\b/g, "cteb").replace(/humanites/g, "humanite");
}

export function canonicalAnnualClassName(value) {
  const normalized = normalizeAnnualClassName(value);
  return CLASSES.find((item) => normalizeAnnualClassName(item) === normalized);
}

export function getClassSection(className) {
  const canonical = canonicalAnnualClassName(className) ?? className;
  if (canonical.includes("Maternelle")) return "Maternelle";
  if (canonical.includes("CTEB")) return "CTEB";
  if (/\b(scientifique|sciences)\b/i.test(canonical) || canonical.includes("Humanité")) return "Secondaire";
  return "Primaire";
}

export function isEligibleForAnnualTransition(student) {
  const status = typeof student?.status === "string" ? student.status.toUpperCase() : "ACTIVE";
  return status === "ACTIVE" && !student?.deletedAt && !student?.archivedAt && student?.active !== false;
}

export function annualStudentTransition(student, targetClassAvailable = true) {
  if (!isEligibleForAnnualTransition(student)) return { result: ANNUAL_TRANSITION_RESULTS.SKIPPED_INACTIVE };
  const sourceClass = canonicalAnnualClassName(student?.className);
  if (!sourceClass) return { result: "INVALID_CLASS", sourceClassName: student?.className };
  const classIndex = CLASSES.indexOf(sourceClass);
  if (classIndex === CLASSES.length - 1) return { result: ANNUAL_TRANSITION_RESULTS.TERMINAL_EXIT, sourceClassName: sourceClass };
  const className = CLASSES[classIndex + 1];
  if (!targetClassAvailable) return { result: ANNUAL_TRANSITION_RESULTS.SCHOOL_CYCLE_EXIT, sourceClassName: sourceClass, className };
  const transition = sourceClass === CLASSES[2] ? "maternelle-primaire"
    : sourceClass === CLASSES[8] ? "primaire-cteb"
      : sourceClass === CLASSES[10] ? "cteb-humanites" : undefined;
  const optionPending = transition === "cteb-humanites";
  return {
    result: ANNUAL_TRANSITION_RESULTS.PROMOTED,
    sourceClassName: sourceClass,
    className,
    ...(!optionPending && student.option !== undefined ? { option: student.option } : {}),
    promoted: true,
    transition,
    optionPending,
  };
}

// Backward-compatible name used by existing UI helpers.
export function promoteStudentForNewYear(student) {
  const transition = annualStudentTransition(student, true);
  if (transition.result !== ANNUAL_TRANSITION_RESULTS.PROMOTED) {
    return { className: canonicalAnnualClassName(student?.className) ?? student?.className, option: student?.option, promoted: false, transition: undefined, optionPending: false, result: transition.result };
  }
  // Preserve the historical UI contract: entering Humanités exposes an
  // explicit empty option while the persistence layer continues to omit it.
  return { ...transition, option: transition.option };
}

/** Omit absent optional values, including nested ones, without changing null,
 * empty strings, Dates or Firestore Timestamp objects. Never enable the global
 * ignoreUndefinedProperties switch. */
export function studentForPersistence(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined).map(studentForPersistence);
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, studentForPersistence(item)]));
}

export function studentImportKey(student) {
  const normalized = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized(student.matricule) || [student.nom, student.postnom, student.prenom, student.birthDate].map(normalized).join("|");
}
