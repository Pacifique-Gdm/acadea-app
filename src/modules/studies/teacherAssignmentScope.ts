import type { SchoolClass, SchoolSection } from "../../types";
import { getClassSection } from "../../utils/studentClasses";
import { canonicalClassNameFromRecordId, operationalBaseClassId } from "../../utils/studentYearTransition.js";
import { normalizeSchoolSection } from "../../utils/schoolSections";
import type { StudyClass, StudySubject } from "./studyTypes";

export const primaryTeacherSections: SchoolSection[] = ["Maternelle", "Primaire"];

export function studyClassSection(item: StudyClass, classes: readonly StudyClass[] = []): SchoolSection {
  const explicit = normalizeSchoolSection(item.section);
  if (explicit) return explicit;
  const structuredName = canonicalClassNameFromRecordId(item.id);
  if (structuredName) return getClassSection(structuredName);
  const parentId = operationalBaseClassId(item);
  const parent = parentId && parentId !== item.id ? classes.find((candidate) => candidate.id === parentId) : undefined;
  if (parent) return studyClassSection(parent, classes.filter((candidate) => candidate.id !== item.id));
  return getClassSection(item.name as SchoolClass);
}

export function subjectAppliesToClass(subject: StudySubject, schoolClass: StudyClass) {
  if (subject.section && subject.section !== studyClassSection(schoolClass)) return false;
  return !subject.classIds?.length || subject.classIds.includes(schoolClass.id);
}
