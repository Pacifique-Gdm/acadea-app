import type { Student } from "../../types";
import type { PedagogicalAssignment, StudyClass, StudySubject, StudyTeacher } from "../studies/studyTypes";
import { primaryTeacherSections, studyClassSection } from "../studies/teacherAssignmentScope";

export const GRADING_SLOTS = ["period_1", "period_2", "semester_1_exam", "semester_1_total", "period_3", "period_4", "semester_2_exam", "semester_2_total", "general_total"] as const;
export type GradingSlot = typeof GRADING_SLOTS[number];
export type EditableGradingSlot = Exclude<GradingSlot, "semester_1_total" | "semester_2_total" | "general_total">;
export const gradingSlotLabels: Record<GradingSlot, string> = { period_1:"1ère Période",period_2:"2ème Période",semester_1_exam:"Examen du 1er Semestre",semester_1_total:"Total 1",period_3:"3ème Période",period_4:"4ème Période",semester_2_exam:"Examen du 2ème Semestre",semester_2_total:"Total 2",general_total:"Total Général" };
export const editableGradingSlots = GRADING_SLOTS.filter((slot): slot is EditableGradingSlot => !slot.endsWith("_total") && slot !== "general_total");

export interface ClassTitular { id:string;schoolId:string;schoolYearId:string;classId:string;teacherId:string;assignmentId:string;active:boolean;updatedAt:string;updatedBy:string }
export interface CourseGradingConfig { id:string;schoolId:string;schoolYearId:string;assignmentId:string|null;teacherId:string;classId:string;subjectId:string;maxScore:number;status:"draft";createdAt:string;createdBy:string;updatedAt:string;updatedBy:string }
export interface GradeEntry { id:string;schoolId:string;schoolYearId:string;assignmentId:string|null;teacherId:string;classId:string;subjectId:string;studentId:string;gradingSlot:EditableGradingSlot;score:number|null;status:"graded"|"not_graded"|"absent";maxScoreSnapshot:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string }

export function gradingContextId(input:Pick<CourseGradingConfig,"schoolId"|"schoolYearId"|"classId"|"subjectId">){return [input.schoolId,input.schoolYearId,input.classId,input.subjectId].join("__")}
export function gradeEntryId(input:Pick<GradeEntry,"schoolId"|"schoolYearId"|"classId"|"subjectId"|"studentId"|"gradingSlot">){return [input.schoolId,input.schoolYearId,input.classId,input.subjectId,input.studentId,input.gradingSlot].join("__")}
export function isPrimaryOrPreschoolSection(value:string|undefined){return primaryTeacherSections.includes(value as "maternelle"|"primaire")}
export function isSecondarySection(value:string|undefined){return value==="secondaire"||value==="cteb"}
export function getTeacherGradingScope(teacher:StudyTeacher,assignments:PedagogicalAssignment[],classes:StudyClass[],subjects:StudySubject[]){
  if(teacher.status!=="active")return[];
  const own=assignments.filter(item=>item.active&&item.teacherId===teacher.id);
  if(!isPrimaryOrPreschoolSection(teacher.section))return own;
  const classIds=[...new Set(own.map(item=>item.classId))];
  if(classIds.length!==1)return[];
  const schoolClass=classes.find(item=>item.id===classIds[0]);
  if(!schoolClass||!isPrimaryOrPreschoolSection(studyClassSection(schoolClass)))return[];
  return own.filter(item=>subjects.some(subject=>subject.id===item.subjectId&&subject.active));
}
export function activeStudentsForClass(students:Student[],schoolId:string,schoolYearId:string,classId:string){return students.filter(student=>student.schoolId===schoolId&&student.schoolYearId===schoolYearId&&(student.subClassId??student.classId)===classId&&(student.status??"ACTIVE")==="ACTIVE"&&!student.deletedAt)}
export function validateScore(score:number|null,status:GradeEntry["status"],maxScore:number){if(status!=="graded")return"";if(score===null)return"Une cote est requise.";if(!Number.isFinite(score)||score<0)return"La cote doit être positive ou nulle.";if(score>maxScore)return`La cote ne peut pas dépasser ${maxScore}.`;return""}
export function validateMaxScore(next:number,entries:GradeEntry[]){if(!Number.isFinite(next)||next<=0)return"La cote maximale doit être supérieure à zéro.";const highest=Math.max(0,...entries.filter(item=>item.status==="graded"&&item.score!==null).map(item=>item.score!));return next<highest?`La cote maximale ne peut pas être abaissée à ${next} car certaines cotes existantes dépassent cette valeur.`:""}
export function gradingProgress(entries:GradeEntry[],studentIds:string[]){const graded=new Set(entries.filter(item=>studentIds.includes(item.studentId)&&item.status!=="not_graded").map(item=>item.studentId)).size;return{graded,total:studentIds.length,status:graded===studentIds.length&&studentIds.length>0?"Complet":"En cours" as "Complet"|"En cours"}}
export const gradeCalculationService={calculateSemester1Total:()=>null,calculateSemester2Total:()=>null,calculateGeneralTotal:()=>null};
