import { describe, expect, it } from "vitest";
import { operationalClassLabel, periodAppliesToClass, studyClassSection, subjectAppliesToClass } from "./studyScope";
import type { SchedulePeriod, StudyClass, StudySubject } from "./studyTypes";

const baseClass: StudyClass={id:"c",schoolId:"s",schoolYearId:"y",name:"1ère",section:"Secondaire",option:"Commerciale",vacation:"morning"};
const period=(overrides:Partial<SchedulePeriod>={}):SchedulePeriod=>({id:"p",schoolId:"s",schoolYearId:"y",label:"1ère heure",startTime:"07:30",endTime:"08:20",order:1,type:"course",active:true,createdBy:"u",createdAt:"now",updatedAt:"now",vacation:"morning",dayScope:"weekdays",...overrides});
const subject=(overrides:Partial<StudySubject>={}):StudySubject=>({id:"m",schoolId:"s",schoolYearId:"y",name:"Mathématiques",active:true,createdBy:"u",createdAt:"now",updatedAt:"now",...overrides});

describe("périmètre pédagogique section/classe/vacation",()=>{
 it("distingue classe, option et sous-classe",()=>expect(operationalClassLabel({...baseClass,subClassLabel:"A"})).toBe("1ère Commerciale A"));
 it("privilégie la section structurée",()=>expect(studyClassSection({...baseClass,name:"5ème Primaire"})).toBe("Secondaire"));
 it("borne un cours par section et classe",()=>{expect(subjectAppliesToClass(subject({section:"Secondaire",classIds:["c"]}),baseClass)).toBe(true);expect(subjectAppliesToClass(subject({section:"Primaire"}),baseClass)).toBe(false);expect(subjectAppliesToClass(subject({classIds:["other"]}),baseClass)).toBe(false)});
 it("applique les périodes de la bonne vacation du lundi au vendredi",()=>{expect(periodAppliesToClass(period(),baseClass,"monday")).toBe(true);expect(periodAppliesToClass(period({vacation:"afternoon"}),baseClass,"monday")).toBe(false);expect(periodAppliesToClass(period(),baseClass,"saturday")).toBe(false)});
 it("gère le samedi séparément",()=>{const saturday={...baseClass,saturdayEnabled:true,saturdayVacation:"afternoon" as const};expect(periodAppliesToClass(period({vacation:"afternoon",dayScope:"saturday"}),saturday,"saturday")).toBe(true);expect(periodAppliesToClass(period({vacation:"morning",dayScope:"saturday"}),saturday,"saturday")).toBe(false)});
 it("préserve les anciennes classes et périodes sans vacation",()=>expect(periodAppliesToClass(period({vacation:undefined,dayScope:undefined}),{...baseClass,vacation:undefined},"saturday")).toBe(true));
});
