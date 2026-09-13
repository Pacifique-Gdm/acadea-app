import {describe,expect,it} from "vitest";import {completedStudyTimetables,currentStudyTimetable,detectAvailabilityConflicts,getActiveCoursePeriods,getNonTeachingPeriods,isRestDay,schedulePeriodLabel,studyDayLabel,teacherAvailableAt,validTimeRange,validatePeriod} from "./studySchedule";import type {SchedulePeriod,TeacherAvailability,Timetable} from "./studyTypes";
const p=(id:string,startTime:string,endTime:string,type:SchedulePeriod["type"]="course",order=1):SchedulePeriod=>({id,schoolId:"s",schoolYearId:"y",label:id,startTime,endTime,type,order,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const a=(status:TeacherAvailability["status"],startTime?:string,endTime?:string):TeacherAvailability=>({id:status+(startTime||""),schoolId:"s",schoolYearId:"y",teacherId:"t",dayOfWeek:"monday",status,startTime,endTime,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
describe("contraintes horaires",()=>{it("valide 45, 50 et 60 minutes",()=>{expect(validTimeRange("07:30","08:15")).toBe(true);expect(validTimeRange("08:15","09:05")).toBe(true);expect(validTimeRange("09:05","10:05")).toBe(true);});it("détecte repos et indisponibilité",()=>{expect(isRestDay("t","monday",[a("rest")])).toBe(true);expect(teacherAvailableAt("t","monday",p("P","08:00","09:00"),[a("unavailable","08:30","09:30")])).toBe(false);});it("accepte plusieurs plages non chevauchantes",()=>{expect(detectAvailabilityConflicts([a("available","08:00","10:00"),a("available","13:00","15:00")])).toBe(false);});it("refuse chevauchement et REST contradictoire",()=>{expect(detectAvailabilityConflicts([a("available","08:00","10:00"),a("unavailable","09:00","11:00")])).toBe(true);expect(detectAvailabilityConflicts([a("rest"),a("available","08:00","10:00")])).toBe(true);});it("sépare cours et pauses",()=>{expect(getActiveCoursePeriods([p("pause","09:00","09:15","break",2),p("cours","08:00","09:00")]).map(x=>x.id)).toEqual(["cours"]);expect(getNonTeachingPeriods([p("pause","09:00","09:15","recess",2)]).map(x=>x.id)).toEqual(["pause"]);});it("refuse période inversée, ordre dupliqué et chevauchement",()=>{expect(validatePeriod(p("x","10:00","09:00"),[])).not.toBe("");expect(validatePeriod(p("x","08:30","09:30","course",2),[p("a","08:00","09:00","course",1)])).not.toBe("");});});

describe("libellés et état visible de l’horaire",()=>{
  it.each([
    ["monday","Lundi"],["tuesday","Mardi"],["wednesday","Mercredi"],["thursday","Jeudi"],
    ["friday","Vendredi"],["saturday","Samedi"],["sunday","Dimanche"],
  ])("traduit %s en %s",(day,label)=>expect(studyDayLabel(day)).toBe(label));
  it("rend le libellé métier et les heures sans exposer l’identifiant technique",()=>{
    const period={...p("school__year__afternoon__weekdays__1","13:00","13:50"),label:"1ère période"};
    expect(schedulePeriodLabel(period.id,[period])).toBe("1ère période — 13:00 – 13:50");
    expect(schedulePeriodLabel("missing",[period])).toBe("Période inconnue");
  });
  it("ne sélectionne jamais un brouillon partiellement persisté",()=>{
    const base:Timetable={id:"complete",schoolId:"s",schoolYearId:"y",version:1,status:"DRAFT",activeDraft:true,createdBy:"u",createdAt:"n",updatedAt:"n",generationMetadata:{algorithm:"deterministic-backtracking",exploredBranches:1,durationMs:1,maxSameAssignmentPeriodsPerDay:2}};
    expect(currentStudyTimetable([{...base,id:"pending",version:2,activeDraft:false,persistenceState:"PENDING"},base])?.id).toBe("complete");
    expect(currentStudyTimetable([{...base,id:"pending",activeDraft:false,persistenceState:"PENDING"}])).toBeUndefined();
    expect(completedStudyTimetables([{...base,id:"pending",activeDraft:false,persistenceState:"PENDING"},base])).toEqual([base]);
  });
});
