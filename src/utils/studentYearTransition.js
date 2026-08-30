// Shared by the browser and the authoritative annual import API. No Firebase
// dependency: promotion and optional-field handling have one implementation.
export const CLASSES = [
  "Maternelle 1", "Maternelle 2", "Maternelle 3",
  "1ère Primaire", "2ème Primaire", "3ème Primaire", "4ème Primaire", "5ème Primaire", "6ème Primaire",
  "7ème CTEB", "8ème CTEB", "1ère Humanité", "2ème Humanité", "3ème Humanité", "4ème Humanité",
];

export function getClassSection(className) {
  if (className.includes("Maternelle")) return "Maternelle";
  if (className.includes("CTEB")) return "CTEB";
  if (/\b(scientifique|sciences)\b/i.test(className) || className.includes("Humanité")) return "Secondaire";
  return "Primaire";
}

export function promoteStudentForNewYear(student) {
  const classIndex = CLASSES.indexOf(student.className);
  const nextClass = classIndex >= 0 && classIndex < CLASSES.length - 1 ? CLASSES[classIndex + 1] : student.className;
  const transition = student.className === CLASSES[2] ? "maternelle-primaire"
    : student.className === CLASSES[8] ? "primaire-cteb"
      : student.className === CLASSES[10] ? "cteb-humanites" : undefined;
  const optionPending = transition === "cteb-humanites";
  return { className: nextClass, option: optionPending ? undefined : student.option, promoted: nextClass !== student.className, transition, optionPending };
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
