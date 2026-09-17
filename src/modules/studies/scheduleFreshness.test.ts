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

  it("inclut le pattern canonique sans invalider sur un simple réordonnancement", () => {
    const normal = problem([assignment("a", 9)]);
    const blocks = problem([assignment("a", 9, { sessionPattern: { mode: "blocks", blocks: [2, 3, 4] } })]);
    const reordered = problem([assignment("a", 9, { sessionPattern: { mode: "blocks", blocks: [4, 2, 3] } })]);
    expect(timetableSourceFingerprint(blocks)).not.toBe(timetableSourceFingerprint(normal));
    expect(timetableSourceFingerprint(reordered)).toBe(timetableSourceFingerprint(blocks));
  });

  it("devient obsolète lorsque la vacation d'une option ciblée change", () => {
    const scoped = assignment("a", 1, { classId: "3h", courseScope: "option", targetOptionIds: ["3h::science"] });
    const parent = schoolClass("3h");
    const science = { ...schoolClass("3h::science"), parentClassId: "3h", classOptionKey: "3h::science", option: "Sciences", vacation: "morning" as const };
    const first = problem([scoped], { classes: [parent, science] });
    const second = { ...first, classes: [parent, { ...science, vacation: "afternoon" as const }] };
    expect(timetableSourceFingerprint(second)).not.toBe(timetableSourceFingerprint(first));
  });
});

describe("régénération incrémentale", () => {
  it.each([
    { before: [3], after: [5] },
    { before: [4], after: [6] },
    { before: [4, 4], after: [5, 5] },
  ])("recalcule le changement de blocs $before vers $after sans verrouiller l’ancien pattern", ({ before, after }) => {
    const periods = [period("p1", 1), period("p2", 2), period("p3", 3), period("break", 4, "break"), period("p4", 5), period("p5", 6), period("p6", 7)];
    const previous = assignment("a", before.reduce((total, size) => total + size, 0), { sessionPattern: { mode: "blocks", blocks: before } });
    const initialProblem = problem([previous], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    const baseline = solve(initialProblem);
    const next = assignment("a", after.reduce((total, size) => total + size, 0), { sessionPattern: { mode: "blocks", blocks: after } });
    const nextProblem = problem([next], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    expect(timetableSourceFingerprint(nextProblem)).not.toBe(timetableSourceFingerprint(initialProblem));
    const fixed = prepareIncrementalFixedEntries(nextProblem, baseline);
    expect(fixed).toHaveLength(0);
    const result = solver.solve(nextProblem, { fixedEntries: fixed, baselineEntries: baseline });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(after.reduce((total, size) => total + size, 0));
    expect(result.entries.some((entry) => entry.periodId === "break")).toBe(false);
  });

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
    const periods = [period("p1", 1), period("p2", 2), { ...period("p3", 4), startTime: "12:00", endTime: "13:00" }];
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

  it("conserve les blocs inchangés et ajoute un nouveau bloc de même taille sur un autre jour", () => {
    const base = assignment("a", 6, { sessionPattern: { mode: "blocks", blocks: [3, 3] } });
    const periods = [period("p1", 1), period("p2", 2), period("p3", 3)];
    const baselineProblem = problem([base], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    const baseline = solve(baselineProblem);
    const expanded = assignment("a", 9, { sessionPattern: { mode: "blocks", blocks: [3, 3, 3] } });
    const nextProblem = problem([expanded], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    const fixed = prepareIncrementalFixedEntries(nextProblem, baseline);
    const result = solver.solve(nextProblem, { fixedEntries: fixed, baselineEntries: baseline });
    expect(fixed).toHaveLength(6);
    expect(positions(result.entries).filter((position) => positions(baseline).includes(position))).toHaveLength(6);
    expect(new Set(result.entries.map((entry) => entry.dayOfWeek)).size).toBe(3);
  });

  it("réduit des blocs dupliqués de façon déterministe et recalcule seulement la taille modifiée", () => {
    const periods = [period("p1", 1), period("p2", 2), period("p3", 3), period("p4", 4)];
    const initial = assignment("a", 10, { sessionPattern: { mode: "blocks", blocks: [3, 3, 4] } });
    const initialProblem = problem([initial], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    const baseline = solve(initialProblem);
    const reduced = assignment("a", 6, { sessionPattern: { mode: "blocks", blocks: [3, 3] } });
    const reducedProblem = problem([reduced], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    expect(prepareIncrementalFixedEntries(reducedProblem, baseline)).toHaveLength(6);
    const modified = assignment("a", 8, { sessionPattern: { mode: "blocks", blocks: [2, 3, 3] } });
    const modifiedProblem = problem([modified], { periods, maxSameAssignmentPeriodsPerDay: 2 });
    const fixed = prepareIncrementalFixedEntries(modifiedProblem, baseline);
    expect(fixed).toHaveLength(6);
    expect(new Set(fixed.map((entry) => entry.blockId)).size).toBe(2);
    expect(solver.solve(modifiedProblem, { fixedEntries: fixed, baselineEntries: baseline }).success).toBe(true);
  });
});
