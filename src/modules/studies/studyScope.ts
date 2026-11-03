import type { SchoolClass, SchoolSection } from "../../types";
import { getClassSection } from "../../utils/studentClasses";
import { normalizeSchoolSection } from "../../utils/schoolSections";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyDay, StudyDayVacation, StudySubject, StudyVacation, TimetableEntry } from "./studyTypes";
import { classOptionId, normalizedAssignmentScope } from "./studyCourseGroups";

export const studySectionLabels: Record<SchoolSection, string> = { Maternelle: "Maternelle", Primaire: "Primaire", CTEB: "CTEB", Secondaire: "Secondaire" };
export const studyVacationLabels: Record<StudyVacation, string> = { morning: "Avant-midi", afternoon: "Après-midi" };
export const primaryTeacherSections: SchoolSection[] = ["Maternelle", "Primaire"];

export function currentTimetableEntries(entries: TimetableEntry[]) {
  return entries.filter((item) => item.active !== false);
}

export function studyClassSection(item: StudyClass): SchoolSection {
  return normalizeSchoolSection(item.section) ?? getClassSection(item.name as SchoolClass);
}

function normalizedClassLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
}

export function operationalClassLabel(item: StudyClass) {
  const option = item.option?.trim();
  const subclass = item.subClassLabel?.trim();
  const normalizedName = normalizedClassLabel(item.name);
  return [
    item.name,
    option && !normalizedName.includes(normalizedClassLabel(option)) ? option : "",
    subclass && !normalizedName.endsWith(normalizedClassLabel(subclass)) ? subclass : "",
  ].filter(Boolean).join(" ");
}

export function subjectAppliesToClass(subject: StudySubject, schoolClass: StudyClass) {
  if (subject.section && subject.section !== studyClassSection(schoolClass)) return false;
  return !subject.classIds?.length || subject.classIds.includes(schoolClass.id);
}

export function periodAppliesToClass(period: SchedulePeriod, schoolClass: StudyClass, day: StudyDay) {
  if (period.targetPairs && !period.targetPairs.includes(`${schoolClass.id}|${day}`)) return false;
  if (!schoolClass.dayVacations?.[day] && !period.targetPairs && !schoolClass.vacation && !period.vacation && !period.dayScope) return true;
  const saturday = day === "saturday";
  if (saturday && schoolClass.saturdayEnabled === false && !schoolClass.dayVacations?.saturday) return false;
  if (!period.targetPairs && (period.dayScope ?? "weekdays") !== (saturday ? "saturday" : "weekdays")) return false;
  // Les classes historiques n'avaient pas de vacation persistée. Le reste de
  // l'éditeur les interprète déjà comme des classes du matin ; appliquer la
  // même normalisation ici évite de supprimer tous leurs créneaux modernes.
  const legacyVacation = saturday
    ? (schoolClass.saturdayVacation ?? schoolClass.vacation ?? "morning")
    : (schoolClass.vacation ?? "morning");
  const vacation: StudyDayVacation = schoolClass.dayVacations?.[day] ?? legacyVacation;
  if (vacation === "none") return false;
  return vacation === "full" || (period.vacation ?? legacyVacation) === vacation;
}

export function studyDayVacation(schoolClass: StudyClass, day: StudyDay): StudyDayVacation {
  if (schoolClass.dayVacations?.[day]) return schoolClass.dayVacations[day];
  if (day === "saturday" && schoolClass.saturdayEnabled === false) return "none";
  return day === "saturday" ? schoolClass.saturdayVacation ?? schoolClass.vacation ?? "morning" : schoolClass.vacation ?? "morning";
}

export function periodTargetPairs(classes: readonly StudyClass[], days: readonly StudyDay[], vacation: StudyVacation) {
  return classes.flatMap((schoolClass) => days.filter((day) => {
    const assigned = studyDayVacation(schoolClass, day);
    return assigned === vacation || assigned === "full";
  }).map((day) => `${schoolClass.id}|${day}`)).sort();
}

export function assignmentVacationClasses(assignment: PedagogicalAssignment, classes: readonly StudyClass[]) {
  const scope = normalizedAssignmentScope(assignment, classes);
  if (scope.optionIds?.length) {
    const targets = new Set(scope.optionIds);
    return classes.filter((item) => {
      const optionId = classOptionId(item);
      return Boolean(optionId && targets.has(optionId));
    });
  }
  const base = classes.find((item) => item.id === scope.baseClassId);
  return base ? [base] : [];
}

export function periodAppliesToAssignment(period: SchedulePeriod, assignment: PedagogicalAssignment, classes: readonly StudyClass[], day: StudyDay) {
  const targetClasses = assignmentVacationClasses(assignment, classes);
  return targetClasses.length > 0 && targetClasses.every((item) => periodAppliesToClass(period, item, day));
}
