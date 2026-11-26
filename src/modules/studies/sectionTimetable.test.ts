import { describe, expect, it } from "vitest";
import type { ScheduleProblem } from "./scheduleValidation";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, Timetable, TimetableEntry } from "./studyTypes";
import { composePublishedEntries, otherSectionsOccupancy, otherSectionsPublishedEntries, sectionScheduleProblem, sectionTimetableProblem, timetableInScope, timetableSection, validateSectionTimetable } from "./sectionTimetable";

const scope = { schoolId: "s", schoolYearId: "y" };
const classes = [
  { ...scope, id: "p1", name: "1ère Primaire", active: true },
  { ...scope, id: "h1", name: "1ère Humanité", active: true },
] as StudyClass[];
const timetable = (id: string, extra: Partial<Timetable> = {}) => ({ ...scope, id, version: 1, status: "PUBLISHED", activeDraft: false, activePublished: true, createdBy: "u", createdAt: "n", updatedAt: "n", generationMetadata: {} as Timetable["generationMetadata"], ...extra }) as Timetable;
const entry = (id: string, scheduleId: string, classId: string, extra: Partial<TimetableEntry> = {}) => ({ ...scope, id, scheduleId, classId, teacherId: "t", subjectId: "m", assignmentId: `a-${classId}`, dayOfWeek: "monday", periodId: "p", roomId: null, createdAt: "n", updatedAt: "n", ...extra }) as TimetableEntry;

describe("horaire par section (R5)", () => {
  it("un horaire sans section reste l'horaire de toute l'école", () => {
    expect(timetableSection(timetable("w"))).toBeUndefined();
    expect(timetableSection(timetable("p", { sectionId: "Primaire" }))).toBe("Primaire");
    expect(timetableInScope(timetable("w"))).toBe(true);
    expect(timetableInScope(timetable("w"), "Primaire")).toBe(false);
    expect(timetableInScope(timetable("p", { sectionId: "Primaire" }), "Primaire")).toBe(true);
  });

  it("sans publication de section, l'horaire publié est rendu EXACTEMENT pareil", () => {
    const entries = [entry("2", "w", "h1"), entry("1", "w", "p1"), entry("3", "old", "p1"), entry("4", "w", "inconnue")];
    expect(composePublishedEntries({ published: [timetable("w")], entries, classes })).toEqual([entries[0], entries[1], entries[3]]);
  });

  it("une section qui publie remplace seulement ses classes ; les autres gardent l'horaire de l'école", () => {
    const entries = [entry("w-p", "w", "p1"), entry("w-h", "w", "h1"), entry("p-p", "prim", "p1"), entry("w-x", "w", "inconnue")];
    const published = [timetable("w"), timetable("prim", { sectionId: "Primaire" })];
    expect(composePublishedEntries({ published, entries, classes }).map((item) => item.id)).toEqual(["w-h", "p-p", "w-x"]);
  });

  it("les créneaux des autres sections occupent l'enseignant", () => {
    const entries = [entry("w-p", "w", "p1"), entry("w-h", "w", "h1", { teacherId: "t2" })];
    const foreign = otherSectionsPublishedEntries({ section: "Primaire", timetables: [timetable("w")], entries, classes });
    expect(foreign.map((item) => item.id)).toEqual(["w-h"]);
    const periods = [{ ...scope, id: "p", startTime: "08:00", endTime: "08:50" }] as SchedulePeriod[];
    expect(otherSectionsOccupancy({ entries: foreign, periods })).toMatchObject([{ teacherId: "t2", dayOfWeek: "monday", status: "unavailable", startTime: "08:00", endTime: "08:50", active: true }]);
  });

  it("le problème d'une section ne garde que ses classes et ses affectations", () => {
    const assignments = [{ id: "a-p1", classId: "p1" }, { id: "a-h1", classId: "h1" }] as PedagogicalAssignment[];
    const problem: ScheduleProblem = { ...scope, classes, assignments, availabilities: [], periods: [] };
    const scoped = sectionScheduleProblem(problem, "Secondaire");
    expect(scoped.classes?.map((item) => item.id)).toEqual(["h1"]);
    expect(scoped.assignments.map((item) => item.id)).toEqual(["a-h1"]);
    expect(problem.assignments).toHaveLength(2);
  });

  it("refuse une salle déjà occupée par une autre section", () => {
    const periods = [{ ...scope, id: "p", label: "P1", startTime: "08:00", endTime: "08:50", order: 1, type: "course", active: true }] as SchedulePeriod[];
    const assignments = [{ ...scope, id: "a-h1", classId: "h1", teacherId: "t", subjectId: "m", weeklyPeriods: 1, active: true }] as PedagogicalAssignment[];
    const base: ScheduleProblem = { ...scope, classes, assignments, availabilities: [], periods };
    const mine = [entry("mine", "draft", "h1", { assignmentId: "a-h1", roomId: "salle" })];
    expect(validateSectionTimetable(base, mine, []).valid).toBe(true);
    const report = validateSectionTimetable(base, mine, [entry("other", "w", "p1", { roomId: "salle", teacherId: "x" })]);
    expect(report.valid).toBe(false);
    expect(report.errors.map((item) => item.code)).toContain("ROOM_OVERLAP");
  });

  it("un enseignant déjà en cours dans une autre section est indisponible pour la section", () => {
    const periods = [{ ...scope, id: "p", label: "P1", startTime: "08:00", endTime: "08:50", order: 1, type: "course", active: true }] as SchedulePeriod[];
    const assignments = [{ ...scope, id: "a-h1", classId: "h1", teacherId: "t", subjectId: "m", weeklyPeriods: 1, active: true }, { ...scope, id: "a-p1", classId: "p1", teacherId: "t", subjectId: "m", weeklyPeriods: 1, active: true }] as PedagogicalAssignment[];
    const { problem, foreignEntries } = sectionTimetableProblem({ problem: { ...scope, classes, assignments, availabilities: [], periods }, section: "Secondaire",
      timetables: [timetable("w")], entries: [entry("w-p", "w", "p1", { assignmentId: "a-p1" })], classes });
    expect(foreignEntries.map((item) => item.id)).toEqual(["w-p"]);
    expect(problem.assignments.map((item) => item.id)).toEqual(["a-h1"]);
    const report = validateSectionTimetable(problem, [entry("mine", "draft", "h1", { assignmentId: "a-h1" })], foreignEntries);
    expect(report.errors.map((item) => item.code)).toContain("TEACHER_UNAVAILABLE");
  });
});
