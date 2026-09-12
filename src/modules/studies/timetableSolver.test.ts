import { describe, expect, it } from "vitest";
import { DeterministicTimetableSolver, diagnoseAssignmentSlots } from "./timetableSolver";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, TeacherAvailability } from "./studyTypes";

const solver=new DeterministicTimetableSolver();
const period=(id:string,order:number,type:SchedulePeriod["type"]="course"):SchedulePeriod=>({id,schoolId:"s",schoolYearId:"y",label:id,startTime:`0${7+order}:00`.slice(-5),endTime:`0${8+order}:00`.slice(-5),order,type,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const assignment=(id:string,teacherId="t",classId="c",subjectId=id,weeklyPeriods=1,blockSize:1|2=1):PedagogicalAssignment=>({id,schoolId:"s",schoolYearId:"y",teacherId,classId,subjectId,weeklyPeriods,blockSize,active:true,createdBy:"u",updatedBy:"u",createdAt:"n",updatedAt:"n"});
const availability=(status:TeacherAvailability["status"],dayOfWeek:TeacherAvailability["dayOfWeek"]="monday",startTime?:string,endTime?:string):TeacherAvailability=>({id:`${status}-${dayOfWeek}-${startTime||"all"}`,schoolId:"s",schoolYearId:"y",teacherId:"t",dayOfWeek,status,startTime,endTime,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const schoolClass=(id="c", vacation?:StudyClass["vacation"]):StudyClass=>({id,schoolId:"s",schoolYearId:"y",name:id,section:"Secondaire",vacation,active:true});
const problem=(assignments:PedagogicalAssignment[],periods:SchedulePeriod[]= [period("p1",1),period("p2",2),period("p3",3)],availabilities:TeacherAvailability[]=[])=>({schoolId:"s",schoolYearId:"y",assignments,periods,availabilities,classes:[...new Set(assignments.map(item=>item.classId))].map(id=>schoolClass(id)),maxSameAssignmentPeriodsPerDay:2});

describe("moteur déterministe d’horaires",()=>{
  it("simule une école avec deux sous-classes indépendantes et une classe sans sous-classe",()=>{
    const assignments=[
      assignment("math-7a","teacher-1","class-7a","math",4),
      assignment("math-7b","teacher-2","class-7b","math",4),
      assignment("french-7a","teacher-3","class-7a","french",3),
      assignment("french-7b","teacher-3","class-7b","french",3),
      assignment("science-8","teacher-4","class-8","science",4),
      assignment("history-8","teacher-1","class-8","history",2),
    ];
    const result=solver.solve(problem(assignments,[period("p1",1),period("p2",2),period("p3",3),period("p4",4)]));
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(20);
    expect(new Set(result.entries.map(e=>`${e.teacherId}|${e.dayOfWeek}|${e.periodId}`)).size).toBe(20);
    expect(new Set(result.entries.map(e=>`${e.classId}|${e.dayOfWeek}|${e.periodId}`)).size).toBe(20);
    expect(result.entries.filter(e=>e.classId==="class-7a")).toHaveLength(7);
    expect(result.entries.filter(e=>e.classId==="class-7b")).toHaveLength(7);
    expect(result.entries.filter(e=>e.classId==="class-8")).toHaveLength(6);
    expect(result.entries.every(e=>e.schoolId==="s"&&e.schoolYearId==="y")).toBe(true);
  });
  it("place un enseignant, une matière et une classe",()=>expect(solver.solve(problem([assignment("a")])).entries).toHaveLength(1));
  it("génère le cas minimal avec une classe historique et une période moderne du matin",()=>{const input={...problem([assignment("a")],[{...period("p1",1),vacation:"morning" as const,dayScope:"weekdays" as const}]),days:["monday" as const]};const diagnostics=diagnoseAssignmentSlots(input.assignments[0],input);expect(diagnostics).toMatchObject({rawSlots:6,afterConfiguredDays:1,afterPeriods:1,afterClassVacation:1,afterTeacherRest:1,afterTeacherAvailability:1,afterTeacherConflicts:1,afterStudentGroupConflicts:1,afterExistingEntries:1,afterBlockRules:1,finalCandidates:1});expect(solver.solve(input)).toMatchObject({success:true,entries:[{teacherId:"t",classId:"c",periodId:"p1"}]})});
  it("refuse explicitement l’absence d’affectation",()=>expect(solver.solve(problem([])).failures[0].reason).toBe("Aucune affectation active."));
  it("refuse explicitement l’absence de créneau",()=>expect(solver.solve(problem([assignment("a")],[])).failures[0].reason).toBe("Aucun créneau horaire configuré."));
  it("respecte uniquement les jours scolaires configurés",()=>{const result=solver.solve({...problem([assignment("a")]),days:["monday"]});expect(result.success).toBe(true);expect(result.entries.every(entry=>entry.dayOfWeek==="monday")).toBe(true)});
  it("place trois matières d’un enseignant",()=>expect(solver.solve(problem([assignment("a"),assignment("b"),assignment("c")])).success).toBe(true));
  it("place un enseignant dans plusieurs classes sans chevauchement",()=>{const result=solver.solve(problem([assignment("a","t","c1"),assignment("b","t","c2")]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>`${e.dayOfWeek}-${e.periodId}`)).size).toBe(2)});
  it("respecte un jour de repos",()=>{const result=solver.solve(problem([assignment("a")],undefined,[availability("rest")]));expect(result.entries.every(e=>e.dayOfWeek!=="monday")).toBe(true)});
  it("respecte une indisponibilité partielle",()=>{const result=solver.solve(problem([assignment("a")],undefined,[availability("unavailable","monday","08:00","09:00")]));expect(result.entries.some(e=>e.dayOfWeek==="monday"&&e.periodId==="p1")).toBe(false)});
  it("accepte exactement deux périodes quotidiennes",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2)]));const counts=new Map<string,number>();result.entries.forEach(e=>counts.set(e.dayOfWeek,(counts.get(e.dayOfWeek)||0)+1));expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)});
  it("répartit trois périodes sur plusieurs jours",()=>{const result=solver.solve(problem([assignment("a","t","c","m",3)]));expect(new Set(result.entries.map(e=>e.dayOfWeek)).size).toBeGreaterThan(1)});
  it("accepte deux périodes consécutives ou séparées",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2)]));expect(result.success).toBe(true);expect(result.entries).toHaveLength(2)});
  it("place un cours double dans un bloc adjacent",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2,2)]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>e.blockId)).size).toBe(1)});
  it("refuse un cours double coupé par une pause",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2,2)],[period("p1",1),period("pause",2,"break"),period("p2",3)]));expect(result.success).toBe(false);expect(result.failures[0].reason).toContain("bloc de périodes consécutives")});
  it("évite les chevauchements enseignant",()=>{const result=solver.solve(problem([assignment("a","t","c1"),assignment("b","t","c2")]));expect(new Set(result.entries.map(e=>`${e.teacherId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length)});
  it("évite les chevauchements classe",()=>{const result=solver.solve(problem([assignment("a","t1","c"),assignment("b","t2","c")]));expect(new Set(result.entries.map(e=>`${e.classId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length)});
  it("gère les intersections d’options sans multiplier weeklyPeriods",()=>{
    const optionClasses:StudyClass[]=[schoolClass("3h"),{...schoolClass("3h::sci"),parentClassId:"3h",classOptionKey:"3h::sci",option:"Scientifique"},{...schoolClass("3h::com"),parentClassId:"3h",classOptionKey:"3h::com",option:"Commerciale"},{...schoolClass("3h::lit"),parentClassId:"3h",classOptionKey:"3h::lit",option:"Littéraire"},{...schoolClass("3h::ped"),parentClassId:"3h",classOptionKey:"3h::ped",option:"Pédagogie"}];
    const scoped=(id:string,teacherId:string,targetOptionIds:string[],courseScope:"common"|"option"="option",weeklyPeriods=1):PedagogicalAssignment=>({...assignment(id,teacherId,"3h",id,weeklyPeriods),courseScope,targetOptionIds,studentGroupKey:`${courseScope}--${targetOptionIds.join("--")}`});
    const solve=(items:PedagogicalAssignment[],slots=1)=>solver.solve({...problem(items,Array.from({length:slots},(_,index)=>period(`p${index+1}`,index+1))),classes:optionClasses,days:["monday"] as const});
    expect(solve([scoped("fr","t1",["3h::sci","3h::com"],"common"),scoped("accounting","t2",["3h::com"])],1).success).toBe(false);
    expect(solve([scoped("physics","t1",["3h::sci"]),scoped("accounting","t2",["3h::com"])],1).success).toBe(true);
    expect(solve([scoped("fr","t1",["3h::sci","3h::com"],"common"),scoped("latin","t2",["3h::lit","3h::ped"],"common")],1).success).toBe(true);
    expect(solve([scoped("fr","t1",["3h::sci","3h::com"],"common"),scoped("math","t2",["3h::com","3h::lit"],"common")],1).success).toBe(false);
    expect(solver.solve({...problem([scoped("fr","t1",["3h::sci","3h::com","3h::lit"],"common",4)],[period("p1",1),period("p2",2)]),classes:optionClasses}).entries).toHaveLength(4);
  });
  it("évite les chevauchements de salle et accepte roomId null",()=>{const first={...assignment("a","t1","c1"),preferredRoomId:"room"};const second={...assignment("b","t2","c2"),preferredRoomId:"room"};const result=solver.solve(problem([first,second]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>`${e.roomId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length);expect(solver.solve(problem([assignment("c")])).entries[0].roomId).toBeNull()});
  it.each(["break","recess"] as const)("n’utilise jamais une période %s",type=>{const result=solver.solve(problem([assignment("a")],[period("x",1,type),period("p",2)]));expect(result.entries[0].periodId).toBe("p")});
  it("respecte exactement le volume hebdomadaire",()=>expect(solver.solve(problem([assignment("a","t","c","m",4)])).entries).toHaveLength(4));
  it("explique un volume individuel impossible",()=>{const result=solver.solve(problem([assignment("a","t","c","m",13)],[period("p",1)]));expect(result.success).toBe(false);expect(result.failures[0]).toMatchObject({assignmentId:"a",required:13,availableCapacity:6});expect(result.failures[0].reason).toContain("dépasse la capacité")});
  it("explique une capacité agrégée de classe insuffisante avant le backtracking",()=>{const result=solver.solve(problem([assignment("a","t1","c","m1",4),assignment("b","t2","c","m2",4)],[period("p",1)]));expect(result.success).toBe(false);expect(result.statistics.exploredBranches).toBe(0);expect(result.failures[0].reason).toContain("capacité de la classe")});
  it("explique précisément des disponibilités qui excluent tous les créneaux",()=>{const rests=(["monday","tuesday","wednesday","thursday","friday","saturday"] as const).map(day=>availability("rest",day));const result=solver.solve(problem([assignment("a")],undefined,rests));expect(result.success).toBe(false);expect(result.failures[0].reason).toContain("disponibilités de l’enseignant")});
  it("refuse une affectation d’une autre école",()=>{const foreign={...assignment("a"),schoolId:"other"};expect(solver.solve(problem([foreign])).failures[0].reason).toContain("hors école")});
  it("refuse une affectation d’une autre année",()=>{const foreign={...assignment("a"),schoolYearId:"other"};expect(solver.solve(problem([foreign])).success).toBe(false)});
  it("reste déterministe",()=>{const input=problem([assignment("a","t","c","m",4)]);expect(solver.solve(input).entries.map(e=>e.id)).toEqual(solver.solve(input).entries.map(e=>e.id))});
  it("échoue proprement à la limite d’itérations",()=>{const result=solver.solve(problem([assignment("a")]),{maxBranches:0});expect(result.success).toBe(false);expect(result.statistics.timedOut).toBe(true)});
});
