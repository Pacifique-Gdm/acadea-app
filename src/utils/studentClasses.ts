import type { SchoolSection, Student } from "../types";
import { getClassSection } from "./studentYearTransition.js";
export { getClassSection, promoteStudentForNewYear } from "./studentYearTransition.js";
import { normalizeSchoolSection } from "./schoolSections";

export function getStudentSection(student: Pick<Student, "className" | "section">): SchoolSection {
  const classSection = getClassSection(student.className);
  // Compatibilité avec les anciennes fiches qui ont enregistré 7ème/8ème CTEB sous "Primaire".
  if (classSection === "CTEB") return "CTEB";
  return normalizeSchoolSection(student.section) ?? classSection;
}

export function formatStudentClassName(student: Pick<Student, "className" | "option">) {
  if (getClassSection(student.className) !== "Secondaire") return student.className;
  const option = student.option?.trim();
  if (!option) return student.className;
  const classLabel = student.className.replace(/\s+Humanit[ée]s?$/i, "").trim();
  return `${classLabel || student.className} ${option}`;
}
