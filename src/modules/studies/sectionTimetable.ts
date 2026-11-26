import type { SchoolSection } from "../../types";
import { validateTimetable, type ScheduleProblem } from "./scheduleValidation";
import { overlaps } from "./studySchedule";
import { logicalStudyClasses } from "./studyCourseGroups";
import { studyClassSection } from "./studyScope";
import type { SchedulePeriod, ScheduleValidationIssue, ScheduleValidationReport, StudyClass, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";

/**
 * Lot R5 — horaire par section.
 *
 * Un horaire SANS `sectionId` est un horaire « toute l'école » (tous les horaires
 * existants, et ceux d'un compte qui agit pour toute l'école). Un horaire AVEC
 * `sectionId` ne concerne que les classes de cette section.
 *
 * Horaire publié visible : celui de chaque section qui a publié le sien ; pour
 * les autres sections, l'horaire publié pour toute l'école. Sans publication de
 * section, l'horaire publié pour toute l'école est rendu tel quel.
 */
export const TIMETABLE_SECTIONS: readonly SchoolSection[] = ["Maternelle", "Primaire", "CTEB", "Secondaire"];

export function timetableSection(timetable: Pick<Timetable, "sectionId"> | undefined): SchoolSection | undefined {
  const value = timetable?.sectionId;
  return value && TIMETABLE_SECTIONS.includes(value) ? value : undefined;
}

/** Même périmètre : même section, ou tous deux « toute l'école ». */
export function timetableInScope(timetable: Pick<Timetable, "sectionId">, section?: SchoolSection) {
  return (timetableSection(timetable) ?? null) === (section ?? null);
}

export function activePublishedTimetables<T extends Pick<Timetable, "status" | "activePublished">>(timetables: readonly T[]) {
  return timetables.filter((item) => item.status === "PUBLISHED" && item.activePublished === true);
}

function classSections(classes: readonly StudyClass[]) {
  // Les classes « de base » des options peuvent ne pas exister comme documents.
  const all = [...logicalStudyClasses(classes, classes).filter((item) => !classes.some((source) => source.id === item.id)), ...classes];
  return new Map(all.map((item) => [item.id, studyClassSection(item)]));
}

/** Données de l'horaire limitées aux classes (et affectations) d'une section. */
export function sectionScheduleProblem<T extends ScheduleProblem>(problem: T, section: SchoolSection): T {
  const classes = (problem.classes ?? []).filter((item) => studyClassSection(item) === section);
  const classIds = new Set(classes.map((item) => item.id));
  return { ...problem, classes, assignments: problem.assignments.filter((item) => classIds.has(item.classId)) };
}

/**
 * Créneaux de l'horaire publié visible. Sans publication de section, ce sont
 * exactement les créneaux de l'horaire publié pour toute l'école (même ordre).
 */
export function composePublishedEntries<T extends Pick<TimetableEntry, "scheduleId" | "classId">>(input: {
  published: readonly Pick<Timetable, "id" | "sectionId">[];
  entries: readonly T[];
  classes: readonly StudyClass[];
}): T[] {
  const wholeSchoolIds = new Set(input.published.filter((item) => !timetableSection(item)).map((item) => item.id));
  const sectionScheduleIds = new Set(input.published.filter((item) => timetableSection(item)).map((item) => item.id));
  const ownSections = new Set(input.published.map(timetableSection).filter(Boolean));
  if (!ownSections.size) return input.entries.filter((entry) => wholeSchoolIds.has(entry.scheduleId));
  const sections = classSections(input.classes);
  return input.entries.filter((entry) => {
    if (sectionScheduleIds.has(entry.scheduleId)) return true;
    if (!wholeSchoolIds.has(entry.scheduleId)) return false;
    const section = sections.get(entry.classId);
    return !section || !ownSections.has(section);
  });
}

/** Créneaux publiés des AUTRES sections (ce qu'une section doit respecter). */
export function otherSectionsPublishedEntries<T extends Pick<TimetableEntry, "scheduleId" | "classId">>(input: {
  section: SchoolSection;
  timetables: readonly Pick<Timetable, "id" | "sectionId" | "status" | "activePublished">[];
  entries: readonly T[];
  classes: readonly StudyClass[];
}): T[] {
  const sections = classSections(input.classes);
  return composePublishedEntries({ published: activePublishedTimetables(input.timetables), entries: input.entries, classes: input.classes })
    .filter((entry) => sections.get(entry.classId) !== input.section);
}

/**
 * Un enseignant qui a déjà cours dans une autre section est « occupé » sur ce
 * créneau : la génération et la vérification de la section en tiennent compte.
 */
export function otherSectionsOccupancy(input: {
  entries: readonly Pick<TimetableEntry, "id" | "teacherId" | "dayOfWeek" | "periodId" | "schoolId" | "schoolYearId">[];
  periods: readonly SchedulePeriod[];
}): TeacherAvailability[] {
  const periods = new Map(input.periods.map((item) => [item.id, item]));
  return input.entries.flatMap((entry) => {
    const period = periods.get(entry.periodId);
    if (!period?.startTime || !period.endTime) return [];
    return [{ id: `autre-section__${entry.id}`, schoolId: entry.schoolId, schoolYearId: entry.schoolYearId, teacherId: entry.teacherId,
      dayOfWeek: entry.dayOfWeek, status: "unavailable" as const, startTime: period.startTime, endTime: period.endTime, active: true,
      createdBy: "autre-section", createdAt: "", updatedAt: "" }];
  }).sort((left, right) => left.id.localeCompare(right.id));
}

/** Problème complet d'un horaire de section : ses classes + occupation des autres sections. */
export function sectionTimetableProblem<T extends ScheduleProblem>(input: {
  problem: T;
  section: SchoolSection;
  timetables: readonly Pick<Timetable, "id" | "sectionId" | "status" | "activePublished">[];
  entries: readonly TimetableEntry[];
  classes: readonly StudyClass[];
}) {
  const foreignEntries = otherSectionsPublishedEntries({ section: input.section, timetables: input.timetables, entries: input.entries, classes: input.classes });
  const scoped = sectionScheduleProblem(input.problem, input.section);
  const problem: T = { ...scoped, availabilities: [...scoped.availabilities, ...otherSectionsOccupancy({ entries: foreignEntries, periods: input.problem.periods })] };
  return { problem, foreignEntries };
}

/** Vérification d'un horaire de section : règles habituelles + salles partagées avec les autres sections. */
export function validateSectionTimetable(problem: ScheduleProblem, entries: TimetableEntry[], foreignEntries: readonly TimetableEntry[]): ScheduleValidationReport {
  const report = validateTimetable(problem, entries);
  const periods = new Map(problem.periods.map((item) => [item.id, item]));
  const roomIssues: ScheduleValidationIssue[] = [];
  for (const entry of entries) {
    const period = periods.get(entry.periodId);
    if (!entry.roomId || !period) continue;
    const clash = foreignEntries.find((other) => other.roomId === entry.roomId && other.dayOfWeek === entry.dayOfWeek
      && Boolean(periods.get(other.periodId)) && overlaps(period, periods.get(other.periodId)!));
    if (clash) roomIssues.push({ code: "ROOM_OVERLAP", message: "Cette salle est déjà occupée par une autre section sur ce créneau. Changez de salle ou de créneau.",
      entityId: entry.id, day: entry.dayOfWeek, periodId: entry.periodId, metadata: { conflictingEntryId: clash.id } });
  }
  if (!roomIssues.length) return report;
  return { ...report, valid: false, errors: [...report.errors, ...roomIssues] };
}
