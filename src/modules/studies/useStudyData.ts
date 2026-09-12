import { useEffect, useMemo, useState } from "react";
import type { AppUser, AttendanceSettings, Student } from "../../types";
import { subscribeToStudyData } from "./studyService";
import type { ClassTitular, PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";
import { getStudentSection } from "../../utils/studentClasses";
import { filterByAllowedSections, isSectionAllowed, userSectionIds } from "../../utils/userSections";
import { canonicalOperationalClasses } from "../../services/schoolSubclasses";
import { assignmentsForClasses } from "./studyAssignments";
import { currentTimetableEntries } from "./studyScope";

export function useStudyData(user: AppUser, schoolId: string, schoolYearId: string, refreshToken = 0) {
  const [teachers,setTeachers]=useState<StudyTeacher[]>([]),[subjects,setSubjects]=useState<StudySubject[]>([]),[classes,setClasses]=useState<StudyClass[]>([]),[students,setStudents]=useState<Student[]>([]),[assignments,setAssignments]=useState<PedagogicalAssignment[]>([]),[titulars,setTitulars]=useState<ClassTitular[]>([]),[availabilities,setAvailabilities]=useState<TeacherAvailability[]>([]),[periods,setPeriods]=useState<SchedulePeriod[]>([]),[timetables,setTimetables]=useState<Timetable[]>([]),[timetableEntries,setTimetableEntries]=useState<TimetableEntry[]>([]),[rooms,setRooms]=useState<StudyRoom[]>([]);
  const [attendanceSettings,setAttendanceSettings]=useState<AttendanceSettings>();
  const [error,setError]=useState("");
  const [loadedSources, setLoadedSources] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setLoadedSources(new Set());
    setError("");
    const mark = <T,>(source: string, setter: (items: T[]) => void) => (items: T[]) => {
      setter(items);
      setLoadedSources((current) => current.has(source) ? current : new Set(current).add(source));
    };
    const unsubscribes = subscribeToStudyData({
      user, schoolId, schoolYearId,
      onTeachers: mark("teachers", setTeachers),
      onSubjects: mark("subjects", setSubjects),
      onClasses: mark("classes", setClasses),
      onStudents: mark("students", setStudents),
      onAssignments: mark("assignments", setAssignments),
      onTitulars: mark("titulars", setTitulars),
      onAvailabilities: mark("availabilities", setAvailabilities),
      onPeriods: mark("periods", setPeriods),
      onTimetables: mark("timetables", setTimetables),
      onTimetableEntries: mark("timetableEntries", setTimetableEntries),
      onRooms: mark("rooms", setRooms),
      onAttendanceSettings: (items) => {
        setAttendanceSettings(items[0]);
        setLoadedSources((current) => current.has("attendanceSettings") ? current : new Set(current).add("attendanceSettings"));
      },
      onError: (cause) => setError(cause.message),
    });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [refreshToken, schoolId, schoolYearId, user]);
  const scopedClasses = useMemo(() => canonicalOperationalClasses(classes, students, schoolId, schoolYearId, userSectionIds(user)), [classes, schoolId, schoolYearId, students, user]);
  const scopedClassIds = useMemo(() => new Set(scopedClasses.map((item) => item.id)), [scopedClasses]);
  const scopedStudents = useMemo(() => filterByAllowedSections(user, students, getStudentSection), [students, user]);
  const scopedTeachers = useMemo(() => teachers.filter((item) => (!item.section && !item.sectionIds?.length) || isSectionAllowed(user, item.section) || item.sectionIds?.some((section) => isSectionAllowed(user, section))), [teachers, user]);
  const classScopedAssignments = useMemo(() => assignmentsForClasses(assignments, scopedClassIds), [assignments, scopedClassIds]);
  const assignedSubjectIds = useMemo(() => new Set(classScopedAssignments.map((item) => item.subjectId)), [classScopedAssignments]);
  const scopedSubjects = useMemo(() => subjects.filter((item) => assignedSubjectIds.has(item.id) || ((!item.section || isSectionAllowed(user, item.section)) && (!item.classIds?.length || item.classIds.some((id) => scopedClassIds.has(id))))), [assignedSubjectIds, scopedClassIds, subjects, user]);
  const subjectIds = useMemo(() => new Set(scopedSubjects.map((item) => item.id)), [scopedSubjects]);
  const scopedAssignments = useMemo(() => classScopedAssignments.filter((item) => subjectIds.has(item.subjectId)), [classScopedAssignments, subjectIds]);
  const scopedTitulars = useMemo(() => titulars.filter((item) => scopedClassIds.has(item.classId)), [scopedClassIds, titulars]);
  const activeTimetableEntries = useMemo(() => currentTimetableEntries(timetableEntries), [timetableEntries]);
  const generationReady = ["teachers", "subjects", "classes", "assignments", "availabilities", "periods", "attendanceSettings"].every((source) => loadedSources.has(source));
  const schedulesReady = ["timetables", "timetableEntries"].every((source) => loadedSources.has(source));
  return {teachers:scopedTeachers,subjects:scopedSubjects,classes:scopedClasses,sourceClasses:classes,students:scopedStudents,assignments:scopedAssignments,titulars:scopedTitulars,availabilities,periods,timetables,timetableEntries:activeTimetableEntries,rooms,attendanceSettings,error,generationReady,schedulesReady};
}
