import { collection, doc, onSnapshot, query, where, writeBatch } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { db } from "../firebase";
import type { AppUser, SchoolClassRecord, SchoolSection, Student } from "../types";
import { getClassSection } from "../utils/studentClasses";
import { normalizeSchoolSection } from "../utils/schoolSections";

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
  return item.classOptionKey?.trim() || (item.id.includes("::") ? item.id : undefined);
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
  const parentIdOf = (item: T) => item.parentClassId || inferredClassOptionKey(item)?.split("::")[0];
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
    const label = [className, option && !className.toLocaleLowerCase("fr").includes(option.toLocaleLowerCase("fr")) ? option : "", item.subClassLabel && !item.name.endsWith(item.subClassLabel) ? item.subClassLabel : ""].filter(Boolean).join(" ");
    const key = normalizedClassName(label);
    if (!unique.has(key)) unique.set(key, { ...item, name: label, section, ...(parentClassId ? { parentClassId } : {}), ...(classOptionKey ? { classOptionKey } : {}), ...(option ? { option } : {}) });
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
  const structured = operationalSchoolClasses(classes, schoolId, schoolYearId, allowedSections);
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
      if (result.has(key)) return;
      result.set(key, {
        id,
        schoolId,
        schoolYearId,
        name: label,
        section,
        option,
        ...(optionKey ? { classOptionKey: optionKey, parentClassId: parent?.id } : {}),
        active: true,
      });
    });
  [...result.values()].forEach((item) => {
    if (item.parentClassId && (item.option || item.classOptionKey)) result.delete(`class:${item.parentClassId}`);
  });
  return [...result.values()].sort((first, second) => first.name.localeCompare(second.name, "fr", { numeric: true, sensitivity: "base" }));
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
  if (clean.length < 2) return "Une subdivision doit contenir au moins deux sous-classes.";
  const normalized = clean.map((label) => label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase());
  if (new Set(normalized).size !== normalized.length) return "Les libellés des sous-classes doivent être uniques.";
  return "";
}

export function subscribeToSchoolClasses(schoolId: string, schoolYearId: string, onData: (items: SchoolClassRecord[]) => void, onError: (error: Error) => void) {
  if (!db) return () => undefined;
  return onSnapshot(query(collection(db as Firestore, "classes"), where("schoolId", "==", schoolId), where("schoolYearId", "==", schoolYearId)), (snapshot) => {
    onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolClassRecord));
  }, onError);
}

export async function createSchoolSubclasses(input: { user: AppUser; parent: SchoolClassRecord; labels: string[]; existing: SchoolClassRecord[]; classOptionKey?: string }) {
  if (!db || !["school_admin", "secretary"].includes(input.user.role) || input.user.schoolId !== input.parent.schoolId) throw new Error("Création de sous-classes non autorisée.");
  if (!input.parent.schoolYearId || input.user.activeSchoolYearId !== input.parent.schoolYearId) throw new Error("L’année scolaire de la classe est incohérente.");
  const error = validateSubclassLabels(input.labels);
  if (error) throw new Error(error);
  if (input.parent.parentClassId) throw new Error("Une sous-classe ne peut pas être subdivisée.");
  const normalizedExisting = new Set(activeSubclasses(input.existing, input.parent.id, input.classOptionKey).map((item) => item.subClassLabel?.trim().toLocaleLowerCase()));
  const labels = input.labels.map((label) => label.trim());
  if (labels.some((label) => normalizedExisting.has(label.toLocaleLowerCase()))) throw new Error("Cette sous-classe existe déjà.");
  const database = db as Firestore;
  const batch = writeBatch(database);
  const now = new Date().toISOString();
  if (!input.existing.some((item) => item.id === input.parent.id)) {
    batch.set(doc(database, "classes", input.parent.id), { id: input.parent.id, schoolId: input.parent.schoolId, schoolYearId: input.parent.schoolYearId, name: input.parent.name, active: true, createdBy: input.user.id, createdAt: now, updatedAt: now });
  }
  labels.forEach((label) => {
    const id = `${input.parent.id}__${crypto.randomUUID()}`;
    batch.set(doc(database, "classes", id), { id, schoolId: input.parent.schoolId, schoolYearId: input.parent.schoolYearId, name: `${input.parent.name}${input.classOptionKey ? ` - ${input.classOptionKey.split("::").at(-1)}` : ""} - ${label}`, parentClassId: input.parent.id, ...(input.classOptionKey ? { classOptionKey: input.classOptionKey } : {}), subClassLabel: label, active: true, createdBy: input.user.id, createdAt: now, updatedAt: now });
  });
  await batch.commit();
}
