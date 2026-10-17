import type { Student } from "../../types";
import { schoolClassOptionKey, schoolClassRecordId } from "../../services/schoolSubclasses";
import { canonicalClassNameFromRecordId, normalizeAnnualClassName, operationalBaseClassId, operationalClassOptionKey } from "../../utils/studentYearTransition.js";
import type { PedagogicalAssignment, StudyClass } from "./studyTypes";

export type CourseScope = NonNullable<PedagogicalAssignment["courseScope"]>;

export interface AssignmentClassSelection {
  classId: string;
  courseScope?: CourseScope;
  targetOptionIds?: string[];
}

const normalizedIds = (values?: readonly string[]) => [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();

export function classOptionId(item: Pick<StudyClass, "id" | "classOptionKey" | "option"> & { subClassLabel?: string }) {
  return operationalClassOptionKey(item) || (item.option?.trim() && !item.subClassLabel ? item.id : undefined);
}

export function baseStudyClassId(item: Pick<StudyClass, "id" | "parentClassId" | "classOptionKey">) {
  return operationalBaseClassId(item);
}

export function optionClassesForBaseClass(classes: readonly StudyClass[], classId: string, schoolOptions: readonly string[] = []) {
  const base = classes.find((item) => item.id === classId);
  const assignmentOptionId = (item: StudyClass) => {
    const key = item.classOptionKey?.trim();
    if (key?.startsWith(`${classId}::`) && key.length > classId.length + 2) return key;
    // Historical option documents have only a deterministic id. The school's
    // configured option must corroborate that id; a subclass is never inferred.
    return !item.parentClassId && !item.classOptionKey && !item.subClassLabel
      && schoolOptions.some((option) => schoolClassOptionKey(classId, option) === item.id) ? item.id : undefined;
  };
  const inactiveOptions = new Set(classes.filter((item) => item.active === false && item.id === assignmentOptionId(item)).map((item) => assignmentOptionId(item)!));
  const options = new Map<string, StudyClass>();
  classes.filter((item) => item.id !== classId && item.active !== false && baseStudyClassId(item) === classId
    && (!base || item.schoolId === base.schoolId && item.schoolYearId === base.schoolYearId)).forEach((item) => {
    const id = assignmentOptionId(item);
    if (!id || inactiveOptions.has(id)) return;
    const current = options.get(id);
    if (!current || current.subClassLabel && !item.subClassLabel || item.id === id && current.id !== id) options.set(id, item);
  });
  return [...options.values()];
}

export function assignmentOptionChoices(classes: readonly StudyClass[], classId: string, schoolOptions: readonly string[] = []) {
  return optionClassesForBaseClass(classes, classId, schoolOptions).map((item) => {
    const id = classOptionId(item)!;
    const configured = schoolOptions.find((option) => schoolClassOptionKey(classId, option) === id);
    const documented = item.option?.trim();
    return { id, label: configured ?? (documented && schoolClassOptionKey(classId, documented) === id ? documented : undefined) ?? id.split("::").at(-1) ?? id };
  }).sort((left, right) => left.label.localeCompare(right.label, "fr", { sensitivity: "base" }) || left.id.localeCompare(right.id));
}

export function assignmentClassDisplayName(item: StudyClass) {
  const canonical = canonicalClassNameFromRecordId(item.id);
  const abbreviated = normalizeAnnualClassName(item.name);
  return canonical && schoolClassRecordId(item.schoolId, item.schoolYearId, canonical) === item.id
    && normalizeAnnualClassName(canonical).startsWith(`${abbreviated} `) ? canonical : item.name;
}

export type AssignmentClassScope = { courseScope: CourseScope | ""; targetOptionIds: string[] };

export function retainAssignmentClassScopes(scopes: Record<string, AssignmentClassScope>, classIds: readonly string[], classes: readonly StudyClass[], schoolOptions: readonly string[] = []) {
  return Object.fromEntries(classIds.flatMap((classId) => {
    const scope = scopes[classId];
    if (!scope) return [];
    const allowed = new Set(assignmentOptionChoices(classes, classId, schoolOptions).map((item) => item.id));
    return [[classId, { ...scope, targetOptionIds: scope.targetOptionIds.filter((id) => allowed.has(id)) }]];
  })) as Record<string, AssignmentClassScope>;
}

/**
 * Resolves the concrete classes that may receive a homeroom teacher for the
 * current assignment selections. A logical parent is kept only when it has no
 * operational child; option/subclass children always take precedence.
 */
export function operationalTitularClasses(selections: readonly AssignmentClassSelection[], classes: readonly StudyClass[]) {
  const resolved = new Map<string, StudyClass>();
  selections.forEach((selection) => {
    const scoped = classes.filter((item) => item.active !== false && (
      item.id === selection.classId || baseStudyClassId(item) === selection.classId
    ));
    const detailed = scoped.filter((item) => item.id !== selection.classId || Boolean(item.parentClassId || item.classOptionKey || item.subClassLabel || item.option));
    const targetOptionIds = new Set(normalizedIds(selection.targetOptionIds));
    const candidates = detailed.length ? detailed : scoped.filter((item) => item.id === selection.classId);
    candidates
      .filter((item) => targetOptionIds.size === 0 || Boolean(classOptionId(item) && targetOptionIds.has(classOptionId(item)!)))
      .forEach((item) => resolved.set(item.id, item));
  });
  return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name, "fr", { numeric: true, sensitivity: "base" }));
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

export function studentBelongsToAssignment(student: Student, assignment: Pick<PedagogicalAssignment, "classId" | "courseScope" | "targetOptionIds"> & Partial<Pick<PedagogicalAssignment, "schoolId" | "schoolYearId">>, classes: readonly StudyClass[] = []) {
  if ((student.status ?? "ACTIVE") !== "ACTIVE" || student.deletedAt) return false;
  if (assignment.schoolId && student.schoolId !== assignment.schoolId) return false;
  if (assignment.schoolYearId && student.schoolYearId !== assignment.schoolYearId) return false;
  const assignedClass = classes.find((item) => item.id === assignment.classId);
  if (assignedClass?.subClassLabel && student.subClassId !== assignedClass.id) return false;
  const scope = normalizedAssignmentScope(assignment, classes);
  const derivedBaseId = student.schoolId && student.schoolYearId && student.className
    ? schoolClassRecordId(student.schoolId, student.schoolYearId, student.className)
    : undefined;
  const explicitOptionBaseId = student.classOptionKey?.split("::")[0]?.trim();
  const belongsToBase = student.classId === scope.baseClassId
    || student.subClassId === assignment.classId
    || explicitOptionBaseId === scope.baseClassId
    || derivedBaseId === scope.baseClassId;
  if (!belongsToBase) return false;
  const targets = scope.optionIds ?? [];
  if (targets.length === 0) return true;
  const optionId = student.classOptionKey?.trim()
    || (student.option?.trim() ? schoolClassOptionKey(scope.baseClassId, student.option) : undefined);
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

export function validateAssignmentClassSelection(selection: AssignmentClassSelection, classes: readonly StudyClass[], schoolOptions: readonly string[] = []) {
  const availableOptionIds = new Set(assignmentOptionChoices(classes, selection.classId, schoolOptions).map((item) => item.id));
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
