import {describe,expect,it} from "vitest";import {arePeriodsPedagogicallyConsecutive,completedStudyTimetables,currentStudyTimetable,detectAvailabilityConflicts,getActiveCoursePeriods,getNonTeachingPeriods,isRestDay,maxConsecutiveCoursePeriods,schedulePeriodLabel,sortTimetableEntriesForDisplay,studyDayLabel,teacherAvailableAt,validTimeRange,validatePeriod} from "./studySchedule";import type {SchedulePeriod,TeacherAvailability,Timetable,TimetableEntry} from "./studyTypes";
const p=(id:string,startTime:string,endTime:string,type:SchedulePeriod["type"]="course",order=1):SchedulePeriod=>({id,schoolId:"s",schoolYearId:"y",label:id,startTime,endTime,type,order,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
const a=(status:TeacherAvailability["status"],startTime?:string,endTime?:string):TeacherAvailability=>({id:status+(startTime||""),schoolId:"s",schoolYearId:"y",teacherId:"t",dayOfWeek:"monday",status,startTime,endTime,active:true,createdBy:"u",createdAt:"n",updatedAt:"n"});
describe("contraintes horaires",()=>{it("valide 45, 50 et 60 minutes",()=>{expect(validTimeRange("07:30","08:15")).toBe(true);expect(validTimeRange("08:15","09:05")).toBe(true);expect(validTimeRange("09:05","10:05")).toBe(true);});it("détecte repos et indisponibilité",()=>{expect(isRestDay("t","monday",[a("rest")])).toBe(true);expect(teacherAvailableAt("t","monday",p("P","08:00","09:00"),[a("unavailable","08:30","09:30")])).toBe(false);});it("accepte plusieurs plages non chevauchantes",()=>{expect(detectAvailabilityConflicts([a("available","08:00","10:00"),a("available","13:00","15:00")])).toBe(false);});it("refuse chevauchement et REST contradictoire",()=>{expect(detectAvailabilityConflicts([a("available","08:00","10:00"),a("unavailable","09:00","11:00")])).toBe(true);expect(detectAvailabilityConflicts([a("rest"),a("available","08:00","10:00")])).toBe(true);});it("sépare cours et pauses",()=>{expect(getActiveCoursePeriods([p("pause","09:00","09:15","break",2),p("cours","08:00","09:00")]).map(x=>x.id)).toEqual(["cours"]);expect(getNonTeachingPeriods([p("pause","09:00","09:15","recess",2)]).map(x=>x.id)).toEqual(["pause"]);});it("refuse période inversée, ordre dupliqué et chevauchement",()=>{expect(validatePeriod(p("x","10:00","09:00"),[])).not.toBe("");expect(validatePeriod(p("x","08:30","09:30","course",2),[p("a","08:00","09:00","course",1)])).not.toBe("");});});
describe("continuité pédagogique",()=>{it("accepte uniquement des périodes jointives du même modèle",()=>{const periods=[p("p1","08:00","09:00","course",1),p("p2","09:00","10:00","course",2),p("p3","10:15","11:15","course",3)];expect(arePeriodsPedagogicallyConsecutive(periods.slice(0,2),periods)).toBe(true);expect(arePeriodsPedagogicallyConsecutive(periods,periods)).toBe(false);expect(maxConsecutiveCoursePeriods(periods)).toBe(2)});it("ne traverse jamais une pause configurée",()=>{const periods=[p("p1","08:00","09:00","course",1),p("pause","09:00","09:15","break",2),p("p2","09:15","10:15","course",3)];expect(arePeriodsPedagogicallyConsecutive([periods[0],periods[2]],periods)).toBe(false)});});

describe("libellés et état visible de l’horaire",()=>{
  it.each([
    ["monday","Lundi"],["tuesday","Mardi"],["wednesday","Mercredi"],["thursday","Jeudi"],
    ["friday","Vendredi"],["saturday","Samedi"],["sunday","Dimanche"],
  ])("traduit %s en %s",(day,label)=>expect(studyDayLabel(day)).toBe(label));
  it("rend le numéro canonique et les heures sans exposer l’identifiant technique",()=>{
    const period={...p("school__year__afternoon__weekdays__1","13:00","13:50"),label:"1ère période"};
    expect(schedulePeriodLabel(period.id,[period])).toBe("Période 1 — 13:00 – 13:50");
    expect(schedulePeriodLabel("missing",[period])).toBe("Période inconnue");
  });
  it("numérote plusieurs périodes selon leur ordre canonique",()=>{
    const periods=[p("period-4","14:00","14:45","course",4),p("period-1","12:30","13:15","course",1),p("break","14:00","14:15","break",3),p("period-2","13:15","14:00","course",2)];
    expect(periods.filter((period)=>period.type==="course").sort((left,right)=>left.order-right.order).map((period)=>schedulePeriodLabel(period.id,periods))).toEqual([
      "Période 1 — 12:30 – 13:15",
      "Période 2 — 13:15 – 14:00",
      "Période 3 — 14:00 – 14:45",
    ]);
  });
  it("groupe les entrées par jour puis période avec un ordre parallèle déterministe",()=>{
    const periods=[p("p1","12:30","13:15","course",1),p("p2","13:15","14:00","course",2),p("p3","14:00","14:45","course",3)];
    const entry=(id:string,dayOfWeek:TimetableEntry["dayOfWeek"],periodId:string,classId="class-a"):TimetableEntry=>({id,scheduleId:"schedule",schoolId:"s",schoolYearId:"y",classId,teacherId:"teacher",subjectId:"subject",assignmentId:"assignment",dayOfWeek,periodId,roomId:null,createdAt:"n",updatedAt:"n"});
    const entries=[entry("w2","wednesday","p2"),entry("m3","monday","p3"),entry("t1","tuesday","p1"),entry("m1-b","monday","p1","class-b"),entry("f1","friday","p1"),entry("m2","monday","p2"),entry("t2","tuesday","p2"),entry("m1-a","monday","p1","class-a")];
    expect(sortTimetableEntriesForDisplay(entries,periods).map((item)=>item.id)).toEqual(["m1-a","m1-b","m2","m3","t1","t2","w2","f1"]);
    expect(entries.map((item)=>item.id)).toEqual(["w2","m3","t1","m1-b","f1","m2","t2","m1-a"]);
  });
  it("ne sélectionne jamais un brouillon partiellement persisté",()=>{
    const base:Timetable={id:"complete",schoolId:"s",schoolYearId:"y",version:1,status:"DRAFT",activeDraft:true,createdBy:"u",createdAt:"n",updatedAt:"n",generationMetadata:{algorithm:"deterministic-backtracking",exploredBranches:1,durationMs:1,maxSameAssignmentPeriodsPerDay:2}};
    expect(currentStudyTimetable([{...base,id:"pending",version:2,activeDraft:false,persistenceState:"PENDING"},base])?.id).toBe("complete");
    expect(currentStudyTimetable([{...base,id:"pending",activeDraft:false,persistenceState:"PENDING"}])).toBeUndefined();
    expect(completedStudyTimetables([{...base,id:"pending",activeDraft:false,persistenceState:"PENDING"},base])).toEqual([base]);
  });
});
