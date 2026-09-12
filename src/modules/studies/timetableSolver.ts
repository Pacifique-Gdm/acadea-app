import { getActiveCoursePeriods, isRestDay, STUDY_DAYS, teacherAvailableAt } from "./studySchedule";
import { adjacentCoursePeriods, validateTimetable, type ScheduleProblem } from "./scheduleValidation";
import type { PedagogicalAssignment, StudyDay, TimetableEntry } from "./studyTypes";
import { periodAppliesToClass } from "./studyScope";
import { assignmentsShareStudents, normalizedAssignmentScope } from "./studyCourseScope";

export const DEFAULT_MAX_SAME_ASSIGNMENT_PERIODS_PER_DAY=2;
export interface SolverFailure { assignmentId:string; teacherId:string; classId:string; subjectId:string; required:number; availableCapacity:number; reason:string; }
export interface SolverResult { success:boolean; entries:TimetableEntry[]; failures:SolverFailure[]; statistics:{exploredBranches:number;durationMs:number;timedOut:boolean}; }
export interface TimetableSolverOptions { maxBranches?:number; timeoutMs?:number; baselineEntries?:TimetableEntry[]; preferredMorningAssignmentIds?:string[]; }
export interface TimetableSolver { solve(problem:ScheduleProblem,options?:TimetableSolverOptions):SolverResult; }

type Candidate={day:StudyDay;periodIds:string[]};
export interface AssignmentSlotDiagnostics {
  rawSlots: number;
  afterConfiguredDays: number;
  afterPeriods: number;
  afterClassVacation: number;
  afterTeacherRest: number;
  afterTeacherAvailability: number;
  afterTeacherConflicts: number;
  afterStudentGroupConflicts: number;
  afterExistingEntries: number;
  afterBlockRules: number;
  finalCandidates: number;
  activePeriodSlots: number;
  classCompatibleSlots: number;
  teacherCompatibleSlots: number;
  candidateBlocks: number;
}

function candidateAnalysis(assignment:PedagogicalAssignment,problem:ScheduleProblem):{candidates:Candidate[];diagnostics:AssignmentSlotDiagnostics}{
  const periods=getActiveCoursePeriods(problem.periods),schoolClass=problem.classes?.find(item=>item.id===assignment.classId),size=assignment.blockSize??1,result:Candidate[]=[];
  let activePeriodSlots=0,classCompatibleSlots=0,afterTeacherRest=0,teacherCompatibleSlots=0;
  for(const day of problem.days??STUDY_DAYS){
    activePeriodSlots+=periods.length;
    const compatible=schoolClass?periods.filter(period=>periodAppliesToClass(period,schoolClass,day)):[];
    classCompatibleSlots+=compatible.length;
    afterTeacherRest+=isRestDay(assignment.teacherId,day,problem.availabilities)?0:compatible.length;
    teacherCompatibleSlots+=compatible.filter(period=>teacherAvailableAt(assignment.teacherId,day,period,problem.availabilities)).length;
    for(let i=0;i<compatible.length;i+=1){const block=compatible.slice(i,i+size);if(block.length!==size)continue;if(size===2&&!adjacentCoursePeriods(block[0],block[1],problem.periods))continue;if(block.every(period=>teacherAvailableAt(assignment.teacherId,day,period,problem.availabilities)))result.push({day,periodIds:block.map(period=>period.id)});}
  }
  const rawSlots=STUDY_DAYS.length*periods.length;
  return{candidates:result,diagnostics:{rawSlots,afterConfiguredDays:activePeriodSlots,afterPeriods:activePeriodSlots,afterClassVacation:classCompatibleSlots,afterTeacherRest,afterTeacherAvailability:teacherCompatibleSlots,afterTeacherConflicts:teacherCompatibleSlots,afterStudentGroupConflicts:teacherCompatibleSlots,afterExistingEntries:teacherCompatibleSlots,afterBlockRules:result.length,finalCandidates:result.length,activePeriodSlots,classCompatibleSlots,teacherCompatibleSlots,candidateBlocks:result.length}};
}

