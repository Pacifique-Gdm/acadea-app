import { describe, expect, it } from "vitest";
import { classifyScheduleAssignmentChanges, prepareIncrementalFixedEntries } from "./incrementalSchedule";
import type { ScheduleProblem } from "./scheduleValidation";
import { scheduleIsStale, timetableSourceFingerprint } from "./scheduleSource";
import { DeterministicTimetableSolver } from "./timetableSolver";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, TeacherAvailability, TimetableEntry } from "./studyTypes";

const solver = new DeterministicTimetableSolver();
const period = (id: string, order: number, type: SchedulePeriod["type"] = "course"): SchedulePeriod => ({ id, schoolId: "s", schoolYearId: "y", label: id, startTime: `${String(7 + order).padStart(2, "0")}:00`, endTime: `${String(8 + order).padStart(2, "0")}:00`, order, type, active: true, createdBy: "u", createdAt: "n", updatedAt: "n" });
const assignment = (id: string, weeklyPeriods = 1, overrides: Partial<PedagogicalAssignment> = {}): PedagogicalAssignment => ({ id, schoolId: "s", schoolYearId: "y", teacherId: `teacher-${id}`, subjectId: `subject-${id}`, classId: `class-${id}`, weeklyPeriods, blockSize: 1, active: true, createdBy: "u", updatedBy: "u", createdAt: "n", updatedAt: "n", ...overrides });
const schoolClass = (id: string): StudyClass => ({ id, schoolId: "s", schoolYearId: "y", name: id, active: true });
const problem = (assignments: PedagogicalAssignment[], overrides: Partial<ScheduleProblem> = {}): ScheduleProblem => ({ schoolId: "s", schoolYearId: "y", assignments, availabilities: [], periods: [period("p1", 1), period("p2", 2), period("p3", 3)], classes: assignments.map((item) => schoolClass(item.classId)), days: ["monday", "tuesday", "wednesday"], maxSameAssignmentPeriodsPerDay: 2, ...overrides });
const solve = (input: ScheduleProblem) => {
  const result = solver.solve(input);
  expect(result.success).toBe(true);
  return result.entries;
};
const positions = (entries: TimetableEntry[]) => entries.map((item) => `${item.assignmentId}|${item.dayOfWeek}|${item.periodId}`).sort();

describe("fraîcheur canonique des horaires", () => {
  it("reste stable malgré l’ordre Firestore et les champs enseignant non pédagogiques", () => {
    const first = problem([assignment("a"), assignment("b")], { teachers: [{ id: "teacher-a", schoolId: "s", schoolYearId: "y", firstName: "A", lastName: "Test", fullName: "A Test", phone: "1", status: "active", createdAt: "n", updatedAt: "n", createdBy: "u" }] });
    const second = { ...first, assignments: [...first.assignments].reverse(), periods: [...first.periods].reverse(), teachers: [{ ...first.teachers![0], phone: "2", fullName: "Nouveau nom" }] };
    expect(timetableSourceFingerprint(second)).toBe(timetableSourceFingerprint(first));
  });

  it("change pour une affectation ajoutée ou un volume hebdomadaire modifié", () => {
    const first = problem([assignment("a", 4)]);
    const schedule = { generationMetadata: { algorithm: "deterministic-backtracking" as const, exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2, sourceFingerprint: timetableSourceFingerprint(first) } };
    expect(scheduleIsStale(schedule, first)).toBe(false);
    expect(scheduleIsStale(schedule, problem([assignment("a", 4), assignment("b")]))).toBe(true);
    expect(scheduleIsStale(schedule, problem([assignment("a", 5)]))).toBe(true);
    expect(scheduleIsStale({ generationMetadata: { ...schedule.generationMetadata, sourceFingerprint: undefined } }, first)).toBe(true);
  });

  it("change pour une disponibilité active pertinente", () => {
    const first = problem([assignment("a")]);
    const availability: TeacherAvailability = { id: "availability", schoolId: "s", schoolYearId: "y", teacherId: "teacher-a", dayOfWeek: "monday", status: "unavailable", startTime: "08:00", endTime: "09:00", active: true, createdBy: "u", createdAt: "n", updatedAt: "n" };
    expect(timetableSourceFingerprint({ ...first, availabilities: [availability] })).not.toBe(timetableSourceFingerprint(first));
    expect(timetableSourceFingerprint({ ...first, availabilities: [{ ...availability, active: false }] })).toBe(timetableSourceFingerprint(first));
  });
});

