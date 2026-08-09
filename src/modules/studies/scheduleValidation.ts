import { isRestDay, teacherAvailableAt } from "./studySchedule";
import type { PedagogicalAssignment, SchedulePeriod, ScheduleValidationIssue, ScheduleValidationReport, StudyClass, StudySubject, StudyTeacher, TeacherAvailability, TimetableEntry } from "./studyTypes";

export interface ScheduleProblem { schoolId:string; schoolYearId:string; teachers?:StudyTeacher[]; subjects?:StudySubject[]; classes?:StudyClass[]; assignments:PedagogicalAssignment[]; availabilities:TeacherAvailability[]; periods:SchedulePeriod[]; maxSameAssignmentPeriodsPerDay?:number; }

export function adjacentCoursePeriods(first: SchedulePeriod | undefined, second: SchedulePeriod | undefined, allPeriods: SchedulePeriod[]) {
  if (!first || !second) return false;
  const ordered = allPeriods.filter(item => item.active).sort((a,b)=>a.order-b.order || a.startTime.localeCompare(b.startTime));
  const firstIndex = ordered.findIndex(item=>item.id===first.id);
  return first.type === "course" && second.type === "course" && firstIndex >= 0 && ordered[firstIndex + 1]?.id === second.id;
}

export function validateTimetable(problem: ScheduleProblem, entries: TimetableEntry[]): ScheduleValidationReport {
  const errors: ScheduleValidationIssue[]=[];
  const assignments=new Map(problem.assignments.filter(item=>item.active).map(item=>[item.id,item]));
  const periods=new Map(problem.periods.map(item=>[item.id,item]));
  const keySeen=new Set<string>(); const classSeen=new Set<string>(); const roomSeen=new Set<string>();
  for(const entry of entries){
    const assignment=assignments.get(entry.assignmentId); const period=periods.get(entry.periodId);
    const context={entityId:entry.id,day:entry.dayOfWeek,periodId:entry.periodId};
    if(entry.schoolId!==problem.schoolId||entry.schoolYearId!==problem.schoolYearId||!assignment||assignment.teacherId!==entry.teacherId||assignment.classId!==entry.classId||assignment.subjectId!==entry.subjectId||(problem.teachers&&!problem.teachers.some(item=>item.id===entry.teacherId&&item.schoolId===problem.schoolId&&item.schoolYearId===problem.schoolYearId))||(problem.subjects&&!problem.subjects.some(item=>item.id===entry.subjectId&&item.schoolId===problem.schoolId&&item.schoolYearId===problem.schoolYearId))||(problem.classes&&!problem.classes.some(item=>item.id===entry.classId&&item.schoolId===problem.schoolId&&item.schoolYearId===problem.schoolYearId))){errors.push({code:"INVALID_ASSIGNMENT",message:"Le créneau ne correspond pas à une affectation autorisée.",...context});continue;}
    const teacherKey=`${entry.teacherId}|${entry.dayOfWeek}|${entry.periodId}`;if(keySeen.has(teacherKey))errors.push({code:"TEACHER_OVERLAP",message:"Un enseignant est affecté à deux cours simultanés.",...context});keySeen.add(teacherKey);
    const classKey=`${entry.classId}|${entry.dayOfWeek}|${entry.periodId}`;if(classSeen.has(classKey))errors.push({code:"CLASS_OVERLAP",message:"Une classe possède deux cours simultanés.",...context});classSeen.add(classKey);
    if(entry.roomId){const roomKey=`${entry.roomId}|${entry.dayOfWeek}|${entry.periodId}`;if(roomSeen.has(roomKey))errors.push({code:"ROOM_OVERLAP",message:"Une salle est utilisée deux fois simultanément.",...context});roomSeen.add(roomKey);}
    if(!period||!period.active||period.type!=="course")errors.push({code:"NON_TEACHING_PERIOD",message:"Un cours ne peut pas être placé pendant une pause ou une récréation.",...context});
    else if(isRestDay(entry.teacherId,entry.dayOfWeek,problem.availabilities))errors.push({code:"REST_DAY",message:"L’enseignant est en repos ce jour.",...context});
    else if(!teacherAvailableAt(entry.teacherId,entry.dayOfWeek,period,problem.availabilities))errors.push({code:"TEACHER_UNAVAILABLE",message:"L’enseignant est indisponible sur cette période.",...context});
  }
  for(const assignment of assignments.values()){
    const assigned=entries.filter(entry=>entry.assignmentId===assignment.id);
    if(assigned.length!==assignment.weeklyPeriods)errors.push({code:"WEEKLY_VOLUME_MISMATCH",message:`${assignment.id} requiert ${assignment.weeklyPeriods} périodes, ${assigned.length} placées.`,entityId:assignment.id,metadata:{required:assignment.weeklyPeriods,actual:assigned.length}});
    const perDay=new Map<string,number>();assigned.forEach(entry=>perDay.set(entry.dayOfWeek,(perDay.get(entry.dayOfWeek)||0)+1));for(const [day,count] of perDay)if(count>(problem.maxSameAssignmentPeriodsPerDay??2))errors.push({code:"DAILY_ASSIGNMENT_LIMIT",message:"Une affectation dépasse deux périodes dans la journée.",entityId:assignment.id,day:day as TimetableEntry["dayOfWeek"],metadata:{count}});
    if((assignment.blockSize??1)===2){const groups=new Map(assigned.filter(e=>e.blockId).map(e=>[e.blockId!,assigned.filter(x=>x.blockId===e.blockId)]));if(assigned.length%2!==0||[...groups.values()].some(group=>group.length!==2||group[0].dayOfWeek!==group[1].dayOfWeek||!adjacentCoursePeriods(periods.get(group[0].periodId)!,periods.get(group[1].periodId)!,problem.periods)))errors.push({code:"DOUBLE_PERIOD_BROKEN",message:"Un cours double obligatoire est séparé ou incomplet.",entityId:assignment.id});}
  }
  return{valid:errors.length===0,errors,warnings:[],metrics:{entries:entries.length,assignments:assignments.size,teachers:new Set(entries.map(e=>e.teacherId)).size,classes:new Set(entries.map(e=>e.classId)).size,rooms:new Set(entries.map(e=>e.roomId).filter(Boolean)).size}};
}