export function diagnoseAssignmentSlots(assignment:PedagogicalAssignment,problem:ScheduleProblem){return candidateAnalysis(assignment,problem).diagnostics;}

function zeroCandidateReason(assignment:PedagogicalAssignment,problem:ScheduleProblem,diagnostics:AssignmentSlotDiagnostics){
  if(!problem.classes?.some(item=>item.id===assignment.classId))return"La classe de l’affectation est introuvable dans l’école et l’année actives.";
  if(diagnostics.activePeriodSlots===0)return"Aucun créneau horaire actif n’est configuré.";
  if(diagnostics.classCompatibleSlots===0)return"Aucun créneau horaire ne correspond aux jours et à la vacation de cette classe.";
  if(diagnostics.teacherCompatibleSlots===0)return"Les disponibilités de l’enseignant excluent tous les créneaux compatibles avec cette classe.";
  return"Aucun bloc de périodes consécutives ne satisfait la configuration de cette affectation.";
}

function capacityFailure(jobs:Array<{assignment:PedagogicalAssignment;candidates:Candidate[]}>,classes:readonly import("./studyTypes").StudyClass[]){
  const legacyClassIds=[...new Set(jobs.filter(job=>!normalizedAssignmentScope(job.assignment,classes).optionIds).map(job=>normalizedAssignmentScope(job.assignment,classes).baseClassId))];
  for(const classId of legacyClassIds){
    const scoped=jobs.filter(job=>{const group=normalizedAssignmentScope(job.assignment,classes);return group.baseClassId===classId&&!group.optionIds;});
    const required=scoped.reduce((total,job)=>total+job.assignment.weeklyPeriods,0);
    const capacity=new Set(scoped.flatMap(job=>job.candidates.flatMap(candidate=>candidate.periodIds.map(periodId=>`${candidate.day}|${periodId}`)))).size;
    if(required>capacity)return{job:scoped[0],capacity,reason:`La capacité de la classe est insuffisante : ${required} périodes demandées pour ${capacity} créneaux compatibles.`};
  }
  for(const [label,key] of [["de l’enseignant","teacherId"]] as const){
    const ids=[...new Set(jobs.map(job=>job.assignment[key]))];
    for(const id of ids){
      const scoped=jobs.filter(job=>job.assignment[key]===id);
      const required=scoped.reduce((total,job)=>total+job.assignment.weeklyPeriods,0);
      const capacity=new Set(scoped.flatMap(job=>job.candidates.flatMap(candidate=>candidate.periodIds.map(periodId=>`${candidate.day}|${periodId}`)))).size;
      if(required>capacity)return{job:scoped[0],capacity,reason:`La capacité ${label} est insuffisante : ${required} périodes demandées pour ${capacity} créneaux compatibles.`};
    }
  }
  return undefined;
}

