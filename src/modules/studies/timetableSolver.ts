import { arePeriodsPedagogicallyConsecutive, getActiveCoursePeriods, isRestDay, sortTimetableEntriesForDisplay, STUDY_DAYS, teacherAvailableAt } from "./studySchedule";
import { validateTimetable, type ScheduleProblem } from "./scheduleValidation";
import type { PedagogicalAssignment, SchedulePeriod, StudyDay, TimetableEntry } from "./studyTypes";
import { periodAppliesToClass } from "./studyScope";
import { assignmentsShareStudents, normalizedAssignmentScope } from "./studyCourseScope";
import { assignmentUsesDistinctBlockDays, canonicalAssignmentBlockSizes, validateAssignmentSessionPattern } from "./assignmentSessionPattern";

export const DEFAULT_MAX_SAME_ASSIGNMENT_PERIODS_PER_DAY = 2;
export interface SolverFailure { assignmentId:string; teacherId:string; classId:string; subjectId:string; required:number; availableCapacity:number; reason:string; }
export interface SolverResult { success:boolean; entries:TimetableEntry[]; failures:SolverFailure[]; statistics:{exploredBranches:number;backtracks:number;maxDepth:number;durationMs:number;timedOut:boolean}; }
export interface TimetableSolverOptions { maxBranches?:number; timeoutMs?:number; baselineEntries?:TimetableEntry[]; fixedEntries?:TimetableEntry[]; preferredMorningAssignmentIds?:string[]; }
export interface TimetableSolver { solve(problem:ScheduleProblem,options?:TimetableSolverOptions):SolverResult; }

type Candidate = { day:StudyDay; periodIds:string[] };
type BlockJob = { key:string; assignment:PedagogicalAssignment; size:number; indexes:number[]; candidates:Candidate[]; diagnostics:AssignmentSlotDiagnostics };
export interface AssignmentSlotDiagnostics {
  rawSlots:number; afterConfiguredDays:number; afterPeriods:number; afterClassVacation:number; afterTeacherRest:number; afterTeacherAvailability:number;
  afterTeacherConflicts:number; afterStudentGroupConflicts:number; afterExistingEntries:number; afterBlockRules:number; finalCandidates:number;
  activePeriodSlots:number; classCompatibleSlots:number; teacherCompatibleSlots:number; candidateBlocks:number;
}

function candidateAnalysis(assignment:PedagogicalAssignment,problem:ScheduleProblem,size:number):{candidates:Candidate[];diagnostics:AssignmentSlotDiagnostics}{
  const periods=getActiveCoursePeriods(problem.periods),schoolClass=problem.classes?.find(item=>item.id===assignment.classId),result:Candidate[]=[];
  let activePeriodSlots=0,classCompatibleSlots=0,afterTeacherRest=0,teacherCompatibleSlots=0;
  for(const day of problem.days??STUDY_DAYS){
    activePeriodSlots+=periods.length;
    const compatible=schoolClass?periods.filter(period=>periodAppliesToClass(period,schoolClass,day)):[];
    classCompatibleSlots+=compatible.length;
    afterTeacherRest+=isRestDay(assignment.teacherId,day,problem.availabilities)?0:compatible.length;
    teacherCompatibleSlots+=compatible.filter(period=>teacherAvailableAt(assignment.teacherId,day,period,problem.availabilities)).length;
    for(let index=0;index<compatible.length;index+=1){
      const block=compatible.slice(index,index+size);
      if(block.length!==size||!arePeriodsPedagogicallyConsecutive(block,problem.periods))continue;
      if(block.every(period=>teacherAvailableAt(assignment.teacherId,day,period,problem.availabilities)))result.push({day,periodIds:block.map(period=>period.id)});
    }
  }
  const rawSlots=STUDY_DAYS.length*periods.length;
  return{candidates:result,diagnostics:{rawSlots,afterConfiguredDays:activePeriodSlots,afterPeriods:activePeriodSlots,afterClassVacation:classCompatibleSlots,afterTeacherRest,afterTeacherAvailability:teacherCompatibleSlots,afterTeacherConflicts:teacherCompatibleSlots,afterStudentGroupConflicts:teacherCompatibleSlots,afterExistingEntries:teacherCompatibleSlots,afterBlockRules:result.length,finalCandidates:result.length,activePeriodSlots,classCompatibleSlots,teacherCompatibleSlots,candidateBlocks:result.length}};
}

