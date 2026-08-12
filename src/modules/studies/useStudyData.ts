import { useEffect, useState } from "react";
import type { AppUser, AttendanceSettings, Student } from "../../types";
import { subscribeToStudyData } from "./studyService";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";

export function useStudyData(user: AppUser, schoolId: string, schoolYearId: string) {
  const [teachers,setTeachers]=useState<StudyTeacher[]>([]),[subjects,setSubjects]=useState<StudySubject[]>([]),[classes,setClasses]=useState<StudyClass[]>([]),[students,setStudents]=useState<Student[]>([]),[assignments,setAssignments]=useState<PedagogicalAssignment[]>([]),[availabilities,setAvailabilities]=useState<TeacherAvailability[]>([]),[periods,setPeriods]=useState<SchedulePeriod[]>([]),[timetables,setTimetables]=useState<Timetable[]>([]),[timetableEntries,setTimetableEntries]=useState<TimetableEntry[]>([]),[rooms,setRooms]=useState<StudyRoom[]>([]);
  const [attendanceSettings,setAttendanceSettings]=useState<AttendanceSettings>();
  const [error,setError]=useState("");
  useEffect(()=>{const unsubscribes=subscribeToStudyData({user,schoolId,schoolYearId,onTeachers:setTeachers,onSubjects:setSubjects,onClasses:setClasses,onStudents:setStudents,onAssignments:setAssignments,onAvailabilities:setAvailabilities,onPeriods:setPeriods,onTimetables:setTimetables,onTimetableEntries:setTimetableEntries,onRooms:setRooms,onAttendanceSettings:(items)=>setAttendanceSettings(items[0]),onError:(cause)=>setError(cause.message)});return()=>unsubscribes.forEach(unsubscribe=>unsubscribe());},[schoolId,schoolYearId,user]);
  return {teachers,subjects,classes,students,assignments,availabilities,periods,timetables,timetableEntries,rooms,attendanceSettings,error};
}