export class DeterministicTimetableSolver implements TimetableSolver{
  solve(problem:ScheduleProblem,options:TimetableSolverOptions={}):SolverResult{
    const started=Date.now(),deadline=started+(options.timeoutMs??2000),maxBranches=options.maxBranches??100000;let exploredBranches=0,timedOut=false;
    const active=problem.assignments.filter(item=>item.active);const invalidScope=active.find(item=>item.schoolId!==problem.schoolId||item.schoolYearId!==problem.schoolYearId);
    if(!active.length)return{success:false,entries:[],failures:[{assignmentId:"unknown",teacherId:"",classId:"",subjectId:"",required:0,availableCapacity:0,reason:"Aucune affectation active."}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};
    if(!getActiveCoursePeriods(problem.periods).length)return{success:false,entries:[],failures:[{assignmentId:active[0].id,teacherId:active[0].teacherId,classId:active[0].classId,subjectId:active[0].subjectId,required:active[0].weeklyPeriods,availableCapacity:0,reason:"Aucun créneau horaire configuré."}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};
    if(invalidScope)return{success:false,entries:[],failures:[{assignmentId:invalidScope.id,teacherId:invalidScope.teacherId,classId:invalidScope.classId,subjectId:invalidScope.subjectId,required:invalidScope.weeklyPeriods,availableCapacity:0,reason:"Affectation hors école ou année scolaire."}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};
    const jobs=active.map(assignment=>{const analysis=candidateAnalysis(assignment,problem);return{assignment,blockSize:assignment.blockSize??1,blocks:assignment.weeklyPeriods/(assignment.blockSize??1),...analysis}}).sort((a,b)=>a.candidates.length-b.candidates.length||b.blockSize-a.blockSize||b.assignment.weeklyPeriods-a.assignment.weeklyPeriods||a.assignment.id.localeCompare(b.assignment.id));
    const impossible=jobs.find(job=>!Number.isInteger(job.blocks)||job.candidates.length<job.blocks);if(impossible){const noCandidate=impossible.candidates.length===0;return{success:false,entries:[],failures:[{assignmentId:impossible.assignment.id,teacherId:impossible.assignment.teacherId,classId:impossible.assignment.classId,subjectId:impossible.assignment.subjectId,required:impossible.assignment.weeklyPeriods,availableCapacity:impossible.candidates.length*impossible.blockSize,reason:impossible.blockSize===2&&impossible.assignment.weeklyPeriods%2?"Le volume d’un cours double doit être pair.":noCandidate?zeroCandidateReason(impossible.assignment,problem,impossible.diagnostics):`Le volume demandé (${impossible.assignment.weeklyPeriods}) dépasse la capacité compatible (${impossible.candidates.length*impossible.blockSize}).`}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};}
    const bottleneck=capacityFailure(jobs,problem.classes??[]);if(bottleneck)return{success:false,entries:[],failures:[{assignmentId:bottleneck.job.assignment.id,teacherId:bottleneck.job.assignment.teacherId,classId:bottleneck.job.assignment.classId,subjectId:bottleneck.job.assignment.subjectId,required:bottleneck.job.assignment.weeklyPeriods,availableCapacity:bottleneck.capacity,reason:bottleneck.reason}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};
    const baselineByAssignment=new Map<string,TimetableEntry[]>();for(const entry of options.baselineEntries??[]){const list=baselineByAssignment.get(entry.assignmentId)??[];list.push(entry);baselineByAssignment.set(entry.assignmentId,list)}const morning=new Set(options.preferredMorningAssignmentIds??[]);const candidateCost=(assignment:PedagogicalAssignment,index:number,candidate:Candidate)=>{const baseline=[...(baselineByAssignment.get(assignment.id)??[])].sort((a,b)=>`${a.dayOfWeek}-${a.periodId}`.localeCompare(`${b.dayOfWeek}-${b.periodId}`));const prior=baseline[index*(assignment.blockSize??1)];let cost=prior?(prior.dayOfWeek===candidate.day?(prior.periodId===candidate.periodIds[0]?0:1):4):2;if(morning.has(assignment.id))cost+=candidate.periodIds.some(id=>problem.periods.find(p=>p.id===id)?.order&&Number(problem.periods.find(p=>p.id===id)!.order)>Math.ceil(getActiveCoursePeriods(problem.periods).length/2))?3:0;return cost};
    const tasks=jobs.flatMap(job=>Array.from({length:job.blocks},(_,index)=>({assignment:job.assignment,index,candidates:[...job.candidates].sort((a,b)=>candidateCost(job.assignment,index,a)-candidateCost(job.assignment,index,b)||`${a.day}-${a.periodIds.join()}`.localeCompare(`${b.day}-${b.periodIds.join()}`))})));
    const selected:Array<{assignment:PedagogicalAssignment;index:number;candidate:Candidate}>=[];
    const teacherBusy=new Set<string>(),roomBusy=new Set<string>(),studentBusy=new Map<string,PedagogicalAssignment[]>(),daily=new Map<string,number>();
    const studentConflict=(assignment:PedagogicalAssignment,day:StudyDay,periodId:string)=>(studentBusy.get(`${day}|${periodId}`)??[]).some(other=>assignmentsShareStudents(assignment,other,problem.classes??[]));
    const search=(position:number):boolean=>{if(position===tasks.length)return true;if(++exploredBranches>maxBranches||Date.now()>deadline){timedOut=true;return false;}const task=tasks[position];for(const candidate of task.candidates){const countKey=`${task.assignment.id}|${candidate.day}`;if((daily.get(countKey)||0)+candidate.periodIds.length>(problem.maxSameAssignmentPeriodsPerDay??DEFAULT_MAX_SAME_ASSIGNMENT_PERIODS_PER_DAY))continue;if(candidate.periodIds.some(periodId=>teacherBusy.has(`${task.assignment.teacherId}|${candidate.day}|${periodId}`)||studentConflict(task.assignment,candidate.day,periodId)||(task.assignment.preferredRoomId&&roomBusy.has(`${task.assignment.preferredRoomId}|${candidate.day}|${periodId}`))))continue;candidate.periodIds.forEach(periodId=>{teacherBusy.add(`${task.assignment.teacherId}|${candidate.day}|${periodId}`);const key=`${candidate.day}|${periodId}`;studentBusy.set(key,[...(studentBusy.get(key)??[]),task.assignment]);if(task.assignment.preferredRoomId)roomBusy.add(`${task.assignment.preferredRoomId}|${candidate.day}|${periodId}`)});daily.set(countKey,(daily.get(countKey)||0)+candidate.periodIds.length);selected.push({assignment:task.assignment,index:task.index,candidate});if(search(position+1))return true;selected.pop();daily.set(countKey,(daily.get(countKey)||0)-candidate.periodIds.length);candidate.periodIds.forEach(periodId=>{teacherBusy.delete(`${task.assignment.teacherId}|${candidate.day}|${periodId}`);const key=`${candidate.day}|${periodId}`;const occupied=studentBusy.get(key)??[];const removal=occupied.lastIndexOf(task.assignment);if(removal>=0)occupied.splice(removal,1);if(occupied.length)studentBusy.set(key,occupied);else studentBusy.delete(key);if(task.assignment.preferredRoomId)roomBusy.delete(`${task.assignment.preferredRoomId}|${candidate.day}|${periodId}`)});if(timedOut)return false;}return false;};
    const solved=search(0);if(!solved){const first=jobs[0];return{success:false,entries:[],failures:[{assignmentId:first?.assignment.id??"unknown",teacherId:first?.assignment.teacherId??"",classId:first?.assignment.classId??"",subjectId:first?.assignment.subjectId??"",required:first?.assignment.weeklyPeriods??0,availableCapacity:first?.candidates.length??0,reason:timedOut?"Temps maximal de résolution dépassé.":"Les contraintes enseignant, classe et volume sont incompatibles."}],statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};}
    const now=new Date().toISOString();const entries=selected.flatMap(({assignment,index,candidate})=>candidate.periodIds.map((periodId):TimetableEntry=>({id:`${assignment.id}__${candidate.day}__${periodId}`,scheduleId:"pending",schoolId:problem.schoolId,schoolYearId:problem.schoolYearId,classId:assignment.classId,teacherId:assignment.teacherId,subjectId:assignment.subjectId,assignmentId:assignment.id,...(assignment.courseScope?{courseScope:assignment.courseScope,targetOptionIds:assignment.targetOptionIds,studentGroupKey:assignment.studentGroupKey}:{}),dayOfWeek:candidate.day,periodId,roomId:assignment.preferredRoomId??null,...((assignment.blockSize??1)>1?{blockId:`${assignment.id}__block_${index}`}:{ }),createdAt:now,updatedAt:now})));
    const report=validateTimetable(problem,entries);return{success:report.valid,entries:report.valid?entries:[],failures:report.errors.map(error=>{const assignment=active.find(item=>item.id===error.entityId)||active[0];return{assignmentId:assignment?.id??"unknown",teacherId:assignment?.teacherId??"",classId:assignment?.classId??"",subjectId:assignment?.subjectId??"",required:assignment?.weeklyPeriods??0,availableCapacity:0,reason:error.message}}),statistics:{exploredBranches,durationMs:Date.now()-started,timedOut}};
  }
}
