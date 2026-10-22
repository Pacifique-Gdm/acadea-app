import { arePeriodsPedagogicallyConsecutive, isRestDay, teacherAvailableAt, overlaps, validTimeRange, STUDY_DAYS, studyDayLabel } from "./studySchedule";
import type { PedagogicalAssignment, SchedulePeriod, ScheduleValidationIssue, ScheduleValidationReport, StudyClass, StudyDay, StudySubject, StudyTeacher, StudyRoom, TeacherAvailability, TimetableEntry } from "./studyTypes";
import { assignmentsShareStudents, normalizedAssignmentScope, classOptionId, baseStudyClassId } from "./studyCourseGroups";
import { assignmentUsesDistinctBlockDays, canonicalAssignmentBlockSizes } from "./assignmentSessionPattern";
import { periodAppliesToAssignment } from "./studyScope";

export interface ScheduleProblem { schoolId:string; schoolYearId:string; teachers?:StudyTeacher[]; subjects?:StudySubject[]; classes?:StudyClass[]; rooms?:StudyRoom[]; assignments:PedagogicalAssignment[]; availabilities:TeacherAvailability[]; periods:SchedulePeriod[]; days?:StudyDay[]; maxSameAssignmentPeriodsPerDay?:number; }

export function scheduleEntryDescription(problem: ScheduleProblem, entry: TimetableEntry) {
  const period = problem.periods.find((item) => item.id === entry.periodId);
  return [studyDayLabel(entry.dayOfWeek), period ? `${period.label} (${period.startTime}–${period.endTime})` : "Période introuvable",
    problem.classes?.find((item) => item.id === entry.classId)?.name ?? "Classe introuvable",
    problem.subjects?.find((item) => item.id === entry.subjectId)?.name ?? "Matière introuvable",
    problem.teachers?.find((item) => item.id === entry.teacherId)?.fullName ?? "Enseignant introuvable",
    entry.roomId ? problem.rooms?.find((item) => item.id === entry.roomId)?.name ?? "Salle introuvable" : ""].filter(Boolean).join(" · ");
}

export function adjacentCoursePeriods(first: SchedulePeriod | undefined, second: SchedulePeriod | undefined, allPeriods: SchedulePeriod[]) {
  return Boolean(first && second && arePeriodsPedagogicallyConsecutive([first, second], allPeriods));
}

