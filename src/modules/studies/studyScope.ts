import type { SchoolClass, SchoolSection } from "../../types";
import { getClassSection } from "../../utils/studentClasses";
import { normalizeSchoolSection } from "../../utils/schoolSections";
import type { SchedulePeriod, StudyClass, StudyDay, StudySubject, StudyVacation, TimetableEntry } from "./studyTypes";

export const studySectionLabels: Record<SchoolSection, string> = { Maternelle: "Maternelle", Primaire: "Primaire", CTEB: "CTEB", Secondaire: "Secondaire" };
export const studyVacationLabels: Record<StudyVacation, string> = { morning: "Avant-midi", afternoon: "Après-midi" };
export const primaryTeacherSections: SchoolSection[] = ["Maternelle", "Primaire"];

export function currentTimetableEntries(entries: TimetableEntry[]) {
  return entries.filter((item) => item.active !== false);
}

export function studyClassSection(item: StudyClass): SchoolSection {
  return normalizeSchoolSection(item.section) ?? getClassSection(item.name as SchoolClass);
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
  // Les classes historiques n'avaient pas de vacation persistée. Le reste de
  // l'éditeur les interprète déjà comme des classes du matin ; appliquer la
  // même normalisation ici évite de supprimer tous leurs créneaux modernes.
  const vacation = saturday
    ? (schoolClass.saturdayVacation ?? schoolClass.vacation ?? "morning")
    : (schoolClass.vacation ?? "morning");
  return (period.vacation ?? vacation) === vacation;
}
