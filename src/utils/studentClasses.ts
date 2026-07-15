import type { HumanityOption, SchoolClass, SchoolSection, Student } from "../types";
import { CLASSES } from "../types";

export function getClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

export function formatStudentClassName(student: Pick<Student, "className" | "option">) {
  if (getClassSection(student.className) !== "secondaire") return student.className;
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
