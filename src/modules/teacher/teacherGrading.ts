import type { AppUser, Student } from "../../types";
import type { PedagogicalAssignment, StudyClass, StudySubject, StudyTeacher } from "../studies/studyTypes";
import { isSectionAllowed } from "../../utils/userSections";
import type { TeacherGradingData } from "./teacherGradingService";
import { primaryTeacherSections, studyClassSection } from "../studies/teacherAssignmentScope";
import { studentBelongsToAssignment } from "../studies/studyCourseScope";

export const GRADING_SLOTS = ["period_1", "period_2", "semester_1_exam", "semester_1_total", "period_3", "period_4", "semester_2_exam", "semester_2_total", "general_total"] as const;
export type GradingSlot = typeof GRADING_SLOTS[number];
export type EditableGradingSlot = Exclude<GradingSlot, "semester_1_total" | "semester_2_total" | "general_total">;
export const gradingSlotLabels: Record<GradingSlot, string> = { period_1:"1ère Période",period_2:"2ème Période",semester_1_exam:"Examen du 1er Semestre",semester_1_total:"Total 1",period_3:"3ème Période",period_4:"4ème Période",semester_2_exam:"Examen du 2ème Semestre",semester_2_total:"Total 2",general_total:"Total Général" };
export const editableGradingSlots = GRADING_SLOTS.filter((slot): slot is EditableGradingSlot => !slot.endsWith("_total") && slot !== "general_total");

export interface ClassTitular { id:string;schoolId:string;schoolYearId:string;classId:string;teacherId:string;assignmentId:string;active:boolean;updatedAt:string;updatedBy:string }
export interface CourseGradingConfig { id:string;schoolId:string;schoolYearId:string;assignmentId:string|null;teacherId:string;classId:string;subjectId:string;gradingSlot?:EditableGradingSlot;maxScore:number;status:"draft";createdAt:string;createdBy:string;updatedAt:string;updatedBy:string }
export interface GradeEntry { id:string;schoolId:string;schoolYearId:string;assignmentId:string|null;teacherId:string;classId:string;subjectId:string;studentId:string;gradingSlot:EditableGradingSlot;score:number|null;status:"graded"|"not_graded"|"absent";maxScoreSnapshot:number;createdAt:string;createdBy:string;updatedAt:string;updatedBy:string }

export function gradingContextId(input:Pick<CourseGradingConfig,"schoolId"|"schoolYearId"|"classId"|"subjectId">){return [input.schoolId,input.schoolYearId,input.classId,input.subjectId].join("__")}
export function gradingSlotConfigId(input:Pick<CourseGradingConfig,"schoolId"|"schoolYearId"|"classId"|"subjectId">,slot:EditableGradingSlot){return `maxv2__${[input.schoolId,input.schoolYearId,input.classId,input.subjectId,slot].map(part=>`${part.length}:${part}`).join("")}`}
export function applicableGradingConfig(configs:readonly CourseGradingConfig[],classId:string,subjectId:string,slot:EditableGradingSlot,schoolId?:string,schoolYearId?:string){
  const matching=configs.filter(item=>item.classId===classId&&item.subjectId===subjectId&&(!schoolId||item.schoolId===schoolId)&&(!schoolYearId||item.schoolYearId===schoolYearId));
  return matching.find(item=>item.gradingSlot===slot)??matching.find(item=>!item.gradingSlot);
}
export function gradeEntryId(input:Pick<GradeEntry,"schoolId"|"schoolYearId"|"classId"|"subjectId"|"studentId"|"gradingSlot">){return [input.schoolId,input.schoolYearId,input.classId,input.subjectId,input.studentId,input.gradingSlot].join("__")}
export function isPrimaryOrPreschoolSection(value:string|undefined){return primaryTeacherSections.includes(value as "Maternelle"|"Primaire")}
export function isSecondarySection(value:string|undefined){return value==="Secondaire"||value==="CTEB"}
export function getTeacherGradingScope(teacher:StudyTeacher,assignments:PedagogicalAssignment[],classes:StudyClass[],subjects:StudySubject[]){
  if(teacher.status!=="active")return[];
  const own=assignments.filter(item=>item.active&&item.teacherId===teacher.id);
  if(!isPrimaryOrPreschoolSection(teacher.section))return own;
  const classIds=[...new Set(own.map(item=>item.classId))];
  if(classIds.length!==1)return[];
  const schoolClass=classes.find(item=>item.id===classIds[0]);
  if(!schoolClass||!isPrimaryOrPreschoolSection(studyClassSection(schoolClass,classes)))return[];
  return own.filter(item=>subjects.some(subject=>subject.id===item.subjectId&&subject.active));
}
export function activeStudentsForClass(students:Student[],schoolId:string,schoolYearId:string,classId:string,classes:StudyClass[]=[]){return students.filter(student=>student.schoolId===schoolId&&student.schoolYearId===schoolYearId&&studentBelongsToAssignment(student,{classId,schoolId,schoolYearId},classes))}
export function activeStudentsForAssignment(students:Student[],schoolId:string,schoolYearId:string,assignment:PedagogicalAssignment,classes:StudyClass[]=[]){return students.filter(student=>student.schoolId===schoolId&&student.schoolYearId===schoolYearId&&studentBelongsToAssignment(student,assignment,classes))}

