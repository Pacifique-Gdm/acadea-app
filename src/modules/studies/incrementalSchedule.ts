import { assignmentsShareStudents } from "./studyCourseScope";
import { arePeriodsPedagogicallyConsecutive, sortTimetableEntriesForDisplay, STUDY_DAYS, teacherAvailableAt } from "./studySchedule";
import { periodAppliesToClass } from "./studyScope";
import type { ScheduleProblem } from "./scheduleValidation";
import type { PedagogicalAssignment, SchedulePeriod, TimetableEntry } from "./studyTypes";
import { assignmentUsesDistinctBlockDays, canonicalAssignmentBlockSizes } from "./assignmentSessionPattern";

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

function entryGroups(assignment: PedagogicalAssignment, entries: TimetableEntry[], periods?: SchedulePeriod[]) {
  const ordered = periods ? sortTimetableEntriesForDisplay(entries, periods) : [...entries].sort((left, right) => `${left.dayOfWeek}|${left.periodId}|${left.id}`.localeCompare(`${right.dayOfWeek}|${right.periodId}|${right.id}`));
  if (!assignmentUsesDistinctBlockDays(assignment)) return ordered.map((entry) => [entry]);
  const grouped = new Map<string, TimetableEntry[]>();
  ordered.forEach((entry) => { const key = entry.blockId ?? `missing:${entry.id}`; grouped.set(key, [...(grouped.get(key) ?? []), entry]); });
  return [...grouped.values()].map((group) => periods ? sortTimetableEntriesForDisplay(group, periods) : group);
}

function entryStructureMatches(assignment: PedagogicalAssignment, entries: TimetableEntry[]) {
  if (entries.length !== assignment.weeklyPeriods || entries.some((entry) => !entryMatchesAssignment(entry, assignment))) return false;
  if (!assignmentUsesDistinctBlockDays(assignment)) return true;
  const groups = entryGroups(assignment, entries);
  return groups.every((group) => group.every((entry) => Boolean(entry.blockId) && entry.dayOfWeek === group[0].dayOfWeek))
    && new Set(groups.map((group) => group[0].dayOfWeek)).size === groups.length
    && JSON.stringify(groups.map((group) => group.length).sort((left, right) => left - right)) === JSON.stringify(canonicalAssignmentBlockSizes(assignment));
}

export interface AssignmentDelta { unchangedAssignments:string[]; newAssignments:string[]; modifiedAssignments:string[]; removedAssignments:string[]; }

export function classifyScheduleAssignmentChanges(assignments: PedagogicalAssignment[], baseline: TimetableEntry[]): AssignmentDelta {
  const active = new Map(assignments.filter((item) => item.active).map((item) => [item.id, item]));
  const baselineIds = [...new Set(baseline.map((item) => item.assignmentId))];
  const unchangedAssignments:string[]=[],newAssignments:string[]=[],modifiedAssignments:string[]=[];
  for (const assignment of active.values()) { const entries = baseline.filter((item) => item.assignmentId === assignment.id); if (!entries.length) newAssignments.push(assignment.id); else if (entryStructureMatches(assignment, entries)) unchangedAssignments.push(assignment.id); else modifiedAssignments.push(assignment.id); }
  return { unchangedAssignments:unchangedAssignments.sort(), newAssignments:newAssignments.sort(), modifiedAssignments:modifiedAssignments.sort(), removedAssignments:baselineIds.filter((id)=>!active.has(id)).sort() };
}

function entrySlotIsCompatible(entry: TimetableEntry, assignment: PedagogicalAssignment, problem: ScheduleProblem) {
  const period=problem.periods.find((item)=>item.id===entry.periodId),schoolClass=problem.classes?.find((item)=>item.id===assignment.classId);
  return Boolean(period&&schoolClass&&period.active&&period.type==="course"&&(problem.days??STUDY_DAYS).includes(entry.dayOfWeek)&&periodAppliesToClass(period,schoolClass,entry.dayOfWeek)&&teacherAvailableAt(assignment.teacherId,entry.dayOfWeek,period,problem.availabilities));
}

