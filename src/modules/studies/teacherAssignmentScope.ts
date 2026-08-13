import type { SchoolClass, SchoolSection } from "../../types";
import { getClassSection } from "../../utils/studentClasses";
import type { StudyClass, StudySubject } from "./studyTypes";

export const primaryTeacherSections: SchoolSection[] = ["Maternelle", "Primaire"];

export function studyClassSection(item: StudyClass): SchoolSection {
  return item.section ?? getClassSection(item.name as SchoolClass);
}

export function subjectAppliesToClass(subject: StudySubject, schoolClass: StudyClass) {
  if (subject.section && subject.section !== studyClassSection(schoolClass)) return false;
  return !subject.classIds?.length || subject.classIds.includes(schoolClass.id);
}
