// Pure grouping rules shared by the browser, solver and server validator.
import { operationalBaseClassId, operationalClassOptionKey } from "../../utils/studentYearTransition.js";
import type { PedagogicalAssignment, StudyClass } from "./studyTypes";

export function classOptionId(item: Pick<StudyClass, "id" | "classOptionKey" | "option"> & { subClassLabel?: string }) {
  return operationalClassOptionKey(item) || (item.option?.trim() && !item.subClassLabel ? item.id : undefined);
}
export function baseStudyClassId(item: Pick<StudyClass, "id" | "parentClassId" | "classOptionKey">) {
  return operationalBaseClassId(item);
}
export function normalizedAssignmentScope(assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">, classes: readonly StudyClass[]) {
  const assignedClass = classes.find((item) => item.id === assignment.classId);
  const historicalOptionId = assignedClass ? classOptionId(assignedClass) : undefined;
  return {
    baseClassId: assignedClass ? baseStudyClassId(assignedClass) : assignment.classId,
    optionIds: assignment.courseScope ? [...new Set((assignment.targetOptionIds ?? []).map((id) => id.trim()).filter(Boolean))].sort() : historicalOptionId ? [historicalOptionId] : undefined,
  };
}
export function assignmentsShareStudents(first: PedagogicalAssignment, second: PedagogicalAssignment, classes: readonly StudyClass[]) {
  const left = normalizedAssignmentScope(first, classes), right = normalizedAssignmentScope(second, classes);
  if (left.baseClassId !== right.baseClassId) return false;
  // Legacy assignments without an explicit group remain whole-class assignments.
  if (!left.optionIds || !right.optionIds) return true;
  return left.optionIds.some((id) => right.optionIds!.includes(id));
}

export function logicalStudyClasses(operationalClasses: readonly StudyClass[], sourceClasses: readonly StudyClass[] = []) {
  const byId = new Map([...sourceClasses, ...operationalClasses].map((item) => [item.id, item]));
  const logical = new Map<string, StudyClass>();
  operationalClasses.forEach((item) => {
    const baseId = baseStudyClassId(item), base = byId.get(baseId);
    if (!logical.has(baseId)) logical.set(baseId, base ?? {
      ...item, id: baseId,
      name: item.option?.trim() && item.name.endsWith(item.option.trim()) ? item.name.slice(0, -item.option.trim().length).trim() : item.name,
      parentClassId: undefined, classOptionKey: undefined, option: undefined,
    });
  });
  return [...logical.values()].sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true, sensitivity: "base" }));
}
