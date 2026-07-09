import type { ParentProfile, SchoolClass, SchoolSection, Student, ValvePublication, ValveVisibility } from "../types";
import { CLASSES } from "../types";

const valveClassSeparator = "::option::";

type LegacyValveVisibility = ValveVisibility | "parents" | "all" | "staff";

export type ValveClassChoice = {
  value: string;
  label: string;
};

export function normalizeValveVisibility(value: LegacyValveVisibility): ValveVisibility {
  if (value === "parents" || value === "all" || value === "staff") return "all_parents";
  return value;
}

function getValveClassSection(className: SchoolClass): SchoolSection {
  if (className.includes("Maternelle")) return "maternelle";
  if (className.includes("Humanité")) return "secondaire";
  return "primaire";
}

function valveClassKey(className: SchoolClass, option?: string) {
  const normalizedOption = option?.trim();
  return normalizedOption ? `${className}${valveClassSeparator}${normalizedOption}` : className;
}

function valveClassNameFromKey(target: string) {
  return target.split(valveClassSeparator)[0] as SchoolClass;
}

function valveClassOptionFromKey(target: string) {
  return target.includes(valveClassSeparator) ? target.split(valveClassSeparator).slice(1).join(valveClassSeparator) : "";
}

export function getValveStudentClassKey(student: Pick<Student, "className" | "option">) {
  return getValveClassSection(student.className) === "secondaire" ? valveClassKey(student.className, student.option) : student.className;
}

export function formatValveClassChoiceLabel(target: string) {
  const className = valveClassNameFromKey(target);
  const option = valveClassOptionFromKey(target);
  if (!option) return className;
  const classLabel = className.replace(/\s+Humanit[ée]s?$/i, "").trim();
  return `${classLabel || className} ${option}`;
}

export function buildValveClassChoices(students: Pick<Student, "className" | "option">[], selectedTarget?: string): ValveClassChoice[] {
  const choices = students
    .filter((student) => student.className)
    .map((student) => {
      const value = getValveStudentClassKey(student);
      return { value, label: formatValveClassChoiceLabel(value) };
    })
    .sort((first, second) => {
      const firstClassIndex = CLASSES.indexOf(valveClassNameFromKey(first.value));
      const secondClassIndex = CLASSES.indexOf(valveClassNameFromKey(second.value));
      if (firstClassIndex !== secondClassIndex) return firstClassIndex - secondClassIndex;
      return first.label.localeCompare(second.label, "fr");
    });
  const selectedChoice = selectedTarget ? [{ value: selectedTarget, label: formatValveClassChoiceLabel(selectedTarget) }] : [];
  return Array.from(new Map([...choices, ...selectedChoice].map((choice) => [choice.value, choice])).values());
}

export function parentCanViewValvePublication(
  publication: ValvePublication,
  parent: Pick<ParentProfile, "id" | "studentIds">,
  students: Pick<Student, "id" | "parentId" | "className" | "option">[],
) {
  const visibility = normalizeValveVisibility(publication.visibility as LegacyValveVisibility);
  if (visibility === "all_parents") return true;

  const children = students.filter((student) => student.parentId === parent.id || parent.studentIds.includes(student.id));
  if (visibility === "class") {
    if (!publication.targetClassKey) return false;
    return children.some((student) => getValveStudentClassKey(student) === publication.targetClassKey);
  }
  return children.some((student) => getValveClassSection(student.className) === visibility);
}

export function getValvePublicationParents(publication: ValvePublication, parents: ParentProfile[], students: Student[]) {
  const parentMap = new Map<string, ParentProfile>();
  parents.forEach((parent) => {
    if (parentCanViewValvePublication(publication, parent, students)) {
      parentMap.set(parent.id, parent);
    }
  });
  return Array.from(parentMap.values());
}