export function scopeTeacherGradingData(user: Pick<AppUser, "section" | "sectionIds">, data: TeacherGradingData): TeacherGradingData {
  const classes = data.classes.filter((item) => isSectionAllowed(user, studyClassSection(item, data.classes)));
  const classIds = new Set(classes.map((item) => item.id));
  const assignments = data.assignments.filter((item) => classIds.has(item.classId));
  const subjectIds = new Set(assignments.map((item) => item.subjectId));
  const titulars = data.titulars.filter((item) => item.active === true && item.teacherId === data.teacher.id && item.schoolId === data.teacher.schoolId && item.schoolYearId === data.teacher.schoolYearId && classIds.has(item.classId));
  return {
    ...data,
    classes,
    assignments,
    titulars,
    subjects: data.subjects.filter((item) => subjectIds.has(item.id)),
    students: data.students.filter((item) => item.schoolId === data.teacher.schoolId && item.schoolYearId === data.teacher.schoolYearId && (assignments.some((assignment) => studentBelongsToAssignment(item, assignment, data.classes)) || titulars.some((titular) => studentBelongsToAssignment(item, { classId: titular.classId, schoolId: titular.schoolId, schoolYearId: titular.schoolYearId }, data.classes)))),
    configs: data.configs.filter((item) => classIds.has(item.classId) && subjectIds.has(item.subjectId)),
    entries: data.entries.filter((item) => classIds.has(item.classId) && subjectIds.has(item.subjectId)),
  };
}
export function validateScore(score:number|null,status:GradeEntry["status"],maxScore:number){if(status!=="graded")return"";if(score===null)return"Une cote est requise.";if(!Number.isFinite(score)||score<0)return"La cote doit être positive ou nulle.";if(score>maxScore)return`La cote ne peut pas dépasser ${maxScore}.`;return""}
export function validateMaxScore(next:number,entries:GradeEntry[]){if(!Number.isFinite(next)||next<=0)return"La cote maximale doit être supérieure à zéro.";const highest=Math.max(0,...entries.filter(item=>item.status==="graded"&&item.score!==null).map(item=>item.score!));return next<highest?`La cote maximale ne peut pas être abaissée à ${next} car certaines cotes existantes dépassent cette valeur.`:""}
export function gradingProgress(entries:GradeEntry[],studentIds:string[]){const graded=new Set(entries.filter(item=>studentIds.includes(item.studentId)&&item.status!=="not_graded").map(item=>item.studentId)).size;return{graded,total:studentIds.length,status:graded===studentIds.length&&studentIds.length>0?"Complet":"En cours" as "Complet"|"En cours"}}
export const gradeCalculationService={calculateSemester1Total:()=>null,calculateSemester2Total:()=>null,calculateGeneralTotal:()=>null};
export function maxScoreActionLabel(hasPersistedConfig:boolean){return hasPersistedConfig?"Modifier la côte":"Enregistrer maximum"}
export function maxScoreConfirmation(hasPersistedConfig:boolean){return hasPersistedConfig?"MODIFIER LA CÔTE MAXIMALE":"ENREGISTRER LA CÔTE MAXIMALE"}
export function reconcileGradeDrafts(students:Student[],entries:GradeEntry[],previous:Record<string,{score:string;status:GradeEntry["status"]}>,reset:boolean){
  return Object.fromEntries(students.map(student=>{
    const entry=entries.find(item=>item.studentId===student.id);
    return [student.id,!reset&&previous[student.id]?previous[student.id]:{score:entry?.score==null?"":String(entry.score),status:entry?.status??"not_graded"}];
  }));
}

export function hasUnsavedGradeDrafts(students:Student[],entries:GradeEntry[],drafts:Record<string,{score:string;status:GradeEntry["status"]}>){
  const saved=new Map(entries.map(entry=>[entry.studentId,entry]));
  return students.some(student=>{
    const draft=drafts[student.id];
    if(!draft)return false;
    const entry=saved.get(student.id);
    return draft.score!==(entry?.score==null?"":String(entry.score))||draft.status!==(entry?.status??"not_graded");
  });
}

export function changedGradeEntries(students:Student[], entries:GradeEntry[], drafts:Record<string,{score:string;status:GradeEntry["status"]}>, slot:EditableGradingSlot){
  const saved = new Map(entries.map((entry) => [entry.studentId, entry]));
  let modifiesPersisted = false;
  const changes = students.flatMap((student) => {
    const draft = drafts[student.id] ?? { score:"", status:"not_graded" as const };
    const status:GradeEntry["status"] = draft.status === "absent" ? "absent" : draft.score === "" ? "not_graded" : "graded";
    const score = status === "graded" ? Number(draft.score) : null;
    const previous = saved.get(student.id);
    if (!previous && status === "not_graded") return [];
    if (previous && previous.status === status && previous.score === score) return [];
    if (previous) modifiesPersisted = true;
    return [{ studentId:student.id, gradingSlot:slot, score, status }];
  });
  return { changes, modifiesPersisted };
}
