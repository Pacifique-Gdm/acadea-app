import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { SchoolClassRecord, SchoolSection, Student } from "../types";
import { formatStudentClassName, getClassSection } from "../utils/studentClasses";
import { normalizeSchoolSection } from "../utils/schoolSections";
import { operationalBaseClassId, operationalClassOptionKey } from "../utils/studentYearTransition.js";

export interface EnrolledStudentClassReference {
  schoolId: string;
  schoolYearId: string;
  classId?: string;
  className?: string;
  subClassId?: string;
}

function normalizedClassName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase();
}

function classOptionFromKey(value?: string) {
  const option = value?.split("::").at(-1)?.trim();
  return option || undefined;
}

function inferredClassOptionKey(item: Pick<SchoolClassRecord, "id" | "classOptionKey">) {
  return operationalClassOptionKey(item);
}

function isCertainLegacyOptionRecord(item: OperationalClass, parent: OperationalClass | undefined) {
  return Boolean(parent && item.id.includes("::") && !item.parentClassId && !item.classOptionKey && !item.option?.trim() && !item.subClassLabel);
}

export function schoolClassRecordId(schoolId: string, schoolYearId: string, name: string) {
  const slug = normalizedClassName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${schoolId}__${schoolYearId}__${slug}`;
}

export function schoolClassOptionKey(parentClassId: string, option: string) {
  return `${parentClassId}::${normalizedClassName(option)}`;
}

/** Resolves the option key even before the classes listener has emitted. */
export function studentSchoolClassOptionKey(
  classes: readonly SchoolClassRecord[],
  student: EnrolledStudentClassReference & { option?: string },
) {
  const option = student.option?.trim();
  if (!option) return undefined;
  const selectedClass = classes.find((item) => !item.parentClassId && (
    item.id === student.classId
    || normalizedClassName(item.name) === normalizedClassName(student.className ?? "")
  ));
  const parentClassId = selectedClass?.id
    || student.classId?.trim()
    || (student.className?.trim() ? schoolClassRecordId(student.schoolId, student.schoolYearId, student.className) : undefined);
  return parentClassId ? schoolClassOptionKey(parentClassId, option) : undefined;
}

export function resolveStudentParentClass(
  classes: readonly SchoolClassRecord[],
  student: EnrolledStudentClassReference,
) {
  const scopedParents = classes.filter((item) => (
    item.schoolId === student.schoolId
    && item.schoolYearId === student.schoolYearId
    && item.active !== false
    && !item.parentClassId
  ));
  const classId = student.classId?.trim();
  if (classId) {
    return scopedParents.find((item) => item.id === classId);
  }
  const className = student.className?.trim();
  if (!className) return undefined;
  return scopedParents.find((item) => normalizedClassName(item.name) === normalizedClassName(className));
}

export function resolveStudentSubclass(
  classes: readonly SchoolClassRecord[],
  student: EnrolledStudentClassReference & { classOptionKey?: string },
) {
  const subClassId = student.subClassId?.trim();
  if (!subClassId) return undefined;
  const parent = resolveStudentParentClass(classes, student);
  if (!parent) return undefined;
  const subclass = classes.find((item) => (
    item.id === subClassId
    && item.schoolId === student.schoolId
    && item.schoolYearId === student.schoolYearId
    && item.active !== false
    && item.parentClassId === parent.id
  ));
  if (!subclass) return undefined;
  if (subclass.classOptionKey && subclass.classOptionKey !== student.classOptionKey?.trim()) return undefined;
  return subclass;
}

function appendSubclassLabel(label: string, subClassLabel?: string) {
  const suffix = subClassLabel?.trim();
  if (!suffix) return label;
  const normalizedLabel = normalizedClassName(label);
  const normalizedSuffix = normalizedClassName(suffix);
  const lastToken = normalizedLabel.split(/[\s-]+/).at(-1);
  return lastToken === normalizedSuffix ? label : `${label} ${suffix}`;
}

export function formatOperationalStudentClassName(
  student: EnrolledStudentClassReference & { classOptionKey?: string; option?: string },
  classes: readonly SchoolClassRecord[],
) {
  return appendSubclassLabel(
    formatStudentClassName({ className: student.className as Student["className"], option: student.option }),
    resolveStudentSubclass(classes, student)?.subClassLabel,
  );
}

export function activeSubclasses(classes: SchoolClassRecord[], parentClassId: string, classOptionKey?: string) {
  return classes.filter((item) => item.parentClassId === parentClassId && item.active !== false && (!classOptionKey || item.classOptionKey === classOptionKey));
}

export function secondarySubclassesForOption(classes: SchoolClassRecord[], parentClassId: string, classOptionKey: string | undefined, currentSubClassId?: string) {
  return classes.filter((item) => item.parentClassId === parentClassId && item.active !== false && (
    (Boolean(classOptionKey) && item.classOptionKey === classOptionKey)
    || (item.id === currentSubClassId && !item.classOptionKey)
  ));
}

export function operationalClasses(classes: SchoolClassRecord[]) {
  const subdivided = new Set(classes.filter((item) => item.parentClassId && item.active !== false).map((item) => item.parentClassId!));
  return classes.filter((item) => item.active !== false && (item.parentClassId || !subdivided.has(item.id)));
}

type OperationalClass = SchoolClassRecord & { section?: SchoolSection; option?: string };

function operationalClassIdentity(item: OperationalClass) {
  if (item.subClassLabel) return `subclass:${item.id}`;
  if (item.classOptionKey) return `option:${item.classOptionKey}`;
  if (item.option?.trim()) return `option:${schoolClassOptionKey(item.parentClassId ?? item.id, item.option)}`;
  return `class:${item.id}`;
}

export function operationalSchoolClasses<T extends OperationalClass>(classes: readonly T[], schoolId: string, schoolYearId: string, allowedSections?: readonly SchoolSection[]) {
  const scoped = classes.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.active !== false);
  const byId = new Map(scoped.map((item) => [item.id, item]));
  const parentIdOf = (item: T) => operationalBaseClassId(item) === item.id ? undefined : operationalBaseClassId(item);
  const subdivided = new Set(scoped.map(parentIdOf).filter((value): value is string => Boolean(value)));
  const unique = new Map<string, T>();
  scoped.filter((item) => parentIdOf(item) || !subdivided.has(item.id)).forEach((item) => {
    const classOptionKey = inferredClassOptionKey(item);
    const parentClassId = parentIdOf(item);
    const parent = parentClassId ? byId.get(parentClassId) : undefined;
    const section = normalizeSchoolSection(item.section) ?? normalizeSchoolSection(parent?.section) ?? getClassSection((parent?.name ?? item.name) as import("../types").SchoolClass);
    if (allowedSections?.length && !allowedSections.includes(section)) return;
    const option = item.option?.trim() || classOptionFromKey(classOptionKey);
    const className = section === "Secondaire" && option ? item.name.replace(/\s+Humanit[ée]s?$/i, "").trim() || item.name : item.name;
    const label = [className, option && !normalizedClassName(className).includes(normalizedClassName(option)) ? option : "", item.subClassLabel && !item.name.endsWith(item.subClassLabel) ? item.subClassLabel : ""].filter(Boolean).join(" ");
    const vacation = isCertainLegacyOptionRecord(item, parent) ? (parent?.vacation ?? item.vacation) : (item.vacation ?? parent?.vacation);
    const saturdayEnabled = item.saturdayEnabled ?? parent?.saturdayEnabled;
    const saturdayVacation = item.saturdayVacation ?? parent?.saturdayVacation;
    const key = normalizedClassName(label);
    if (!unique.has(key)) unique.set(key, {
      ...item,
      name: label,
      section,
      ...(parentClassId ? { parentClassId } : {}),
      ...(classOptionKey ? { classOptionKey } : {}),
      ...(option ? { option } : {}),
      ...(vacation ? { vacation } : {}),
      ...(saturdayEnabled !== undefined ? { saturdayEnabled } : {}),
      ...(saturdayVacation !== undefined ? { saturdayVacation } : {}),
    });
  });
  return [...unique.values()].sort((first, second) => first.name.localeCompare(second.name, "fr", { numeric: true, sensitivity: "base" }));
}

/** Source métier commune des classes opérationnelles, avec compatibilité des inscriptions historiques. */
export function canonicalOperationalClasses(
  classes: readonly SchoolClassRecord[],
  students: readonly Student[],
  schoolId: string,
  schoolYearId: string,
  allowedSections?: readonly SchoolSection[],
) {
  // Apply the section scope after enrolled students have reconciled legacy
  // materialized option classes. Some historical option documents only carry
  // a deterministic `::option` id: their label alone can be misclassified as
  // Primaire even though the enrolled student still carries Secondaire.
  const structured = operationalSchoolClasses(classes, schoolId, schoolYearId);
  const result = new Map(structured.map((item) => [operationalClassIdentity(item), item]));
  const scopedClasses = classes.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId);
  const structuredById = new Map(scopedClasses.map((item) => [item.id, item]));
  const structuredByName = new Map(scopedClasses.map((item) => [normalizedClassName(item.name), item]));
  students
    .filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId)
    .forEach((student) => {
      const section = normalizeSchoolSection(student.section) ?? getClassSection(student.className);
      if (allowedSections?.length && !allowedSections.includes(section)) return;
      const base = student.className.replace(/\s+Humanit[ée]s?$/i, "").trim();
      const label = section === "Secondaire" && student.option?.trim()
        ? `${base || student.className} ${student.option.trim()}`
        : student.className.trim();
      const parent = (student.classId && structuredById.get(student.classId)) || structuredByName.get(normalizedClassName(student.className));
      const option = student.option?.trim();
      const optionKey = option ? (student.classOptionKey?.trim() || schoolClassOptionKey(parent?.id ?? schoolClassRecordId(schoolId, schoolYearId, student.className), option)) : undefined;
      const id = optionKey || parent?.id || schoolClassRecordId(schoolId, schoolYearId, label);
      const key = optionKey ? `option:${optionKey}` : parent ? `class:${parent.id}` : `legacy:${normalizedClassName(label)}`;
      // In Secondary, an option-bearing enrolment makes the generic Humanité
      // record a parent identity, not an assignable operational class.
      if (optionKey && parent) result.delete(`class:${parent.id}`);
      const existing = result.get(key);
      if (existing) {
        if (existing.section !== section) result.set(key, { ...existing, section });
        return;
      }
      result.set(key, {
        id,
        schoolId,
        schoolYearId,
        name: label,
        section,
        option,
        ...(optionKey ? { classOptionKey: optionKey, parentClassId: parent?.id } : {}),
        ...(parent?.vacation ? { vacation: parent.vacation } : {}),
        ...(parent?.saturdayEnabled !== undefined ? { saturdayEnabled: parent.saturdayEnabled } : {}),
        ...(parent?.saturdayVacation !== undefined ? { saturdayVacation: parent.saturdayVacation } : {}),
        active: true,
      });
    });
  [...result.values()].forEach((item) => {
    if (item.parentClassId && (item.option || item.classOptionKey)) result.delete(`class:${item.parentClassId}`);
  });
  return [...result.values()]
    .filter((item) => !allowedSections?.length || allowedSections.includes(item.section ?? getClassSection(item.name as import("../types").SchoolClass)))
    .sort((first, second) => first.name.localeCompare(second.name, "fr", { numeric: true, sensitivity: "base" }));
}

export function studentBelongsToOperationalClass(student: EnrolledStudentClassReference & { classOptionKey?: string; option?: string }, schoolClass: OperationalClass) {
  if (student.schoolId !== schoolClass.schoolId || student.schoolYearId !== schoolClass.schoolYearId) return false;
  if (schoolClass.parentClassId && schoolClass.subClassLabel) return student.subClassId === schoolClass.id;
  if (student.subClassId) return student.subClassId === schoolClass.id;
  if (student.classId && student.classId !== schoolClass.id && student.classId !== schoolClass.parentClassId) return false;
  const classOptionKey = schoolClass.classOptionKey?.trim();
  if (classOptionKey && student.classOptionKey) return student.classOptionKey === classOptionKey;
  const option = schoolClass.option?.trim();
  const base = (student.className ?? "").replace(/\s+Humanit[ée]s?$/i, "").trim();
  const displayed = student.option?.trim() ? `${base || student.className} ${student.option.trim()}` : student.className ?? "";
  if (option) return normalizedClassName(student.option?.trim() ?? "") === normalizedClassName(option) && normalizedClassName(displayed) === normalizedClassName(schoolClass.name);
  return student.classId === schoolClass.id
    || normalizedClassName(student.className ?? "") === normalizedClassName(schoolClass.name)
    || normalizedClassName(displayed) === normalizedClassName(schoolClass.name);
}

export function classesWithEnrolledStudents(classes: SchoolClassRecord[], students: EnrolledStudentClassReference[], schoolId: string, schoolYearId: string) {
  const scopedClasses = classes.filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.active !== false);
  const byId = new Map(scopedClasses.map((item) => [item.id, item]));
  const byName = new Map(scopedClasses.map((item) => [normalizedClassName(item.name), item]));
  const optionParents = new Set(scopedClasses.filter((item) => item.parentClassId && (item.option || item.classOptionKey)).map((item) => item.parentClassId!));
  const selected = new Map<string, SchoolClassRecord>();
  students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId).forEach((student) => {
    const optionStudent = student as EnrolledStudentClassReference & { option?: string; classOptionKey?: string };
    const operationalOption = scopedClasses.find((item) => (item.option || item.classOptionKey) && studentBelongsToOperationalClass(optionStudent, item));
    if (operationalOption) {
      selected.set(operationalOption.id, operationalOption);
      return;
    }
    const structuredId = student.subClassId || student.classId;
    const structured = structuredId ? byId.get(structuredId) : undefined;
    const named = student.className ? byName.get(normalizedClassName(student.className)) : undefined;
    const resolved = structured ?? named;
    if (resolved) {
      if (!optionParents.has(resolved.id)) selected.set(resolved.id, resolved);
      return;
    }
    if (student.classId && optionParents.has(student.classId)) return;
    const name = student.className?.trim();
    if (!name) return;
    const normalized = normalizedClassName(name);
    const id = schoolClassRecordId(schoolId, schoolYearId, name);
    selected.set(`legacy:${normalized}`, { id, schoolId, schoolYearId, name, active: true });
  });
  return [...selected.values()].sort((first, second) => first.name.localeCompare(second.name, "fr", { numeric: true, sensitivity: "base" }));
}

export function validateSubclassLabels(labels: string[]) {
  const clean = labels.map((label) => label.trim()).filter(Boolean);
  if (clean.length < 1) return "Saisissez au moins une sous-classe.";
  const normalized = clean.map((label) => normalizedClassName(label).replace(/\s+/g, " "));
  if (new Set(normalized).size !== normalized.length) return "Les libellés des sous-classes doivent être uniques.";
  return "";
}

export function validateSubclassCreation(labels: string[], existing: SchoolClassRecord[], parent: SchoolClassRecord, classOptionKey?: string) {
  const error = validateSubclassLabels(labels);
  if (error) return error;
  const normalizedExisting = new Set(existing.filter((item) => item.schoolId === parent.schoolId
    && item.schoolYearId === parent.schoolYearId && item.parentClassId === parent.id
    && item.active !== false && (item.classOptionKey ?? "") === (classOptionKey ?? ""))
    .map((item) => normalizedClassName(item.subClassLabel ?? "").replace(/\s+/g, " ")));
  return labels.some((label) => normalizedExisting.has(normalizedClassName(label).replace(/\s+/g, " ")))
    ? "Cette sous-classe existe déjà." : "";
}

export function validateStudentAcademicSelection(
  classes: SchoolClassRecord[],
  student: EnrolledStudentClassReference & { option?: string; classOptionKey?: string; className: string },
  availableOptions: string[],
) {
  const parent = resolveStudentParentClass(classes, student);
  const isHumanity = /Humanit[ée]s?/i.test(student.className);
  const option = student.option?.trim() ?? "";
  if (isHumanity && !option) return "L’option est obligatoire pour cette classe des Humanités.";
  if (option && !availableOptions.some((choice) => normalizedClassName(choice) === normalizedClassName(option))) return "L’option sélectionnée n’est pas disponible pour cette école.";
  const optionKey = studentSchoolClassOptionKey(classes, student);
  const subclasses = parent ? classes.filter((item) => item.schoolId === student.schoolId
    && item.schoolYearId === student.schoolYearId && item.parentClassId === parent.id && item.active !== false
    && ((isHumanity && item.classOptionKey === optionKey) || (!isHumanity && !item.classOptionKey))) : [];
  if (subclasses.length && !student.subClassId) return "La sous-classe est obligatoire pour cette classe subdivisée.";
  if (student.subClassId && !subclasses.some((item) => item.id === student.subClassId)) return "La sous-classe sélectionnée n’appartient pas à cette classe ou option.";
  return "";
}

export function subclassCreationScopeIsValid(parent: Pick<SchoolClassRecord, "schoolId" | "schoolYearId">, schoolId: string, schoolYearId: string) {
  return Boolean(parent.schoolYearId && parent.schoolId === schoolId && parent.schoolYearId === schoolYearId);
}

export function subscribeToSchoolClasses(schoolId: string, schoolYearId: string, onData: (items: SchoolClassRecord[]) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db as Firestore, "classes"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolClassRecord));
  }, onError);
}