export function diagnoseAssignmentSlots(assignment:PedagogicalAssignment,problem:ScheduleProblem){return candidateAnalysis(assignment,problem,Math.max(...canonicalAssignmentBlockSizes(assignment),1)).diagnostics;}

function zeroCandidateReason(assignment:PedagogicalAssignment,problem:ScheduleProblem,diagnostics:AssignmentSlotDiagnostics){
  if(!problem.classes?.some(item=>item.id===assignment.classId))return"La classe de l’affectation est introuvable dans l’école et l’année actives.";
  if(diagnostics.activePeriodSlots===0)return"Aucun créneau horaire actif n’est configuré.";
  if(diagnostics.classCompatibleSlots===0)return"Aucun créneau horaire ne correspond aux jours et à la vacation de cette classe.";
  if(diagnostics.teacherCompatibleSlots===0)return"Les disponibilités de l’enseignant excluent tous les créneaux compatibles avec cette classe.";
  return"Aucun bloc de périodes consécutives ne satisfait la configuration de cette affectation.";
}

function capacityFailure(jobs:Array<{assignment:PedagogicalAssignment;candidates:Candidate[]}>,classes:readonly import("./studyTypes").StudyClass[]){
  const legacyClassIds=[...new Set(jobs.filter(job=>!normalizedAssignmentScope(job.assignment,classes).optionIds).map(job=>normalizedAssignmentScope(job.assignment,classes).baseClassId))];
  for(const classId of legacyClassIds){const scoped=jobs.filter(job=>{const group=normalizedAssignmentScope(job.assignment,classes);return group.baseClassId===classId&&!group.optionIds;});const required=scoped.reduce((total,job)=>total+job.assignment.weeklyPeriods,0);const capacity=new Set(scoped.flatMap(job=>job.candidates.flatMap(candidate=>candidate.periodIds.map(periodId=>`${candidate.day}|${periodId}`)))).size;if(required>capacity)return{job:scoped[0],capacity,reason:`La capacité de la classe est insuffisante : ${required} périodes demandées pour ${capacity} créneaux compatibles.`};}
  for(const teacherId of [...new Set(jobs.map(job=>job.assignment.teacherId))]){const scoped=jobs.filter(job=>job.assignment.teacherId===teacherId);const required=scoped.reduce((total,job)=>total+job.assignment.weeklyPeriods,0);const capacity=new Set(scoped.flatMap(job=>job.candidates.flatMap(candidate=>candidate.periodIds.map(periodId=>`${candidate.day}|${periodId}`)))).size;if(required>capacity)return{job:scoped[0],capacity,reason:`La capacité de l’enseignant est insuffisante : ${required} périodes demandées pour ${capacity} créneaux compatibles.`};}
  return undefined;
}

function groupedEntries(assignment:PedagogicalAssignment,entries:TimetableEntry[],periods:SchedulePeriod[]){
  const ordered=sortTimetableEntriesForDisplay(entries,periods);
  if(!assignmentUsesDistinctBlockDays(assignment))return ordered.map(entry=>[entry]);
  const byBlock=new Map<string,TimetableEntry[]>();for(const entry of ordered){const key=entry.blockId??`missing:${entry.id}`;byBlock.set(key,[...(byBlock.get(key)??[]),entry]);}
  return [...byBlock.values()].map(group=>sortTimetableEntriesForDisplay(group,periods)).sort((left,right)=>`${left[0]?.dayOfWeek}|${left[0]?.periodId}`.localeCompare(`${right[0]?.dayOfWeek}|${right[0]?.periodId}`));
}

