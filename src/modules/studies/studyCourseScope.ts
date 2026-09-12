import type { Student } from "../../types";
import { schoolClassOptionKey, schoolClassRecordId } from "../../services/schoolSubclasses";
import type { PedagogicalAssignment, StudyClass } from "./studyTypes";

export type CourseScope = NonNullable<PedagogicalAssignment["courseScope"]>;

export interface AssignmentClassSelection {
  classId: string;
  courseScope?: CourseScope;
  targetOptionIds?: string[];
}

const normalizedIds = (values?: readonly string[]) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();

export function classOptionId(item: Pick<StudyClass, "id" | "classOptionKey" | "option">) {
  return item.classOptionKey?.trim() || (item.option?.trim() ? item.id : undefined);
}

export function baseStudyClassId(item: Pick<StudyClass, "id" | "parentClassId" | "classOptionKey">) {
  return item.parentClassId?.trim() || item.classOptionKey?.split("::")[0]?.trim() || item.id;
}

export function optionClassesForBaseClass(classes: readonly StudyClass[], classId: string) {
  return classes.filter((item) => baseStudyClassId(item) === classId && Boolean(classOptionId(item)));
}

export function logicalStudyClasses(operationalClasses: readonly StudyClass[], sourceClasses: readonly StudyClass[] = []) {
  const all = [...sourceClasses, ...operationalClasses];
  const byId = new Map(all.map((item) => [item.id, item]));
  const logical = new Map<string, StudyClass>();
  operationalClasses.forEach((item) => {
    const baseId = baseStudyClassId(item);
    const base = byId.get(baseId);
    if (!logical.has(baseId)) logical.set(baseId, base ?? {
      ...item,
      id: baseId,
      name: item.option?.trim() && item.name.endsWith(item.option.trim())
        ? item.name.slice(0, -item.option.trim().length).trim()
        : item.name,
      parentClassId: undefined,
      classOptionKey: undefined,
      option: undefined,
    });
  });
  return [...logical.values()].sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true, sensitivity: "base" }));
}

export function assignmentStudentGroupKey(input: Pick<PedagogicalAssignment, "courseScope" | "targetOptionIds">) {
  if (!input.courseScope) return undefined;
  const optionIds = normalizedIds(input.targetOptionIds);
  return `${input.courseScope}--${optionIds.map(encodeURIComponent).join("--")}`;
}

export function normalizedAssignmentScope(assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">, classes: readonly StudyClass[]) {
  const assignedClass = classes.find((item) => item.id === assignment.classId);
  const historicalOptionId = assignedClass ? classOptionId(assignedClass) : undefined;
  return {
    baseClassId: assignedClass ? baseStudyClassId(assignedClass) : assignment.classId,
    optionIds: assignment.courseScope ? normalizedIds(assignment.targetOptionIds) : historicalOptionId ? [historicalOptionId] : undefined,
  };
}

export function assignmentAppliesToClass(assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">, schoolClass: StudyClass, classes: readonly StudyClass[]) {
  const scope = normalizedAssignmentScope(assignment, classes);
  if (scope.baseClassId !== baseStudyClassId(schoolClass)) return false;
  if (!scope.optionIds) return true;
  const optionId = classOptionId(schoolClass);
  return Boolean(optionId && scope.optionIds.includes(optionId));
}

export function studentBelongsToAssignment(student: Student, assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">) {
  if ((student.status ?? "ACTIVE") !== "ACTIVE" || student.deletedAt) return false;
  const derivedBaseId = student.schoolId && student.schoolYearId && student.className
    ? schoolClassRecordId(student.schoolId, student.schoolYearId, student.className)
    : undefined;
  const explicitOptionBaseId = student.classOptionKey?.split("::")[0]?.trim();
  const belongsToBase = student.classId === assignment.classId
    || student.subClassId === assignment.classId
    || explicitOptionBaseId === assignment.classId
    || derivedBaseId === assignment.classId;
  if (!belongsToBase) return false;
  const targets = normalizedIds(assignment.targetOptionIds);
  if (!assignment.courseScope || targets.length === 0) return true;
  const optionId = student.classOptionKey?.trim()
    || (student.option?.trim() ? schoolClassOptionKey(assignment.classId, student.option) : undefined);
  return Boolean(optionId && targets.includes(optionId));
}

export function assignmentsShareStudents(first: PedagogicalAssignment, second: PedagogicalAssignment, classes: readonly StudyClass[]) {
  const left = normalizedAssignmentScope(first, classes);
  const right = normalizedAssignmentScope(second, classes);
  if (left.baseClassId !== right.baseClassId) return false;
  // Une affectation historique sans groupe explicite reste un groupe-classe complet :
  // elle ne doit jamais devenir artificiellement parallèle après migration.
  if (!left.optionIds || !right.optionIds) return true;
  const rightIds = new Set(right.optionIds);
  return left.optionIds.some((id) => rightIds.has(id));
}

export function validateAssignmentClassSelection(selection: AssignmentClassSelection, classes: readonly StudyClass[]) {
  const availableOptionIds = new Set(optionClassesForBaseClass(classes, selection.classId).map((item) => classOptionId(item)!));
  const targetOptionIds = normalizedIds(selection.targetOptionIds);
  if (availableOptionIds.size === 0) {
    return selection.courseScope || targetOptionIds.length ? "Cette classe ne possède aucune option configurable." : "";
  }
  if (!selection.courseScope) return "Choisissez le type de cours pour cette classe.";
  if (targetOptionIds.some((id) => !availableOptionIds.has(id))) return "Une option sélectionnée n’appartient pas à cette classe.";
  if (selection.courseScope === "common" && targetOptionIds.length < 2) return "Un tronc commun doit concerner au moins deux options.";
  if (selection.courseScope === "option" && targetOptionIds.length !== 1) return "Un cours d’option doit concerner exactement une option.";
  return "";
}

export function assignmentScopeLabel(assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds">, classes: readonly StudyClass[]) {
  const scope = normalizedAssignmentScope(assignment, classes);
  if (!scope.optionIds?.length) return "";
  return scope.optionIds.map((id) => classes.find((item) => classOptionId(item) === id)?.option ?? id.split("::").at(-1) ?? id).join(" + ");
}
