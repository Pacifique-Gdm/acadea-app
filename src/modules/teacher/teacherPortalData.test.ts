import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudySubject, TimetableEntry } from "../studies/studyTypes";
import { currentStudyDay, nextTeacherEntry, schoolStudyDay, scopeTeacherPortalData, teacherCourseState, teacherEntriesForDay, teacherNextAvailableCourse, weeklyWorkload } from "./teacherPortalData";
import type { SchoolCalendar } from "../studies/schoolCalendar";

const periods = [
  { id: "p2", order: 2, startTime: "09:00", endTime: "10:00", active: true },
  { id: "p1", order: 1, startTime: "08:00", endTime: "09:00", active: true },
] as SchedulePeriod[];
const entries = [
  { id: "e2", dayOfWeek: "monday", periodId: "p2" },
  { id: "e1", dayOfWeek: "monday", periodId: "p1" },
  { id: "e3", dayOfWeek: "tuesday", periodId: "p1" },
] as TimetableEntry[];

describe("données du portail Enseignant", () => {
  it("distingue les états de la journée avec début inclus et fin exclue", () => {
    const at = (hour: string) => new Date(`2026-08-10T${hour}:00Z`);
    const status = (hour: string) => teacherCourseState(entries, periods, at(hour), "UTC", true);
    expect(status("07:59")).toMatchObject({ status: "before", entry: { id: "e1" } });
    expect(status("08:00")).toMatchObject({ status: "during", entry: { id: "e1" } });
    expect(status("08:59")).toMatchObject({ status: "during", entry: { id: "e1" } });
    expect(status("09:00")).toMatchObject({ status: "during", entry: { id: "e2" } });
    expect(status("10:00")).toEqual({ status: "finished" });
    expect(status("10:30")).toEqual({ status: "finished" });
  });

  it("gère l'absence de publication, de fuseau et de cours et utilise le fuseau de l'école", () => {
    const date = new Date("2026-08-10T07:30:00Z");
    expect(teacherCourseState(entries, periods, date, "Africa/Kinshasa", false)).toEqual({ status: "unpublished" });
    expect(teacherCourseState(entries, periods, date, undefined, true)).toEqual({ status: "timezone-missing" });
    expect(teacherCourseState(entries, periods, date, "Invalid/Zone", true)).toEqual({ status: "timezone-missing" });
    expect(teacherCourseState(entries, periods, date, "UTC", true)).toMatchObject({ status: "before", entry: { id: "e1" } });
    expect(teacherCourseState(entries, periods, date, "Africa/Kinshasa", true)).toMatchObject({ status: "during", entry: { id: "e1" } });
    expect(teacherCourseState(entries, periods, new Date("2026-08-09T07:30:00Z"), "UTC", true)).toEqual({ status: "no-courses" });
  });

  it("signale les périodes manquantes et les chevauchements au lieu de choisir arbitrairement", () => {
    const date = new Date("2026-08-10T08:30:00Z");
    expect(teacherCourseState(entries, periods.slice(0, 1), date, "UTC", true)).toEqual({ status: "incomplete" });
    const overlapping = [{ ...periods[0], startTime: "08:30" }, periods[1]] as SchedulePeriod[];
    expect(teacherCourseState(entries, overlapping, date, "UTC", true)).toEqual({ status: "overlap" });
  });

  it("passe au prochain cours après une pause et au jour local de l'établissement", () => {
    const separated = [{ ...periods[0], startTime: "09:15" }, periods[1]] as SchedulePeriod[];
    expect(teacherCourseState(entries, separated, new Date("2026-08-10T09:00:00Z"), "UTC", true)).toMatchObject({ status: "between", entry: { id: "e2" } });
    expect(teacherCourseState(entries, periods, new Date("2026-08-09T23:30:00Z"), "Africa/Kinshasa", true)).toMatchObject({ status: "before", entry: { id: "e1" } });
  });

  it("identifie le jour pédagogique et trie les cours par période", () => {
    expect(currentStudyDay(new Date(2026, 7, 10, 8, 30))).toBe("monday");
    expect(schoolStudyDay(new Date("2026-08-09T23:30:00Z"), "Africa/Kinshasa")).toBe("monday");
    expect(schoolStudyDay(new Date("2026-08-09T23:30:00Z"), undefined)).toBeUndefined();
    expect(teacherEntriesForDay(entries, periods, "monday").map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });

  it("détermine le prochain cours aujourd’hui puis sur les jours scolaires suivants", () => {
    expect(nextTeacherEntry(entries, periods, new Date(2026, 7, 10, 8, 30))?.id).toBe("e1");
    expect(nextTeacherEntry(entries, periods, new Date(2026, 7, 10, 10, 30))?.id).toBe("e3");
    expect(nextTeacherEntry([{ id: "monday", dayOfWeek: "monday", periodId: "p1" }] as TimetableEntry[], periods, new Date(2026, 7, 14, 18, 0))?.id).toBe("monday");
    expect(nextTeacherEntry([], periods, new Date(2026, 7, 10, 10, 30))).toBeUndefined();
  });
  it("ignore une séance terminée ou suspendue et trouve le prochain jour", () => {
    const monday = new Date("2026-08-10T10:30:00Z");
    expect(teacherNextAvailableCourse(entries, periods, monday, "UTC", true)).toMatchObject({ status: "future", entry: { id: "e3" }, date: "2026-08-11" });
    const calendar: SchoolCalendar = { schoolId: "a", schoolYearId: "y", status: "validated", updatedAt: "now", updatedBy: "u", events: [{ id: "s", title: "Suspension", kind: "suspension", startsAt: "2026-08-11", endsAt: "2026-08-11", origin: "local", suspendsCourses: true }] };
    expect(teacherNextAvailableCourse(entries, periods, monday, "UTC", true, calendar)).toMatchObject({ status: "future", entry: { id: "e1" }, date: "2026-08-17" });
    expect(teacherNextAvailableCourse(entries, periods, monday, "UTC", true, { ...calendar, status: "draft" })).toMatchObject({ status: "future", entry: { id: "e3" } });
    expect(teacherNextAvailableCourse(entries, periods, monday, "Invalid/Zone", true)).toEqual({ status: "timezone-missing" });
  });

  it("écarte seulement les cours du niveau suspendu par un PDF vérifié", () => {
    const monday = new Date("2026-08-10T10:30:00Z");
    const scopedEntries = [
      { ...entries[2], classId: "primary", id: "primary-course" },
      { ...entries[2], classId: "secondary", id: "secondary-course" },
    ];
    const classes = [
      { id: "primary", name: "1ère Primaire", section: "Primaire" },
      { id: "secondary", name: "1ère Humanité", section: "Secondaire" },
    ] as StudyClass[];
    const calendar: SchoolCalendar = { schoolId: "a", schoolYearId: "y", status: "validated", updatedAt: "now", updatedBy: "u", events: [{ id: "s", title: "Suspension primaire", kind: "suspension", startsAt: "2026-08-11", endsAt: "2026-08-11", origin: "pdf-import", sourcePdfPath: "school-calendars/a/y/123e4567-e89b-12d3-a456-426614174000.pdf", sourcePage: 1, educationLevel: "Primaire", suspendsCourses: true }] };
    expect(teacherNextAvailableCourse(scopedEntries, periods, monday, "UTC", true, calendar, classes)).toMatchObject({ status: "future", entry: { id: "secondary-course" }, date: "2026-08-11" });
  });

  it("calcule uniquement la charge des affectations actives", () => {
    expect(weeklyWorkload([{ active: true, weeklyPeriods: 4 }, { active: false, weeklyPeriods: 9 }, { active: true, weeklyPeriods: 3 }] as PedagogicalAssignment[])).toBe(7);
  });
  it("affiche la même affectation canonique que la Direction malgré un classIds de cours legacy", () => {
    const assignment = { id: "a1", teacherId: "t1", subjectId: "math", classId: "4a", active: true, weeklyPeriods: 4 } as PedagogicalAssignment;
    const subject = { id: "math", name: "Mathématiques", classIds: ["5a"] } as StudySubject;
    const studyClass = { id: "4a", schoolId: "school-a", schoolYearId: "year-a", name: "4e A", section: "Secondaire" } as StudyClass;
    const scoped = scopeTeacherPortalData({ section: "Secondaire", sectionIds: ["Secondaire"] }, {
      assignments: [assignment], subjects: [subject], classes: [studyClass], rooms: [], periods: [], entries: [], loading: false, error: "",
    });
    expect(scoped.assignments).toEqual([assignment]);
    expect(scoped.subjects).toEqual([subject]);
  });

  it("conserve la frontière de publication de Mon horaire", () => {
    const source = readFileSync(new URL("./teacherPortalService.ts", import.meta.url), "utf8");
    expect(source).toContain('where("status", "==", "PUBLISHED")');
    expect(source).toContain('where("activePublished", "==", true)');
    expect(source).not.toContain('where("persistenceState", "==", "COMPLETE")');
  });
});