export class DeterministicTimetableSolver implements TimetableSolver{
  solve(problem:ScheduleProblem,options:TimetableSolverOptions={}):SolverResult{
    const started=Date.now(),deadline=started+(options.timeoutMs??2000),maxBranches=options.maxBranches??100000;let exploredBranches=0,backtracks=0,maxDepth=0,timedOut=false;
    const statistics=()=>({exploredBranches,backtracks,maxDepth,durationMs:Date.now()-started,timedOut});
    const failure=(assignment:PedagogicalAssignment|undefined,reason:string,availableCapacity=0):SolverResult=>({success:false,entries:[],failures:[{assignmentId:assignment?.id??"unknown",teacherId:assignment?.teacherId??"",classId:assignment?.classId??"",subjectId:assignment?.subjectId??"",required:assignment?.weeklyPeriods??0,availableCapacity,reason}],statistics:statistics()});
    const active=problem.assignments.filter(item=>item.active),invalidScope=active.find(item=>item.schoolId!==problem.schoolId||item.schoolYearId!==problem.schoolYearId);
    if(!active.length)return failure(undefined,"Aucune affectation active.");
    if(!getActiveCoursePeriods(problem.periods).length)return failure(active[0],"Aucun créneau horaire configuré.");
    if(invalidScope)return failure(invalidScope,"Affectation hors école ou année scolaire.");
    const configuredDays=problem.days??STUDY_DAYS,invalidPattern=active.find(assignment=>assignment.sessionPattern&&validateAssignmentSessionPattern(assignment.weeklyPeriods,assignment.sessionPattern,Number.POSITIVE_INFINITY,configuredDays.length));
    if(invalidPattern)return failure(invalidPattern,validateAssignmentSessionPattern(invalidPattern.weeklyPeriods,invalidPattern.sessionPattern,Number.POSITIVE_INFINITY,configuredDays.length));

    const jobs:BlockJob[]=active.flatMap(assignment=>{const grouped=new Map<number,number[]>();canonicalAssignmentBlockSizes(assignment).forEach((size,index)=>grouped.set(size,[...(grouped.get(size)??[]),index]));return[...grouped].map(([size,indexes])=>{const analysis=candidateAnalysis(assignment,problem,size);return{key:`${assignment.id}|${size}`,assignment,size,indexes,...analysis};});}).sort((left,right)=>left.candidates.length-right.candidates.length||right.size-left.size||right.assignment.weeklyPeriods-left.assignment.weeklyPeriods||left.assignment.id.localeCompare(right.assignment.id));
    const impossible=jobs.find(job=>job.candidates.length<job.indexes.length);if(impossible)return failure(impossible.assignment,impossible.candidates.length===0?zeroCandidateReason(impossible.assignment,problem,impossible.diagnostics):`Le volume demandé (${impossible.assignment.weeklyPeriods}) dépasse la capacité compatible pour ses blocs.`,impossible.candidates.length*impossible.size);
    const insufficientDays=active.find(assignment=>assignmentUsesDistinctBlockDays(assignment)&&new Set(jobs.filter(job=>job.assignment.id===assignment.id).flatMap(job=>job.candidates.map(candidate=>candidate.day))).size<canonicalAssignmentBlockSizes(assignment).length);if(insufficientDays)return failure(insufficientDays,"Les blocs consécutifs exigent davantage de jours distincts compatibles.");
    const bottleneck=capacityFailure(active.map(assignment=>({assignment,candidates:jobs.filter(job=>job.assignment.id===assignment.id).flatMap(job=>job.candidates)})),problem.classes??[]);if(bottleneck)return failure(bottleneck.job.assignment,bottleneck.reason,bottleneck.capacity);

    const activeById=new Map(active.map(assignment=>[assignment.id,assignment])),fixedEntries=options.fixedEntries??[];
    for(const entry of fixedEntries){const assignment=activeById.get(entry.assignmentId);if(!assignment||entry.schoolId!==problem.schoolId||entry.schoolYearId!==problem.schoolYearId||entry.teacherId!==assignment.teacherId||entry.classId!==assignment.classId||entry.subjectId!==assignment.subjectId)return failure(assignment,"Une séance verrouillée ne correspond plus à une affectation active.");}
    const remainingIndexes=new Map(jobs.map(job=>[job.key,[...job.indexes]])),fixedGroupsByAssignment=new Map<string,TimetableEntry[][]>();
    for(const assignment of active){const groups=groupedEntries(assignment,fixedEntries.filter(entry=>entry.assignmentId===assignment.id),problem.periods),days=new Set<string>();for(const group of groups){const size=group.length,job=jobs.find(candidate=>candidate.assignment.id===assignment.id&&candidate.size===size),indexes=job?remainingIndexes.get(job.key):undefined;const validBlock=!assignmentUsesDistinctBlockDays(assignment)||(group.every(entry=>Boolean(entry.blockId)&&entry.dayOfWeek===group[0].dayOfWeek)&&!days.has(group[0].dayOfWeek)&&arePeriodsPedagogicallyConsecutive(group.map(entry=>problem.periods.find(period=>period.id===entry.periodId)).filter((period):period is SchedulePeriod=>Boolean(period)),problem.periods));if(!job||!indexes?.length||!validBlock)return failure(assignment,"Le nombre ou la structure des séances verrouillées est incompatible avec l’organisation actuelle.",fixedEntries.filter(entry=>entry.assignmentId===assignment.id).length);indexes.shift();if(assignmentUsesDistinctBlockDays(assignment))days.add(group[0].dayOfWeek);}fixedGroupsByAssignment.set(assignment.id,groups);}

    const baselineByAssignment=new Map<string,TimetableEntry[]>();for(const entry of options.baselineEntries??[]){const list=baselineByAssignment.get(entry.assignmentId)??[];list.push(entry);baselineByAssignment.set(entry.assignmentId,list)}for(const entries of baselineByAssignment.values())entries.splice(0,entries.length,...sortTimetableEntriesForDisplay(entries,problem.periods));
    const morning=new Set(options.preferredMorningAssignmentIds??[]),activePeriods=getActiveCoursePeriods(problem.periods),morningLimit=Math.ceil(activePeriods.length/2),periodOrder=new Map(activePeriods.map(period=>[period.id,Number(period.order)]));
    const candidateCost=(assignment:PedagogicalAssignment,index:number,candidate:Candidate)=>{const baseline=baselineByAssignment.get(assignment.id)??[],prior=baseline.find(entry=>entry.blockId===`${assignment.id}__block_${index}`)??baseline[index];let cost=prior?(prior.dayOfWeek===candidate.day?(prior.periodId===candidate.periodIds[0]?0:1):4):2;if(morning.has(assignment.id)&&candidate.periodIds.some(id=>(periodOrder.get(id)??0)>morningLimit))cost+=3;return cost};
    const teacherBusy=new Set<string>(),roomBusy=new Set<string>(),studentBusy=new Map<string,PedagogicalAssignment[]>(),daily=new Map<string,number>(),usedDays=new Map<string,Set<StudyDay>>();
    const studentConflict=(assignment:PedagogicalAssignment,day:StudyDay,periodId:string)=>(studentBusy.get(`${day}|${periodId}`)??[]).some(other=>assignmentsShareStudents(assignment,other,problem.classes??[]));
    const addCandidate=(assignment:PedagogicalAssignment,candidate:Candidate)=>{candidate.periodIds.forEach(periodId=>{teacherBusy.add(`${assignment.teacherId}|${candidate.day}|${periodId}`);const slot=`${candidate.day}|${periodId}`;studentBusy.set(slot,[...(studentBusy.get(slot)??[]),assignment]);if(assignment.preferredRoomId)roomBusy.add(`${assignment.preferredRoomId}|${candidate.day}|${periodId}`)});daily.set(`${assignment.id}|${candidate.day}`,(daily.get(`${assignment.id}|${candidate.day}`)??0)+candidate.periodIds.length);if(assignmentUsesDistinctBlockDays(assignment))usedDays.set(assignment.id,new Set([...(usedDays.get(assignment.id)??[]),candidate.day]));};
    const removeCandidate=(assignment:PedagogicalAssignment,candidate:Candidate)=>{candidate.periodIds.forEach(periodId=>{teacherBusy.delete(`${assignment.teacherId}|${candidate.day}|${periodId}`);const slot=`${candidate.day}|${periodId}`,occupied=studentBusy.get(slot)??[],removal=occupied.lastIndexOf(assignment);if(removal>=0)occupied.splice(removal,1);if(occupied.length)studentBusy.set(slot,occupied);else studentBusy.delete(slot);if(assignment.preferredRoomId)roomBusy.delete(`${assignment.preferredRoomId}|${candidate.day}|${periodId}`)});daily.set(`${assignment.id}|${candidate.day}`,(daily.get(`${assignment.id}|${candidate.day}`)??0)-candidate.periodIds.length);if(assignmentUsesDistinctBlockDays(assignment))usedDays.get(assignment.id)?.delete(candidate.day);};
    const canPlace=(assignment:PedagogicalAssignment,candidate:Candidate)=>{if(assignmentUsesDistinctBlockDays(assignment)&&(usedDays.get(assignment.id)?.has(candidate.day)??false))return false;if(!assignmentUsesDistinctBlockDays(assignment)&&(daily.get(`${assignment.id}|${candidate.day}`)??0)+candidate.periodIds.length>(problem.maxSameAssignmentPeriodsPerDay??DEFAULT_MAX_SAME_ASSIGNMENT_PERIODS_PER_DAY))return false;return!candidate.periodIds.some(periodId=>teacherBusy.has(`${assignment.teacherId}|${candidate.day}|${periodId}`)||studentConflict(assignment,candidate.day,periodId)||(assignment.preferredRoomId&&roomBusy.has(`${assignment.preferredRoomId}|${candidate.day}|${periodId}`)))};
    for(const assignment of active)for(const group of fixedGroupsByAssignment.get(assignment.id)??[]){const candidate={day:group[0].dayOfWeek,periodIds:group.map(entry=>entry.periodId)};if(!canPlace(assignment,candidate))return failure(assignment,"Deux séances verrouillées utilisent le même créneau ou le même jour de bloc.");addCandidate(assignment,candidate);}

    const totalBlocks=[...remainingIndexes.values()].reduce((total,indexes)=>total+indexes.length,0),selected:Array<{assignment:PedagogicalAssignment;index:number;candidate:Candidate}>=[];
    const search=(position:number):boolean=>{maxDepth=Math.max(maxDepth,position);if(position===totalBlocks)return true;if(++exploredBranches>maxBranches||Date.now()>deadline){timedOut=true;return false;}const choices=jobs.filter(job=>(remainingIndexes.get(job.key)?.length??0)>0).map(job=>{const remaining=remainingIndexes.get(job.key)!;return{job,remaining,candidates:job.candidates.filter(candidate=>canPlace(job.assignment,candidate))}}).sort((left,right)=>(left.candidates.length-left.remaining.length)-(right.candidates.length-right.remaining.length)||left.candidates.length-right.candidates.length||right.job.size-left.job.size||right.job.assignment.weeklyPeriods-left.job.assignment.weeklyPeriods||left.job.assignment.id.localeCompare(right.job.assignment.id));const choice=choices[0];if(!choice||!choice.candidates.length)return false;const index=choice.remaining[0],candidates=[...choice.candidates].sort((left,right)=>candidateCost(choice.job.assignment,index,left)-candidateCost(choice.job.assignment,index,right)||`${left.day}-${left.periodIds.join()}`.localeCompare(`${right.day}-${right.periodIds.join()}`));for(const candidate of candidates){addCandidate(choice.job.assignment,candidate);choice.remaining.shift();selected.push({assignment:choice.job.assignment,index,candidate});if(search(position+1))return true;backtracks+=1;selected.pop();choice.remaining.unshift(index);removeCandidate(choice.job.assignment,candidate);if(timedOut)return false;}return false;};
    if(!search(0)){const first=jobs[0];return failure(first?.assignment,timedOut?"Temps maximal de résolution dépassé.":"Les contraintes enseignant, classe, blocs et volume sont incompatibles.",first?.candidates.length??0);}
    const now=new Date().toISOString(),generatedEntries=selected.flatMap(({assignment,index,candidate})=>candidate.periodIds.map((periodId):TimetableEntry=>({id:`${assignment.id}__${candidate.day}__${periodId}`,scheduleId:"pending",schoolId:problem.schoolId,schoolYearId:problem.schoolYearId,classId:assignment.classId,teacherId:assignment.teacherId,subjectId:assignment.subjectId,assignmentId:assignment.id,...(assignment.courseScope?{courseScope:assignment.courseScope,targetOptionIds:assignment.targetOptionIds,studentGroupKey:assignment.studentGroupKey}:{}),dayOfWeek:candidate.day,periodId,roomId:assignment.preferredRoomId??null,...(assignmentUsesDistinctBlockDays(assignment)?{blockId:`${assignment.id}__block_${index}`}:{ }),createdAt:now,updatedAt:now}))),entries=[...fixedEntries.map(entry=>({...entry,scheduleId:"pending",createdAt:now,updatedAt:now})),...generatedEntries],report=validateTimetable(problem,entries);
    return{success:report.valid,entries:report.valid?entries:[],failures:report.errors.map(error=>{const assignment=active.find(item=>item.id===error.entityId)||active[0];return{assignmentId:assignment?.id??"unknown",teacherId:assignment?.teacherId??"",classId:assignment?.classId??"",subjectId:assignment?.subjectId??"",required:assignment?.weeklyPeriods??0,availableCapacity:0,reason:error.message}}),statistics:statistics()};
  }
}
