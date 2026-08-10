import { useEffect, useState } from "react";
import type { AppUser, Student } from "../../types";
import { subscribeToStudyData } from "./studyService";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, TeacherAvailability, Timetable, TimetableEntry } from "./studyTypes";

export function useStudyData(user: AppUser, schoolId: string, schoolYearId: string) {
  const [teachers, setTeachers] = useState<StudyTeacher[]>([]);
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [classes, setClasses] = useState<StudyClass[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [assignments, setAssignments] = useState<PedagogicalAssignment[]>([]);
  const [availabilities, setAvailabilities] = useState<TeacherAvailability[]>([]);
  const [periods, setPeriods] = useState<SchedulePeriod[]>([]);
  const [timetables, setTimetables] = useState<Timetable[]>([]);
  const [timetableEntries, setTimetableEntries] = useState<TimetableEntry[]>([]);
  const [rooms, setRooms] = useState<StudyRoom[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const unsubscribes = subscribeToStudyData({ user, schoolId, schoolYearId, onTeachers: setTeachers, onSubjects: setSubjects, onClasses: setClasses, onStudents:setStudents,onAssignments: setAssignments, onAvailabilities:setAvailabilities,onPeriods:setPeriods,onTimetables:setTimetables,onTimetableEntries:setTimetableEntries,onRooms:setRooms, onError: (cause) => setError(cause.message) });
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [schoolId, schoolYearId, user]);
  return { teachers, subjects, classes, students, assignments, availabilities, periods, timetables, timetableEntries, rooms, error };
}
