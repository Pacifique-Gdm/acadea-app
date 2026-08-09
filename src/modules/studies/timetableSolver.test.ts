import { describe, expect, it } from "vitest";
import { DeterministicTimetableSolver } from "./timetableSolver";
import type { PedagogicalAssignment, SchedulePeriod, TeacherAvailability } from "./studyTypes";

const solver=new DeterministicTimetableSolver();
const period=(id:string,order:number,type:SchedulePeriod["type"]="course"):SchedulePeriod=>({id,schoolId:"s",schoolYearId:"y",label:id,startTime:`0${7+order}:00`.slice(-5),endTime:`0${8+order}:00`.slice(-5),order,type,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const assignment=(id:string,teacherId="t",classId="c",subjectId=id,weeklyPeriods=1,blockSize:1|2=1):PedagogicalAssignment=>({id,schoolId:"s",schoolYearId:"y",teacherId,classId,subjectId,weeklyPeriods,blockSize,active:true,createdBy:"u",updatedBy:"u",createdAt:"n",updatedAt:"n"});
const availability=(status:TeacherAvailability["status"],dayOfWeek:TeacherAvailability["dayOfWeek"]="monday",startTime?:string,endTime?:string):TeacherAvailability=>({id:`${status}-${dayOfWeek}-${startTime||"all"}`,schoolId:"s",schoolYearId:"y",teacherId:"t",dayOfWeek,status,startTime,endTime,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const problem=(assignments:PedagogicalAssignment[],periods:SchedulePeriod[]= [period("p1",1),period("p2",2),period("p3",3)],availabilities:TeacherAvailability[]=[])=>( {schoolId:"s",schoolYearId:"y",assignments,periods,availabilities,maxSameAssignmentPeriodsPerDay:2} );

describe("moteur déterministe d’horaires",()=>{
  it("place un enseignant, une matière et une classe",()=>expect(solver.solve(problem([assignment("a")])).entries).toHaveLength(1));
  it("place trois matières d’un enseignant",()=>expect(solver.solve(problem([assignment("a"),assignment("b"),assignment("c")])).success).toBe(true));
  it("place un enseignant dans plusieurs classes sans chevauchement",()=>{const result=solver.solve(problem([assignment("a","t","c1"),assignment("b","t","c2")]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>`${e.dayOfWeek}-${e.periodId}`)).size).toBe(2)});
  it("respecte un jour de repos",()=>{const result=solver.solve(problem([assignment("a")],undefined,[availability("rest")]));expect(result.entries.every(e=>e.dayOfWeek!=="monday")).toBe(true)});
  it("respecte une indisponibilité partielle",()=>{const result=solver.solve(problem([assignment("a")],undefined,[availability("unavailable","monday","08:00","09:00")]));expect(result.entries.some(e=>e.dayOfWeek==="monday"&&e.periodId==="p1")).toBe(false)});
  it("accepte exactement deux périodes quotidiennes",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2)]));const counts=new Map<string,number>();result.entries.forEach(e=>counts.set(e.dayOfWeek,(counts.get(e.dayOfWeek)||0)+1));expect(Math.max(...counts.values())).toBeLessThanOrEqual(2)});
  it("répartit trois périodes sur plusieurs jours",()=>{const result=solver.solve(problem([assignment("a","t","c","m",3)]));expect(new Set(result.entries.map(e=>e.dayOfWeek)).size).toBeGreaterThan(1)});
  it("accepte deux périodes consécutives ou séparées",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2)]));expect(result.success).toBe(true);expect(result.entries).toHaveLength(2)});
  it("place un cours double dans un bloc adjacent",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2,2)]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>e.blockId)).size).toBe(1)});
  it("refuse un cours double coupé par une pause",()=>{const result=solver.solve(problem([assignment("a","t","c","m",2,2)],[period("p1",1),period("pause",2,"break"),period("p2",3)]));expect(result.success).toBe(false);expect(result.failures[0].reason).toContain("insuffisant")});
  it("évite les chevauchements enseignant",()=>{const result=solver.solve(problem([assignment("a","t","c1"),assignment("b","t","c2")]));expect(new Set(result.entries.map(e=>`${e.teacherId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length)});
  it("évite les chevauchements classe",()=>{const result=solver.solve(problem([assignment("a","t1","c"),assignment("b","t2","c")]));expect(new Set(result.entries.map(e=>`${e.classId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length)});
  it("évite les chevauchements de salle et accepte roomId null",()=>{const first={...assignment("a","t1","c1"),preferredRoomId:"room"};const second={...assignment("b","t2","c2"),preferredRoomId:"room"};const result=solver.solve(problem([first,second]));expect(result.success).toBe(true);expect(new Set(result.entries.map(e=>`${e.roomId}-${e.dayOfWeek}-${e.periodId}`)).size).toBe(result.entries.length);expect(solver.solve(problem([assignment("c")])).entries[0].roomId).toBeNull()});
  it.each(["break","recess"] as const)("n’utilise jamais une période %s",type=>{const result=solver.solve(problem([assignment("a")],[period("x",1,type),period("p",2)]));expect(result.entries[0].periodId).toBe("p")});
  it("respecte exactement le volume hebdomadaire",()=>expect(solver.solve(problem([assignment("a","t","c","m",4)])).entries).toHaveLength(4));
  it("explique un volume impossible",()=>{const result=solver.solve(problem([assignment("a","t","c","m",13)],[period("p",1)]));expect(result.success).toBe(false);expect(result.failures[0]).toMatchObject({assignmentId:"a",required:13})});
  it("refuse une affectation d’une autre école",()=>{const foreign={...assignment("a"),schoolId:"other"};expect(solver.solve(problem([foreign])).failures[0].reason).toContain("hors école")});
  it("refuse une affectation d’une autre année",()=>{const foreign={...assignment("a"),schoolYearId:"other"};expect(solver.solve(problem([foreign])).success).toBe(false)});
  it("reste déterministe",()=>{const input=problem([assignment("a","t","c","m",4)]);expect(solver.solve(input).entries.map(e=>e.id)).toEqual(solver.solve(input).entries.map(e=>e.id))});
  it("échoue proprement à la limite d’itérations",()=>{const result=solver.solve(problem([assignment("a")]),{maxBranches:0});expect(result.success).toBe(false);expect(result.statistics.timedOut).toBe(true)});
});
