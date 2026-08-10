import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore, Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, StudyRoom, StudySubject, StudyTeacher, Timetable, TimetableEntry } from "../studies/studyTypes";

type Callbacks = {
  onTeacher: (value?: StudyTeacher) => void;
  onTimetable: (value?: Timetable) => void;
  onAssignments: (value: PedagogicalAssignment[]) => void;
  onSubjects: (value: StudySubject[]) => void;
  onClasses: (value: StudyClass[]) => void;
  onRooms: (value: StudyRoom[]) => void;
  onPeriods: (value: SchedulePeriod[]) => void;
  onEntries: (value: TimetableEntry[]) => void;
  onReady: () => void;
  onError: (error: Error) => void;
};

export function subscribeToTeacherPortalData(input: { user: AppUser; schoolId: string; schoolYearId: string } & Callbacks): Unsubscribe {
  if (!db || input.user.role !== "teacher" || input.user.status === "inactive" || input.user.active === false || input.user.schoolId !== input.schoolId || !input.schoolYearId) throw new Error("Accès Enseignant non autorisé.");
  const database = db as unknown as Firestore;
  const unsubscribes: Unsubscribe[] = [];
  let teacherId = "";
  let scopedUnsubscribes: Unsubscribe[] = [];
  let entriesUnsubscribe: Unsubscribe | undefined;
  let scheduleId = "";
  const scopedQuery = (name: string) => query(collection(database, name), where("schoolId", "==", input.schoolId), where("schoolYearId", "==", input.schoolYearId));
  const docs = <T,>(snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Record<string, unknown>) }) as T);

  const teacherUnsubscribe = onSnapshot(query(collection(database, "teachers"), where("schoolId", "==", input.schoolId), where("schoolYearId", "==", input.schoolYearId), where("userId", "==", input.user.id)), (snapshot) => {
    const matches = docs<StudyTeacher>(snapshot);
    if (matches.length !== 1) {
      input.onTeacher(undefined); input.onError(new Error(matches.length === 0 ? "Aucun profil pédagogique n’est lié à ce compte Enseignant." : "Plusieurs profils pédagogiques sont liés à ce compte.")); input.onReady(); return;
    }
    const teacher = matches[0];
    input.onTeacher(teacher);
    if (teacherId === teacher.id) return;
    teacherId = teacher.id;
    scopedUnsubscribes.forEach((unsubscribe) => unsubscribe());
    scopedUnsubscribes = [
      onSnapshot(query(scopedQuery("pedagogicalAssignments"), where("teacherId", "==", teacher.id), where("active", "==", true)), (value) => input.onAssignments(docs(value)), input.onError),
      onSnapshot(scopedQuery("subjects"), (value) => input.onSubjects(docs(value)), input.onError),
      onSnapshot(scopedQuery("classes"), (value) => input.onClasses(docs(value)), input.onError),
      onSnapshot(scopedQuery("rooms"), (value) => input.onRooms(docs(value)), input.onError),
      onSnapshot(scopedQuery("schedulePeriods"), (value) => input.onPeriods(docs(value)), input.onError),
      onSnapshot(query(scopedQuery("timetables"), where("status", "==", "PUBLISHED"), where("activePublished", "==", true)), (value) => {
        const timetable = docs<Timetable>(value)[0];
        input.onTimetable(timetable);
        if (!timetable) { scheduleId = ""; entriesUnsubscribe?.(); entriesUnsubscribe = undefined; input.onEntries([]); input.onReady(); return; }
        if (scheduleId === timetable.id) return;
        scheduleId = timetable.id;
        entriesUnsubscribe?.();
        entriesUnsubscribe = onSnapshot(query(scopedQuery("timetableEntries"), where("scheduleId", "==", timetable.id), where("teacherId", "==", teacher.id)), (entries) => { input.onEntries(docs(entries)); input.onReady(); }, input.onError);
      }, input.onError),
    ];
  }, input.onError);
  unsubscribes.push(teacherUnsubscribe);
  return () => { unsubscribes.forEach((unsubscribe) => unsubscribe()); scopedUnsubscribes.forEach((unsubscribe) => unsubscribe()); entriesUnsubscribe?.(); };
}
