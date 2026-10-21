import { describe, expect, it } from "vitest";
import { validateTimetable, type ScheduleProblem } from "./scheduleValidation";
import { currentStudyTimetable } from "./studySchedule";
import { DeterministicTimetableSolver } from "./timetableSolver";
import type { Timetable, TimetableEntry } from "./studyTypes";

function fixture() {
  const scope = { schoolId: "school", schoolYearId: "year" }, audit = { createdAt: "n", updatedAt: "n", createdBy: "director" };
  const problem: ScheduleProblem = { ...scope, days: ["monday", "tuesday"], maxSameAssignmentPeriodsPerDay: 2,
    teachers: [{ ...scope, ...audit, id: "teacher", firstName: "Test", lastName: "Prof", fullName: "Test Prof", status: "active" }],
    subjects: [{ ...scope, ...audit, id: "math", name: "Mathématiques", active: true }],
    classes: [{ ...scope, id: "class", name: "Classe fictive", active: true }],
    rooms: [{ ...scope, ...audit, id: "room", name: "Salle fictive", active: true }],
    assignments: [{ ...scope, ...audit, id: "assignment", teacherId: "teacher", subjectId: "math", classId: "class", weeklyPeriods: 2, active: true, updatedBy: "director" }],
    availabilities: [], periods: [{ ...scope, ...audit, id: "p1", label: "Première", startTime: "08:00", endTime: "09:00", order: 1, type: "course", active: true },
      { ...scope, ...audit, id: "p2", label: "Seconde", startTime: "08:30", endTime: "09:30", order: 2, type: "course", active: true }],
  };
  const entries: TimetableEntry[] = ["p1", "p2"].map((periodId, i) => ({ ...scope, ...audit, id: `entry-${i}`, scheduleId: "draft", teacherId: "teacher", subjectId: "math", classId: "class", assignmentId: "assignment", dayOfWeek: "monday", periodId, roomId: "room" }));
  return { problem, entries };
}
describe("sécurité des horaires réels", () => {
  it("détecte trois conflits entre périodes d'identifiants différents et décrit les deux séances", () => {
    const { problem, entries } = fixture(), report = validateTimetable(problem, entries);
    expect(report.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["TEACHER_OVERLAP", "CLASS_OVERLAP", "ROOM_OVERLAP"]));
    expect(report.errors[0].metadata?.entries).toEqual([expect.stringContaining("08:00–09:00"), expect.stringContaining("08:30–09:30")]);
  });
  it("autorise deux cours contigus", () => { const { problem, entries } = fixture(); problem.periods[1].startTime = "09:00"; expect(validateTimetable(problem, entries).valid).toBe(true); });
  it("ne compare pas les jours différents", () => { const { problem, entries } = fixture(); entries[1].dayOfWeek = "tuesday"; expect(validateTimetable(problem, entries).valid).toBe(true); });
  it.each([
    ["enseignant inactif", "INVALID_ASSIGNMENT", (p: ScheduleProblem) => { p.teachers![0].status = "inactive"; }],
    ["matière inactive", "INVALID_ASSIGNMENT", (p: ScheduleProblem) => { p.subjects![0].active = false; }],
    ["classe inactive", "INVALID_ASSIGNMENT", (p: ScheduleProblem) => { p.classes![0].active = false; }],
    ["affectation inactive", "INVALID_ASSIGNMENT", (p: ScheduleProblem) => { p.assignments[0].active = false; }],
    ["période inactive", "NON_TEACHING_PERIOD", (p: ScheduleProblem) => { p.periods[0].active = false; }],
    ["période autre année", "NON_TEACHING_PERIOD", (p: ScheduleProblem) => { p.periods[0].schoolYearId = "other"; }],
    ["heure impossible", "INVALID_TIME", (p: ScheduleProblem) => { p.periods[0].endTime = "29:00"; }],
    ["jour non scolaire", "NON_SCHOOL_DAY", (p: ScheduleProblem) => { p.days = ["saturday"]; }],
    ["salle inactive", "INVALID_ROOM", (p: ScheduleProblem) => { p.rooms![0].active = false; }],
    ["volume invalide", "WEEKLY_VOLUME_MISMATCH", (p: ScheduleProblem) => { p.assignments[0].weeklyPeriods = 1.5; }],
  ] as const)("refuse %s", (_, code, change) => { const { problem, entries } = fixture(); change(problem); expect(validateTimetable(problem, entries).errors.map((item) => item.code)).toContain(code); });
  it("refuse le vide même sans affectation", () => { const { problem } = fixture(); problem.assignments = []; expect(validateTimetable(problem, []).errors[0].code).toBe("EMPTY_TIMETABLE"); });
  it("le solveur place des périodes se chevauchant sur des jours distincts", () => {
    const { problem } = fixture(); const result = new DeterministicTimetableSolver().solve(problem);
    expect(result.success).toBe(true); expect(new Set(result.entries.map((entry) => entry.dayOfWeek)).size).toBe(2);
  });
  it("conserve la version validée devant l'ancienne publication", () => {
    const old = { id: "old", version: 1, status: "PUBLISHED", activePublished: true, activeDraft: false } as Timetable;
    const current = { id: "new", version: 2, status: "VALID", activeDraft: false } as Timetable;
    expect(currentStudyTimetable([current, old])?.id).toBe("new");
    expect(currentStudyTimetable([{ ...current, version: 0 }, old])?.id).toBe("old");
  });
});