export function validateTimetable(problem: ScheduleProblem, entries: TimetableEntry[]): ScheduleValidationReport {
  const errors: ScheduleValidationIssue[]=[];
  const assignments=new Map(problem.assignments.filter(item=>item.active).map(item=>[item.id,item]));
  const periods=new Map(problem.periods.map(item=>[item.id,item]));
  const inScope = (item: {schoolId:string;schoolYearId:string}) => item.schoolId === problem.schoolId && item.schoolYearId === problem.schoolYearId;
  const seen: TimetableEntry[] = [];
  if (!entries.length || !assignments.size) errors.push({code:"EMPTY_TIMETABLE",message:"L’horaire est vide. Générez un brouillon contenant des affectations actives."});
  for(const entry of entries){
    const assignment=assignments.get(entry.assignmentId); const period=periods.get(entry.periodId);
    const context={entityId:entry.id,day:entry.dayOfWeek,periodId:entry.periodId};
    if(!inScope(entry)||!assignment||!inScope(assignment)||assignment.teacherId!==entry.teacherId||assignment.classId!==entry.classId||assignment.subjectId!==entry.subjectId||(problem.teachers&&!problem.teachers.some(item=>item.id===entry.teacherId&&inScope(item)&&item.status==="active"))||(problem.subjects&&!problem.subjects.some(item=>item.id===entry.subjectId&&inScope(item)&&item.active))||(problem.classes&&!problem.classes.some(item=>item.id===entry.classId&&inScope(item)&&item.active!==false))){errors.push({code:"INVALID_ASSIGNMENT",message:"Affectation, enseignant, matière ou classe absent, inactif ou non autorisé. Corrigez l’affectation puis régénérez.",...context});continue;}
    const scope = normalizedAssignmentScope(assignment, problem.classes ?? []);
    if (assignment.courseScope && (!scope.optionIds?.length || assignment.courseScope === "option" && scope.optionIds.length !== 1 || assignment.courseScope === "common" && scope.optionIds.length < 2
      || problem.classes && scope.optionIds.some(id => !problem.classes!.some(item => inScope(item) && item.active !== false && baseStudyClassId(item) === scope.baseClassId && classOptionId(item) === id)))
      || entry.courseScope && (entry.courseScope !== assignment.courseScope || JSON.stringify(normalizedAssignmentScope(entry, problem.classes ?? []).optionIds) !== JSON.stringify(scope.optionIds))) {
      errors.push({code:"INVALID_ASSIGNMENT",message:"Le groupe d’options ne correspond plus à l’affectation. Vérifiez les options puis régénérez.",...context});
    }
    if (!(problem.days ?? STUDY_DAYS).includes(entry.dayOfWeek)) errors.push({code:"NON_SCHOOL_DAY",message:"Ce jour n’est pas un jour scolaire. Déplacez le cours.",...context});
    if (entry.roomId && problem.rooms && !problem.rooms.some(item => item.id === entry.roomId && inScope(item) && item.active)) errors.push({code:"INVALID_ROOM",message:"La salle est absente ou inactive. Choisissez une salle autorisée.",...context});
    for (const other of seen) {
      const otherPeriod = periods.get(other.periodId), otherAssignment = assignments.get(other.assignmentId);
      if (!period || !otherPeriod || !otherAssignment || entry.dayOfWeek !== other.dayOfWeek || !overlaps(period, otherPeriod)) continue;
      const metadata = { entries: [scheduleEntryDescription(problem, other), scheduleEntryDescription(problem, entry)], conflictingEntryId: other.id };
      if (entry.teacherId === other.teacherId) errors.push({code:"TEACHER_OVERLAP",message:"Un enseignant intervient sur deux créneaux qui se chevauchent. Déplacez une séance.",...context,metadata});
      if (assignmentsShareStudents(assignment, otherAssignment, problem.classes ?? [])) errors.push({code:"CLASS_OVERLAP",message:"Un même groupe d’élèves suit deux cours qui se chevauchent. Déplacez une séance.",...context,metadata});
      if (entry.roomId && entry.roomId === other.roomId) errors.push({code:"ROOM_OVERLAP",message:"Une salle est occupée par deux cours qui se chevauchent. Changez de salle ou de créneau.",...context,metadata});
    }
    seen.push(entry);
    if(!period||!inScope(period)||!period.active||period.type!=="course")errors.push({code:"NON_TEACHING_PERIOD",message:"Période absente, inactive, hors périmètre ou non enseignée. Corrigez le créneau.",...context});
    else if(!validTimeRange(period.startTime,period.endTime))errors.push({code:"INVALID_TIME",message:"Les heures de début et de fin de la période sont invalides.",...context});
    else if(assignment&&problem.classes&&!periodAppliesToAssignment(period,assignment,problem.classes,entry.dayOfWeek))errors.push({code:"CLASS_VACATION",message:"Le créneau ne correspond pas à la vacation de la classe opérationnelle.",...context});
    else if(isRestDay(entry.teacherId,entry.dayOfWeek,problem.availabilities))errors.push({code:"REST_DAY",message:"L’enseignant est en repos ce jour.",...context});
    else if(!teacherAvailableAt(entry.teacherId,entry.dayOfWeek,period,problem.availabilities))errors.push({code:"TEACHER_UNAVAILABLE",message:"L’enseignant est indisponible sur cette période.",...context});
  }
  for(const assignment of assignments.values()){
    const assigned=entries.filter(entry=>entry.assignmentId===assignment.id);
    if(!Number.isInteger(assignment.weeklyPeriods)||assignment.weeklyPeriods<1||assigned.length!==assignment.weeklyPeriods)errors.push({code:"WEEKLY_VOLUME_MISMATCH",message:`${problem.subjects?.find(item=>item.id===assignment.subjectId)?.name ?? "Cours"} · ${problem.classes?.find(item=>item.id===assignment.classId)?.name ?? "Classe"} : ${assignment.weeklyPeriods} périodes requises, ${assigned.length} placées. Corrigez le volume puis régénérez.`,entityId:assignment.id,metadata:{required:assignment.weeklyPeriods,actual:assigned.length}});
    const perDay=new Map<string,number>();assigned.forEach(entry=>perDay.set(entry.dayOfWeek,(perDay.get(entry.dayOfWeek)||0)+1));if(!assignmentUsesDistinctBlockDays(assignment))for(const [day,count] of perDay)if(count>(problem.maxSameAssignmentPeriodsPerDay??2))errors.push({code:"DAILY_ASSIGNMENT_LIMIT",message:"Une affectation dépasse deux périodes dans la journée.",entityId:assignment.id,day:day as TimetableEntry["dayOfWeek"],metadata:{count}});
    if(assignmentUsesDistinctBlockDays(assignment)){
      const grouped=new Map<string,TimetableEntry[]>();
      for(const entry of assigned){if(!entry.blockId)continue;grouped.set(entry.blockId,[...(grouped.get(entry.blockId)??[]),entry]);}
      const groups=[...grouped.values()].map(group=>[...group].sort((left,right)=>(periods.get(left.periodId)?.order??0)-(periods.get(right.periodId)?.order??0)));
      const expected=canonicalAssignmentBlockSizes(assignment);
      const actual=groups.map(group=>group.length).sort((left,right)=>left-right);
      const valid=groups.reduce((total,group)=>total+group.length,0)===assigned.length
        && JSON.stringify(actual)===JSON.stringify(expected)
        && new Set(groups.map(group=>group[0]?.dayOfWeek)).size===groups.length
        && groups.every(group=>group.length>0&&group.every(entry=>entry.dayOfWeek===group[0].dayOfWeek)&&arePeriodsPedagogicallyConsecutive(group.map(entry=>periods.get(entry.periodId)).filter((period):period is SchedulePeriod=>Boolean(period)),problem.periods));
      if(!valid)errors.push({code:assignment.sessionPattern?"SESSION_PATTERN_BROKEN":"DOUBLE_PERIOD_BROKEN",message:assignment.sessionPattern?"La répartition en blocs consécutifs est séparée, incomplète ou placée plusieurs fois le même jour.":"Un cours double obligatoire est séparé ou incomplet.",entityId:assignment.id});
    }
  }
  return{valid:errors.length===0,errors,warnings:[],metrics:{entries:entries.length,assignments:assignments.size,teachers:new Set(entries.map(e=>e.teacherId)).size,classes:new Set(entries.map(e=>e.classId)).size,rooms:new Set(entries.map(e=>e.roomId).filter(Boolean)).size}};
}
