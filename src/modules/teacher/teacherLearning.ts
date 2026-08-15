import type { Student } from "../../types";
import type { PedagogicalAssignment, StudyClass, StudySubject } from "../studies/studyTypes";
import type { GradeEntry } from "./teacherGrading";

export type TeachingProgressStatus = "TODO" | "IN_PROGRESS" | "COMPLETED";
export interface TeachingProgressEntry { id:string; schoolId:string; schoolYearId:string; teacherId:string; assignmentId:string; classId:string; subjectId:string; title:string; chapter?:string; theme?:string; plannedAt?:string; taughtAt?:string; periodsUsed:number; status:TeachingProgressStatus; observation?:string; createdAt:string; createdBy:string; updatedAt:string; updatedBy:string }
export interface TeacherStudentObservation { id:string; schoolId:string; schoolYearId:string; teacherId:string; assignmentId:string; classId:string; subjectId:string; studentId:string; observation:string; createdAt:string; createdBy:string; updatedAt:string; updatedBy:string }
export const pedagogicalDocumentCategories = ["PREPARATION","FORECAST","COURSE_PLAN","QUIZ","HOMEWORK","EXAM","ANSWER_KEY","RESOURCE","OTHER"] as const;
export type PedagogicalDocumentCategory = typeof pedagogicalDocumentCategories[number];
export const pedagogicalDocumentCategoryLabels:Record<PedagogicalDocumentCategory,string>={PREPARATION:"Fiche de préparation",FORECAST:"Prévision de matières",COURSE_PLAN:"Plan de cours",QUIZ:"Interrogation",HOMEWORK:"Devoir",EXAM:"Examen",ANSWER_KEY:"Corrigé",RESOURCE:"Ressource pédagogique",OTHER:"Autre"};
export interface PedagogicalDocument { id:string; schoolId:string; schoolYearId:string; teacherId:string; assignmentId:string; classId:string; subjectId:string; category:PedagogicalDocumentCategory; title:string; description?:string; chapter?:string; fileUrl:string; storagePath:string; originalFileName:string; mimeType:string; size:number; archived:boolean; createdAt:string; createdBy:string; updatedAt:string; updatedBy:string }
export interface TeacherAssignmentView { assignment:PedagogicalAssignment; subject?:StudySubject; schoolClass?:StudyClass }

export function teacherAssignmentViews(assignments:PedagogicalAssignment[],subjects:StudySubject[],classes:StudyClass[]):TeacherAssignmentView[]{return assignments.filter(item=>item.active).map(assignment=>({assignment,subject:subjects.find(item=>item.id===assignment.subjectId),schoolClass:classes.find(item=>item.id===assignment.classId)}));}
export function progressPercent(entries:TeachingProgressEntry[]){if(!entries.length)return 0;return Math.round(entries.filter(item=>item.status==="COMPLETED").length*100/entries.length);}
export function studentsForAssignment(students:Student[],assignment:PedagogicalAssignment){return students.filter(student=>(student.subClassId??student.classId)===assignment.classId&&(student.status??"ACTIVE")==="ACTIVE"&&!student.deletedAt);}
export function gradesForStudent(entries:GradeEntry[],assignment:PedagogicalAssignment,studentId:string){return entries.filter(item=>item.studentId===studentId&&item.classId===assignment.classId&&item.subjectId===assignment.subjectId);}
