import type { HumanityOption, SchoolClass, SchoolSection, Student } from "../types";
import { CLASSES } from "../types";
import { normalizeSchoolSection } from "./schoolSections";

export function getClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "Maternelle";
  if (className.includes("CTEB")) return "CTEB";
  // Compatibilité avec les anciennes classes optionnelles matérialisées sous
  // « 1ère Scientifique »/« 1ère Sciences » au lieu de la classe Humanité
  // structurée avec une option. Ces libellés restent du Secondaire.
  if (/\b(scientifique|sciences)\b/i.test(className)) return "Secondaire";
  if (className.includes("Humanité")) return "Secondaire";
  return "Primaire";
}

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

export function promoteStudentForNewYear(student: Student): { className: SchoolClass; option?: HumanityOption; promoted: boolean; transition?: "maternelle-primaire" | "primaire-cteb" | "cteb-humanites"; optionPending?: boolean } {
  const classIndex = CLASSES.indexOf(student.className);
  const nextClass = classIndex >= 0 && classIndex < CLASSES.length - 1 ? CLASSES[classIndex + 1] : student.className;
  const promoted = nextClass !== student.className;
  const transition =
    student.className === CLASSES[2]
      ? "maternelle-primaire"
      : student.className === CLASSES[8]
        ? "primaire-cteb"
        : student.className === CLASSES[10]
          ? "cteb-humanites"
          : undefined;
  const optionPending = transition === "cteb-humanites";
  return {
    className: nextClass,
    option: optionPending ? undefined : student.option,
    promoted,
    transition,
    optionPending,
  };
}