describe("régénération incrémentale", () => {
  it("classe les affectations nouvelles, modifiées, supprimées et inchangées", () => {
    const previous = solve(problem([assignment("same"), assignment("modified", 2), assignment("removed")]));
    expect(classifyScheduleAssignmentChanges([assignment("same"), assignment("modified", 3), assignment("new")], previous)).toEqual({ unchangedAssignments: ["same"], newAssignments: ["new"], modifiedAssignments: ["modified"], removedAssignments: ["removed"] });
  });

  it("ajoute une nouvelle affectation sans déplacer les séances existantes", () => {
    const initialProblem = problem([assignment("a", 2)]);
    const baseline = solve(initialProblem);
    const nextProblem = problem([assignment("a", 2), assignment("b", 2)]);
    const result = solver.solve(nextProblem, { fixedEntries: prepareIncrementalFixedEntries(nextProblem, baseline), baselineEntries: baseline });
    expect(result.success).toBe(true);
    expect(positions(result.entries.filter((item) => item.assignmentId === "a"))).toEqual(positions(baseline));
    expect(result.entries.filter((item) => item.assignmentId === "b")).toHaveLength(2);
  });

  it("conserve quatre séances puis ajoute la cinquième", () => {
    const baseline = solve(problem([assignment("a", 4)]));
    const nextProblem = problem([assignment("a", 5)]);
    const result = solver.solve(nextProblem, { fixedEntries: prepareIncrementalFixedEntries(nextProblem, baseline), baselineEntries: baseline });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(5);
    expect(positions(result.entries).filter((position) => positions(baseline).includes(position))).toHaveLength(4);
  });

  it("réduit cinq séances à trois selon l’ordre canonique", () => {
    const initialProblem = problem([assignment("a", 5)]);
    const baseline = solve(initialProblem);
    const nextProblem = problem([assignment("a", 3)]);
    const fixed = prepareIncrementalFixedEntries(nextProblem, baseline);
    expect(positions(fixed)).toEqual(positions(baseline.slice(0, 3)));
    expect(solver.solve(nextProblem, { fixedEntries: fixed }).entries).toHaveLength(3);
  });

  it("retire une affectation supprimée sans déplacer l’autre", () => {
    const baseline = solve(problem([assignment("a", 2), assignment("b", 2)]));
    const keptBefore = baseline.filter((item) => item.assignmentId === "a");
    const nextProblem = problem([assignment("a", 2)]);
    const result = solver.solve(nextProblem, { fixedEntries: prepareIncrementalFixedEntries(nextProblem, baseline) });
    expect(result.success).toBe(true);
    expect(positions(result.entries)).toEqual(positions(keptBefore));
  });

  it("recalcule uniquement une séance devenue incompatible avec une disponibilité", () => {
    const initialProblem = problem([assignment("a", 2)]);
    const baseline = solve(initialProblem);
    const invalidated = baseline[0];
    const blockedPeriod = initialProblem.periods.find((item) => item.id === invalidated.periodId)!;
    const availability: TeacherAvailability = { id: "blocked", schoolId: "s", schoolYearId: "y", teacherId: "teacher-a", dayOfWeek: invalidated.dayOfWeek, status: "unavailable", startTime: blockedPeriod.startTime, endTime: blockedPeriod.endTime, active: true, createdBy: "u", createdAt: "n", updatedAt: "n" };
    const nextProblem = { ...initialProblem, availabilities: [availability] };
    const fixed = prepareIncrementalFixedEntries(nextProblem, baseline);
    const result = solver.solve(nextProblem, { fixedEntries: fixed, baselineEntries: baseline });
    expect(result.success).toBe(true);
    expect(fixed).toHaveLength(1);
    expect(positions(result.entries)).toContain(positions(fixed)[0]);
    expect(positions(result.entries)).not.toContain(`${invalidated.assignmentId}|${invalidated.dayOfWeek}|${invalidated.periodId}`);
  });

  it("refuse le mode incrémental si les séances fixes empêchent le delta, sans les déplacer", () => {
    const sharedClass = "class-shared";
    const existing = assignment("a", 1, { classId: sharedClass, teacherId: "teacher-a" });
    const added = assignment("b", 2, { classId: sharedClass, teacherId: "teacher-b", blockSize: 2 });
    const periods = [period("p1", 1), period("p2", 2), period("break", 3, "break"), period("p3", 4)];
    const initialProblem = problem([existing], { periods, classes: [schoolClass(sharedClass)], days: ["monday"] });
    const baseline = solve(initialProblem);
    const nextProblem = problem([existing, added], { periods, classes: [schoolClass(sharedClass)], days: ["monday"] });
    const incremental = solver.solve(nextProblem, { fixedEntries: prepareIncrementalFixedEntries(nextProblem, baseline) });
    expect(incremental.success).toBe(false);
    expect(incremental.entries).toEqual([]);
    const complete = solver.solve(nextProblem);
    expect(complete.success).toBe(true);
    expect(complete.entries.find((item) => item.assignmentId === "a")?.periodId).toBe("p3");
  });
});
