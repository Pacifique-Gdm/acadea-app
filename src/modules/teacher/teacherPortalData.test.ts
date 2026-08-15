import { describe, expect, it } from "vitest";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudySubject, TimetableEntry } from "../studies/studyTypes";
import { currentStudyDay, nextTeacherEntry, scopeTeacherPortalData, teacherEntriesForDay, weeklyWorkload } from "./teacherPortalData";

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
  it("identifie le jour pédagogique et trie les cours par période", () => {
    expect(currentStudyDay(new Date(2026, 7, 10, 8, 30))).toBe("monday");
    expect(teacherEntriesForDay(entries, periods, "monday").map((entry) => entry.id)).toEqual(["e1", "e2"]);
  });

  it("détermine le prochain cours sans exposer un autre jour", () => {
    expect(nextTeacherEntry(entries, periods, new Date(2026, 7, 10, 8, 30))?.id).toBe("e1");
    expect(nextTeacherEntry(entries, periods, new Date(2026, 7, 10, 10, 30))).toBeUndefined();
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
});
