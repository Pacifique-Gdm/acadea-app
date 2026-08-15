import { useEffect, useMemo, useState } from "react";
import type { AppUser, AttendanceSettings, Student } from "../../types";
import { subscribeToStudyData } from "./studyService";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";
import { getStudentSection } from "../../utils/studentClasses";
import { filterByAllowedSections, isSectionAllowed, userSectionIds } from "../../utils/userSections";
import { canonicalOperationalClasses } from "../../services/schoolSubclasses";
import { assignmentsForClasses } from "./studyAssignments";

export function useStudyData(user: AppUser, schoolId: string, schoolYearId: string) {
  const [teachers,setTeachers]=useState<StudyTeacher[]>([]),[subjects,setSubjects]=useState<StudySubject[]>([]),[classes,setClasses]=useState<StudyClass[]>([]),[students,setStudents]=useState<Student[]>([]),[assignments,setAssignments]=useState<PedagogicalAssignment[]>([]),[availabilities,setAvailabilities]=useState<TeacherAvailability[]>([]),[periods,setPeriods]=useState<SchedulePeriod[]>([]),[timetables,setTimetables]=useState<Timetable[]>([]),[timetableEntries,setTimetableEntries]=useState<TimetableEntry[]>([]),[rooms,setRooms]=useState<StudyRoom[]>([]);
  const [attendanceSettings,setAttendanceSettings]=useState<AttendanceSettings>();
  const [error,setError]=useState("");
  useEffect(()=>{const unsubscribes=subscribeToStudyData({user,schoolId,schoolYearId,onTeachers:setTeachers,onSubjects:setSubjects,onClasses:setClasses,onStudents:setStudents,onAssignments:setAssignments,onAvailabilities:setAvailabilities,onPeriods:setPeriods,onTimetables:setTimetables,onTimetableEntries:setTimetableEntries,onRooms:setRooms,onAttendanceSettings:(items)=>setAttendanceSettings(items[0]),onError:(cause)=>setError(cause.message)});return()=>unsubscribes.forEach(unsubscribe=>unsubscribe());},[schoolId,schoolYearId,user]);
  const scopedClasses = useMemo(() => canonicalOperationalClasses(classes, students, schoolId, schoolYearId, userSectionIds(user)), [classes, schoolId, schoolYearId, students, user]);
  const scopedClassIds = useMemo(() => new Set(scopedClasses.map((item) => item.id)), [scopedClasses]);
  const scopedStudents = useMemo(() => filterByAllowedSections(user, students, getStudentSection), [students, user]);
  const scopedTeachers = useMemo(() => teachers.filter((item) => (!item.section && !item.sectionIds?.length) || isSectionAllowed(user, item.section) || item.sectionIds?.some((section) => isSectionAllowed(user, section))), [teachers, user]);
  const classScopedAssignments = useMemo(() => assignmentsForClasses(assignments, scopedClassIds), [assignments, scopedClassIds]);
  const assignedSubjectIds = useMemo(() => new Set(classScopedAssignments.map((item) => item.subjectId)), [classScopedAssignments]);
  const scopedSubjects = useMemo(() => subjects.filter((item) => assignedSubjectIds.has(item.id) || ((!item.section || isSectionAllowed(user, item.section)) && (!item.classIds?.length || item.classIds.some((id) => scopedClassIds.has(id))))), [assignedSubjectIds, scopedClassIds, subjects, user]);
  const subjectIds = useMemo(() => new Set(scopedSubjects.map((item) => item.id)), [scopedSubjects]);
  const scopedAssignments = useMemo(() => classScopedAssignments.filter((item) => subjectIds.has(item.subjectId)), [classScopedAssignments, subjectIds]);
  return {teachers:scopedTeachers,subjects:scopedSubjects,classes:scopedClasses,sourceClasses:classes,students:scopedStudents,assignments:scopedAssignments,availabilities,periods,timetables,timetableEntries,rooms,attendanceSettings,error};
}
