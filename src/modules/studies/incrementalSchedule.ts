import { assignmentsShareStudents } from "./studyCourseScope";
import { sortTimetableEntriesForDisplay, STUDY_DAYS, teacherAvailableAt } from "./studySchedule";
import { periodAppliesToClass } from "./studyScope";
import { adjacentCoursePeriods, type ScheduleProblem } from "./scheduleValidation";
import type { PedagogicalAssignment, TimetableEntry } from "./studyTypes";

const normalizedIds = (values?: readonly string[]) => [...new Set(values ?? [])].sort();

function entryMatchesAssignment(entry: TimetableEntry, assignment: PedagogicalAssignment) {
  return entry.teacherId === assignment.teacherId
    && entry.classId === assignment.classId
    && entry.subjectId === assignment.subjectId
    && (entry.roomId ?? null) === (assignment.preferredRoomId ?? null)
    && (entry.courseScope ?? null) === (assignment.courseScope ?? null)
    && JSON.stringify(normalizedIds(entry.targetOptionIds)) === JSON.stringify(normalizedIds(assignment.targetOptionIds))
    && (entry.studentGroupKey ?? null) === (assignment.studentGroupKey ?? null);
}

export interface AssignmentDelta {
  unchangedAssignments: string[];
  newAssignments: string[];
  modifiedAssignments: string[];
  removedAssignments: string[];
}

export function classifyScheduleAssignmentChanges(assignments: PedagogicalAssignment[], baseline: TimetableEntry[]): AssignmentDelta {
  const active = new Map(assignments.filter((item) => item.active).map((item) => [item.id, item]));
  const baselineIds = [...new Set(baseline.map((item) => item.assignmentId))];
  const unchangedAssignments: string[] = [];
  const newAssignments: string[] = [];
  const modifiedAssignments: string[] = [];
  for (const assignment of active.values()) {
    const entries = baseline.filter((item) => item.assignmentId === assignment.id);
    if (!entries.length) newAssignments.push(assignment.id);
    else if (entries.length === assignment.weeklyPeriods && entries.every((entry) => entryMatchesAssignment(entry, assignment))) unchangedAssignments.push(assignment.id);
    else modifiedAssignments.push(assignment.id);
  }
  return {
    unchangedAssignments: unchangedAssignments.sort(),
    newAssignments: newAssignments.sort(),
    modifiedAssignments: modifiedAssignments.sort(),
    removedAssignments: baselineIds.filter((id) => !active.has(id)).sort(),
  };
}

function entrySlotIsCompatible(entry: TimetableEntry, assignment: PedagogicalAssignment, problem: ScheduleProblem) {
  const period = problem.periods.find((item) => item.id === entry.periodId);
  const schoolClass = problem.classes?.find((item) => item.id === assignment.classId);
  return Boolean(period
    && schoolClass
    && period.active
    && period.type === "course"
    && (problem.days ?? STUDY_DAYS).includes(entry.dayOfWeek)
    && periodAppliesToClass(period, schoolClass, entry.dayOfWeek)
    && teacherAvailableAt(assignment.teacherId, entry.dayOfWeek, period, problem.availabilities));
}

function normalizedFixedEntry(entry: TimetableEntry, assignment: PedagogicalAssignment, blockId?: string): TimetableEntry {
  return {
    id: `${assignment.id}__${entry.dayOfWeek}__${entry.periodId}`,
    scheduleId: "pending",
    schoolId: entry.schoolId,
    schoolYearId: entry.schoolYearId,
    teacherId: assignment.teacherId,
    classId: assignment.classId,
    subjectId: assignment.subjectId,
    assignmentId: assignment.id,
    roomId: assignment.preferredRoomId ?? null,
    ...(assignment.courseScope ? { courseScope: assignment.courseScope, targetOptionIds: assignment.targetOptionIds, studentGroupKey: assignment.studentGroupKey } : {}),
    dayOfWeek: entry.dayOfWeek,
    periodId: entry.periodId,
    ...(blockId ? { blockId } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function prepareIncrementalFixedEntries(problem: ScheduleProblem, baseline: TimetableEntry[]) {
  const accepted: TimetableEntry[] = [];
  const teacherBusy = new Set<string>();
  const roomBusy = new Set<string>();
  const studentBusy = new Map<string, PedagogicalAssignment[]>();
  const daily = new Map<string, number>();
  const assignments = [...problem.assignments.filter((item) => item.active)].sort((left, right) => left.id.localeCompare(right.id));
  const maxDaily = problem.maxSameAssignmentPeriodsPerDay ?? 2;

  const groupCanBeLocked = (assignment: PedagogicalAssignment, entries: TimetableEntry[]) => {
    const day = entries[0]?.dayOfWeek;
    if (!day || entries.some((entry) => entry.dayOfWeek !== day)) return false;
    if ((assignment.blockSize ?? 1) === 2 && !adjacentCoursePeriods(problem.periods.find((item) => item.id === entries[0].periodId), problem.periods.find((item) => item.id === entries[1].periodId), problem.periods)) return false;
    if ((daily.get(`${assignment.id}|${day}`) ?? 0) + entries.length > maxDaily) return false;
    return entries.every((entry) => {
      const slot = `${entry.dayOfWeek}|${entry.periodId}`;
      return !teacherBusy.has(`${assignment.teacherId}|${slot}`)
        && !(assignment.preferredRoomId && roomBusy.has(`${assignment.preferredRoomId}|${slot}`))
        && !(studentBusy.get(slot) ?? []).some((other) => assignmentsShareStudents(assignment, other, problem.classes ?? []));
    });
  };

  const lockGroup = (assignment: PedagogicalAssignment, entries: TimetableEntry[], groupIndex: number) => {
    const blockId = (assignment.blockSize ?? 1) === 2 ? `${assignment.id}__block_${groupIndex}` : undefined;
    entries.map((entry) => normalizedFixedEntry(entry, assignment, blockId)).forEach((entry) => {
      const slot = `${entry.dayOfWeek}|${entry.periodId}`;
      teacherBusy.add(`${assignment.teacherId}|${slot}`);
      if (assignment.preferredRoomId) roomBusy.add(`${assignment.preferredRoomId}|${slot}`);
      studentBusy.set(slot, [...(studentBusy.get(slot) ?? []), assignment]);
      daily.set(`${assignment.id}|${entry.dayOfWeek}`, (daily.get(`${assignment.id}|${entry.dayOfWeek}`) ?? 0) + 1);
      accepted.push(entry);
    });
  };

  for (const assignment of assignments) {
    const ordered = sortTimetableEntriesForDisplay(baseline.filter((entry) => entry.assignmentId === assignment.id && entryMatchesAssignment(entry, assignment) && entrySlotIsCompatible(entry, assignment, problem)), problem.periods);
    const blockSize = assignment.blockSize ?? 1;
    const groups = blockSize === 1
      ? ordered.map((entry) => [entry])
      : [...new Set(ordered.map((entry) => entry.blockId).filter(Boolean))].map((blockId) => ordered.filter((entry) => entry.blockId === blockId));
    const requiredGroups = Math.floor(assignment.weeklyPeriods / blockSize);
    let lockedGroups = 0;
    for (const group of groups) {
      if (lockedGroups >= requiredGroups) break;
      if (group.length !== blockSize || !groupCanBeLocked(assignment, group)) continue;
      lockGroup(assignment, group, lockedGroups);
      lockedGroups += 1;
    }
  }
  return sortTimetableEntriesForDisplay(accepted, problem.periods);
}
