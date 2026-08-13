import type { SchoolClass, SchoolSection } from "../../types";
import { getClassSection } from "../../utils/studentClasses";
import type { SchedulePeriod, StudyClass, StudyDay, StudySubject, StudyVacation } from "./studyTypes";

export const studySectionLabels: Record<SchoolSection, string> = { Maternelle: "Maternelle", Primaire: "Primaire", CTEB: "CTEB", Secondaire: "Secondaire" };
export const studyVacationLabels: Record<StudyVacation, string> = { morning: "Avant-midi", afternoon: "Après-midi" };
export const primaryTeacherSections: SchoolSection[] = ["Maternelle", "Primaire"];

export function studyClassSection(item: StudyClass): SchoolSection {
  return item.section ?? getClassSection(item.name as SchoolClass);
}

export function operationalClassLabel(item: StudyClass) {
  const option = item.option?.trim();
  const subclass = item.subClassLabel?.trim();
  return [item.name, option && !item.name.toLocaleLowerCase("fr").includes(option.toLocaleLowerCase("fr")) ? option : "", subclass && !item.name.endsWith(subclass) ? subclass : ""].filter(Boolean).join(" ");
}

export function subjectAppliesToClass(subject: StudySubject, schoolClass: StudyClass) {
  if (subject.section && subject.section !== studyClassSection(schoolClass)) return false;
  return !subject.classIds?.length || subject.classIds.includes(schoolClass.id);
}

export function periodAppliesToClass(period: SchedulePeriod, schoolClass: StudyClass, day: StudyDay) {
  if (!schoolClass.vacation && !period.vacation && !period.dayScope) return true;
  const saturday = day === "saturday";
  if (saturday && schoolClass.saturdayEnabled === false) return false;
  if ((period.dayScope ?? "weekdays") !== (saturday ? "saturday" : "weekdays")) return false;
  const vacation = saturday ? (schoolClass.saturdayVacation ?? schoolClass.vacation) : schoolClass.vacation;
  return Boolean(vacation) && (period.vacation ?? vacation) === vacation;
}
