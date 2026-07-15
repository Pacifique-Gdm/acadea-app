import type { FeeType, SchoolClass, Student } from "../types";
import { CLASSES } from "../types";
import { formatStudentClassName, getClassSection } from "./studentClasses";

const feeTargetSeparator = "::option::";

export function feeTargetKey(className: SchoolClass, option?: string) {
  const normalizedOption = option?.trim();
  return normalizedOption ? `${className}${feeTargetSeparator}${normalizedOption}` : className;
}

export function feeTargetClassName(target: string) {
  return target.split(feeTargetSeparator)[0] as SchoolClass;
}

export function feeTargetOption(target?: string) {
  return target?.includes(feeTargetSeparator) ? target.split(feeTargetSeparator).slice(1).join(feeTargetSeparator) : "";
}

export function formatFeeTargetValue(target?: string) {
  if (!target) return "Toutes les classes";
  const className = feeTargetClassName(target);
  const option = feeTargetOption(target);
  return option ? formatStudentClassName({ className, option }) : className;
}

function studentFeeTargetKey(student: Pick<Student, "className" | "option">) {
  return getClassSection(student.className) === "secondaire" ? feeTargetKey(student.className, student.option) : student.className;
}

export function feeAppliesToStudent(fee: Pick<FeeType, "className" | "classOptionKey">, student: Pick<Student, "className" | "option">) {
  if (fee.classOptionKey) return fee.classOptionKey === studentFeeTargetKey(student);
  return !fee.className || fee.className === student.className;
}

export function buildFeeTargetChoices(students: Student[], selectedTargets: string[]) {
  const choices = students
    .filter((student) => student.className)
    .flatMap((student) => {
      if (getClassSection(student.className) !== "secondaire") {
        return [{ value: student.className, label: student.className }];
      }
      const option = student.option?.trim();
      if (!option) return [{ value: student.className, label: student.className }];
      return [{
        value: feeTargetKey(student.className, option),
        label: formatStudentClassName({ className: student.className, option }),
      }];
    })
    .sort((first, second) => {
      const firstClassIndex = CLASSES.indexOf(feeTargetClassName(first.value));
      const secondClassIndex = CLASSES.indexOf(feeTargetClassName(second.value));
      if (firstClassIndex !== secondClassIndex) return firstClassIndex - secondClassIndex;
      return first.label.localeCompare(second.label, "fr");
    });
  const legacyChoices = selectedTargets.map((target) => ({ value: target, label: formatFeeTargetValue(target) }));
  return Array.from(new Map([...choices, ...legacyChoices].map((choice) => [choice.value, choice])).values());
}
