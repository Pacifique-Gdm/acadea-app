import type { ScheduleProblem } from "./scheduleValidation";
import { STUDY_DAYS } from "./studySchedule";
import type { Timetable } from "./studyTypes";
import { canonicalSessionPattern } from "./assignmentSessionPattern";

const normalizedIds = (values?: readonly string[]) => [...new Set(values ?? [])].sort();

export function canonicalScheduleSource(problem: ScheduleProblem) {
  const assignmentIds = new Set(problem.assignments.filter((item) => item.active).map((item) => item.id));
  const teacherIds = new Set(problem.assignments.filter((item) => item.active).map((item) => item.teacherId));
  const classIds = new Set(problem.assignments.filter((item) => item.active).map((item) => item.classId));
  return {
    schoolId: problem.schoolId,
    schoolYearId: problem.schoolYearId,
    maxSameAssignmentPeriodsPerDay: problem.maxSameAssignmentPeriodsPerDay ?? 2,
    days: normalizedIds(problem.days ?? STUDY_DAYS),
    assignments: problem.assignments.filter((item) => item.active).map((item) => ({
      id: item.id,
      teacherId: item.teacherId,
      subjectId: item.subjectId,
      classId: item.classId,
      weeklyPeriods: item.weeklyPeriods,
      blockSize: item.blockSize ?? 1,
      ...(item.sessionPattern ? { sessionPattern: canonicalSessionPattern(item) } : {}),
      preferredRoomId: item.preferredRoomId ?? null,
      courseScope: item.courseScope ?? null,
      targetOptionIds: normalizedIds(item.targetOptionIds),
      studentGroupKey: item.studentGroupKey ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    availabilities: problem.availabilities.filter((item) => item.active && teacherIds.has(item.teacherId)).map((item) => ({
      id: item.id,
      teacherId: item.teacherId,
      dayOfWeek: item.dayOfWeek,
      status: item.status,
      startTime: item.startTime ?? null,
      endTime: item.endTime ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    classes: (problem.classes ?? []).filter((item) => classIds.has(item.id)).map((item) => ({
      id: item.id,
      parentClassId: item.parentClassId ?? null,
      classOptionKey: item.classOptionKey ?? null,
      vacation: item.vacation ?? null,
      saturdayVacation: item.saturdayVacation ?? null,
      saturdayEnabled: item.saturdayEnabled ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    periods: problem.periods.filter((item) => item.active).map((item) => ({
      id: item.id,
      startTime: item.startTime,
      endTime: item.endTime,
      order: item.order,
      type: item.type,
      vacation: item.vacation ?? null,
      dayScope: item.dayScope ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    assignmentCount: assignmentIds.size,
  };
}

function fnv1a(value: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function timetableSourceFingerprint(problem: ScheduleProblem) {
  const source = JSON.stringify(canonicalScheduleSource(problem));
  return `v1-${fnv1a(source, 0x811c9dc5)}${fnv1a(source, 0x9e3779b9)}`;
}

export function scheduleIsStale(schedule: Pick<Timetable, "generationMetadata"> | undefined, problem: ScheduleProblem) {
  return !schedule?.generationMetadata.sourceFingerprint || schedule.generationMetadata.sourceFingerprint !== timetableSourceFingerprint(problem);
}