function normalizedFixedEntry(entry: TimetableEntry, assignment: PedagogicalAssignment, blockId?: string): TimetableEntry {
  return { id:`${assignment.id}__${entry.dayOfWeek}__${entry.periodId}`, scheduleId:"pending", schoolId:entry.schoolId, schoolYearId:entry.schoolYearId, teacherId:assignment.teacherId, classId:assignment.classId, subjectId:assignment.subjectId, assignmentId:assignment.id, roomId:assignment.preferredRoomId??null, ...(assignment.courseScope?{courseScope:assignment.courseScope,targetOptionIds:assignment.targetOptionIds,studentGroupKey:assignment.studentGroupKey}:{}), dayOfWeek:entry.dayOfWeek, periodId:entry.periodId, ...(blockId?{blockId}:{}), createdAt:entry.createdAt, updatedAt:entry.updatedAt };
}

export function prepareIncrementalFixedEntries(problem: ScheduleProblem, baseline: TimetableEntry[]) {
  const accepted:TimetableEntry[]=[],teacherBusy=new Set<string>(),roomBusy=new Set<string>(),studentBusy=new Map<string,PedagogicalAssignment[]>(),daily=new Map<string,number>(),usedDays=new Map<string,Set<string>>();
  const assignments=[...problem.assignments.filter((item)=>item.active)].sort((left,right)=>left.id.localeCompare(right.id)),maxDaily=problem.maxSameAssignmentPeriodsPerDay??2;
  const groupCanBeLocked=(assignment:PedagogicalAssignment,entries:TimetableEntry[])=>{
    const day=entries[0]?.dayOfWeek;if(!day||entries.some((entry)=>entry.dayOfWeek!==day))return false;
    if(entries.length>1&&!arePeriodsPedagogicallyConsecutive(entries.map((entry)=>problem.periods.find((item)=>item.id===entry.periodId)).filter((period):period is SchedulePeriod=>Boolean(period)),problem.periods))return false;
    if(assignmentUsesDistinctBlockDays(assignment)){if(usedDays.get(assignment.id)?.has(day))return false;}else if((daily.get(`${assignment.id}|${day}`)??0)+entries.length>maxDaily)return false;
    return entries.every((entry)=>{const slot=`${entry.dayOfWeek}|${entry.periodId}`;return!teacherBusy.has(`${assignment.teacherId}|${slot}`)&&!(assignment.preferredRoomId&&roomBusy.has(`${assignment.preferredRoomId}|${slot}`))&&!(studentBusy.get(slot)??[]).some((other)=>assignmentsShareStudents(assignment,other,problem.classes??[]));});
  };
  const lockGroup=(assignment:PedagogicalAssignment,entries:TimetableEntry[],blockIndex:number)=>{const blockId=assignmentUsesDistinctBlockDays(assignment)?`${assignment.id}__block_${blockIndex}`:undefined;entries.map((entry)=>normalizedFixedEntry(entry,assignment,blockId)).forEach((entry)=>{const slot=`${entry.dayOfWeek}|${entry.periodId}`;teacherBusy.add(`${assignment.teacherId}|${slot}`);if(assignment.preferredRoomId)roomBusy.add(`${assignment.preferredRoomId}|${slot}`);studentBusy.set(slot,[...(studentBusy.get(slot)??[]),assignment]);daily.set(`${assignment.id}|${entry.dayOfWeek}`,(daily.get(`${assignment.id}|${entry.dayOfWeek}`)??0)+1);accepted.push(entry);});if(assignmentUsesDistinctBlockDays(assignment))usedDays.set(assignment.id,new Set([...(usedDays.get(assignment.id)??[]),entries[0].dayOfWeek]));};
  for(const assignment of assignments){
    const compatible=baseline.filter((entry)=>entry.assignmentId===assignment.id&&entryMatchesAssignment(entry,assignment)&&entrySlotIsCompatible(entry,assignment,problem)),groups=entryGroups(assignment,compatible,problem.periods),used=new Set<number>();
    canonicalAssignmentBlockSizes(assignment).forEach((size,blockIndex)=>{const groupIndex=groups.findIndex((group,index)=>!used.has(index)&&group.length===size&&groupCanBeLocked(assignment,group));if(groupIndex<0)return;used.add(groupIndex);lockGroup(assignment,groups[groupIndex],blockIndex);});
  }
  return sortTimetableEntriesForDisplay(accepted,problem.periods);
}
