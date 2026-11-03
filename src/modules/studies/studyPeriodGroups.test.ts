import { describe, expect, it } from "vitest";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import { periodTargetPairs, periodAppliesToClass } from "./studyScope";
import { arePeriodsPedagogicallyConsecutive, validatePeriod } from "./studySchedule";
import { validateTimetable } from "./scheduleValidation";
import { DeterministicTimetableSolver } from "./timetableSolver";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyDay, TimetableEntry } from "./studyTypes";

const schoolClass = (id: string, dayVacations: StudyClass["dayVacations"]): StudyClass => ({ id, schoolId: "school", schoolYearId: "year", name: id, active: true, vacation: "morning", dayVacations });
const period = (id: string, targetPairs: string[], order: number, startTime: string, endTime: string): SchedulePeriod => ({ id, targetPairs, schoolId: "school", schoolYearId: "year", label: id, startTime, endTime, order, type: "course", active: true, vacation: "morning", dayScope: "weekdays", createdBy: "director", createdAt: "now", updatedAt: "now" });

describe("périodes collectives classe/jour", () => {
  const first = schoolClass("a", { monday: "morning", tuesday: "morning", wednesday: "full", thursday: "afternoon", friday: "none" });
  const second = schoolClass("b", { monday: "none", tuesday: "morning", wednesday: "afternoon", thursday: "morning", friday: "afternoon" });
  const other = schoolClass("other", { monday: "morning" });
  const fiveDays = resolveAttendanceSchoolDays({ id: "settings", schoolId: "school", schoolYearId: "year", schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] });
  const sixDays = resolveAttendanceSchoolDays({ id: "settings", schoolId: "school", schoolYearId: "year", schoolDays: [...fiveDays, "saturday"] });

  it("respecte cinq et six jours, sans imposer le samedi", () => {
    expect(fiveDays).toHaveLength(5);
    expect(sixDays).toHaveLength(6);
    expect(periodTargetPairs([first], fiveDays, "morning")).not.toContain("a|saturday");
    expect(periodTargetPairs([first], sixDays, "morning")).toContain("a|saturday");
  });

  it("groupe une ou plusieurs classes, et préserve les autres", () => {
    const one = periodTargetPairs([first], fiveDays, "morning");
    const many = periodTargetPairs([first, second], fiveDays, "morning");
    expect(one).toEqual(["a|monday", "a|tuesday", "a|wednesday"]);
    expect(many).toEqual(["a|monday", "a|tuesday", "a|wednesday", "b|thursday", "b|tuesday"]);
    const shared = period("morning", many, 1, "07:30", "08:20");
    for (const pair of many) {
      const [id, day] = pair.split("|") as [string, StudyDay];
      expect(periodAppliesToClass(shared, id === "a" ? first : second, day)).toBe(true);
    }
    expect(periodAppliesToClass(shared, other, "monday")).toBe(false);
    expect(periodAppliesToClass(shared, first, "friday")).toBe(false);
  });

  it("refuse un chevauchement sur un même groupe, mais pas sur un groupe distinct", () => {
    const firstPeriod = period("one", ["a|monday", "a|tuesday"], 1, "07:30", "08:20");
    expect(validatePeriod(period("overlap", ["a|monday"], 2, "08:00", "09:00"), [firstPeriod])).toMatch(/chevauche/);
    expect(validatePeriod(period("other", ["b|monday"], 1, "07:30", "08:20"), [firstPeriod])).toBe("");
    expect(validatePeriod(period("invalid", [], 1, "07:30", "08:20"), [])).not.toBe("");
  });

  it("conserve la continuité des périodes d'un groupe sans mélanger une autre classe", () => {
    const pair = ["a|monday", "a|tuesday"];
    const p1 = period("one", pair, 1, "07:30", "08:20");
    const p2 = period("two", pair, 2, "08:20", "09:10");
    const unrelated = period("unrelated", ["b|monday"], 1, "08:20", "09:10");
    expect(arePeriodsPedagogicallyConsecutive([p1, p2], [p1, unrelated, p2])).toBe(true);
  });

  it("le validateur partagé refuse un cours sur un jour sans cours ou hors groupe", () => {
    const assignment: PedagogicalAssignment = { id: "assignment", schoolId: "school", schoolYearId: "year", classId: "a", teacherId: "teacher", subjectId: "subject", weeklyPeriods: 1, active: true, createdBy: "director", updatedBy: "director", createdAt: "now", updatedAt: "now" };
    const entry: TimetableEntry = { id: "entry", scheduleId: "schedule", schoolId: "school", schoolYearId: "year", classId: "a", teacherId: "teacher", subjectId: "subject", assignmentId: "assignment", dayOfWeek: "monday", periodId: "morning", roomId: null, createdAt: "now", updatedAt: "now" };
    const problem = { schoolId: "school", schoolYearId: "year", assignments: [assignment], classes: [first, second], periods: [period("morning", ["a|monday"], 1, "07:30", "08:20")], availabilities: [], days: fiveDays };
    expect(validateTimetable(problem, [entry]).valid).toBe(true);
    expect(validateTimetable(problem, [{ ...entry, dayOfWeek: "friday" }]).errors.map((error) => error.code)).toContain("CLASS_VACATION");
    expect(validateTimetable(problem, [{ ...entry, classId: "b", dayOfWeek: "monday", assignmentId: "other" }]).valid).toBe(false);
  });

  it("le vrai solveur utilise le groupe collectif sans placer de cours le jour interdit", () => {
    const assignment: PedagogicalAssignment = { id: "assignment", schoolId: "school", schoolYearId: "year", classId: "a", teacherId: "teacher", subjectId: "subject", weeklyPeriods: 1, active: true, createdBy: "director", updatedBy: "director", createdAt: "now", updatedAt: "now" };
    const scoped = period("morning", periodTargetPairs([first, second], fiveDays, "morning"), 1, "07:30", "08:20");
    const problem = { schoolId: "school", schoolYearId: "year", assignments: [assignment], classes: [first, second], periods: [scoped], availabilities: [], days: fiveDays };
    const result = new DeterministicTimetableSolver().solve(problem);
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].dayOfWeek).not.toBe("friday");
    expect(validateTimetable(problem, result.entries).valid).toBe(true);
  });
});
