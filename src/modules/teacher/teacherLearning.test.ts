import { describe, expect, it } from "vitest";
import type { Student } from "../../types";
import type { PedagogicalAssignment } from "../studies/studyTypes";
import { gradesForStudent, pedagogicalDocumentCategories, progressPercent, studentsForAssignment, teacherAssignmentViews } from "./teacherLearning";

const assignment={id:"a",schoolId:"s",schoolYearId:"y",teacherId:"t",subjectId:"m",classId:"c",weeklyPeriods:2,active:true} as PedagogicalAssignment;
describe("outils pédagogiques Enseignant",()=>{
  it("dérive les vues depuis les affectations canoniques",()=>expect(teacherAssignmentViews([assignment],[{id:"m",name:"Math"} as never],[{id:"c",name:"4e A"} as never])[0]).toMatchObject({subject:{name:"Math"},schoolClass:{name:"4e A"}}));
  it("calcule la progression depuis les entrées réelles",()=>expect(progressPercent([{status:"COMPLETED"},{status:"IN_PROGRESS"}] as never)).toBe(50));
  it("limite les élèves à la classe active affectée",()=>expect(studentsForAssignment([{id:"1",classId:"c",status:"ACTIVE"},{id:"2",classId:"x",status:"ACTIVE"},{id:"3",classId:"c",status:"TRANSFERRED"}] as Student[],assignment).map(item=>item.id)).toEqual(["1"]));
  it("limite les cotes à l'élève, la classe et la matière",()=>expect(gradesForStudent([{id:"g",studentId:"1",classId:"c",subjectId:"m"},{id:"x",studentId:"2",classId:"c",subjectId:"m"}] as never,assignment,"1").map(item=>item.id)).toEqual(["g"]));
  it("centralise les neuf catégories documentaires",()=>expect(pedagogicalDocumentCategories).toHaveLength(9));
});
