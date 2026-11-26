import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore, Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import { currentTimetableEntries } from "../studies/studyScope";
import { composePublishedEntries, timetableSection } from "../studies/sectionTimetable";
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
  // Lot R5 : horaire publié de toute l'école + au plus un horaire publié par section.
  const entriesUnsubscribes = new Map<string, Unsubscribe>();
  const entriesBySchedule = new Map<string, TimetableEntry[]>();
  let published: Timetable[] = [];
  let latestClasses: StudyClass[] = [];
  const stopEntries = (id?: string) => {
    [...entriesUnsubscribes.keys()].filter((key) => !id || key === id).forEach((key) => { entriesUnsubscribes.get(key)?.(); entriesUnsubscribes.delete(key); entriesBySchedule.delete(key); });
  };
  const emitEntries = () => {
    if (!published.length || !published.every((item) => entriesBySchedule.has(item.id))) return;
    // Sans horaire de section : exactement les créneaux de l'horaire de l'école.
    input.onEntries(composePublishedEntries({ published, entries: published.flatMap((item) => entriesBySchedule.get(item.id) ?? []), classes: latestClasses }));
    input.onReady();
  };
  const scopedQuery = (name: string) => query(collection(database, name), where("schoolId", "==", input.schoolId), where("schoolYearId", "==", input.schoolYearId));
  const docs = <T,>(snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Record<string, unknown>) }) as T);

  const teacherUnsubscribe = onSnapshot(query(collection(database, "teachers"), where("schoolId", "==", input.schoolId), where("schoolYearId", "==", input.schoolYearId), where("userId", "==", input.user.id)), (snapshot) => {
    const matches = docs<StudyTeacher>(snapshot).filter((item) => item.status !== "inactive" && (item as StudyTeacher & { active?: boolean }).active !== false);
    if (matches.length !== 1) {
      input.onTeacher(undefined); input.onError(new Error(matches.length === 0 ? "Aucun profil pédagogique n’est lié à ce compte Enseignant." : "Plusieurs profils pédagogiques sont liés à ce compte.")); input.onReady(); return;
    }
    const teacher = matches[0];
    input.onTeacher(teacher);
    if (teacherId === teacher.id) return;
    teacherId = teacher.id;
    scopedUnsubscribes.forEach((unsubscribe) => unsubscribe());
    stopEntries(); published = [];
    scopedUnsubscribes = [
      onSnapshot(query(scopedQuery("pedagogicalAssignments"), where("teacherId", "==", teacher.id), where("active", "==", true)), (value) => input.onAssignments(docs(value)), input.onError),
      onSnapshot(scopedQuery("subjects"), (value) => input.onSubjects(docs(value)), input.onError),
      onSnapshot(scopedQuery("classes"), (value) => { latestClasses = docs(value); input.onClasses(latestClasses); if (published.some((item) => timetableSection(item))) emitEntries(); }, input.onError),
      onSnapshot(scopedQuery("rooms"), (value) => input.onRooms(docs(value)), input.onError),
      onSnapshot(scopedQuery("schedulePeriods"), (value) => input.onPeriods(docs(value)), input.onError),
      onSnapshot(query(scopedQuery("timetables"), where("status", "==", "PUBLISHED"), where("activePublished", "==", true)), (value) => {
        const items = docs<Timetable>(value);
        const scopes = items.map((item) => timetableSection(item) ?? "");
        if (new Set(scopes).size !== scopes.length) {
          published = []; stopEntries();
          input.onTimetable(undefined); input.onEntries([]); input.onReady();
          input.onError(new Error("Plusieurs horaires actifs ont été détectés. Contactez la Direction des études."));
          return;
        }
        published = items;
        const timetable = items.find((item) => !timetableSection(item)) ?? items[0];
        input.onTimetable(timetable);
        if (!timetable) { stopEntries(); input.onEntries([]); input.onReady(); return; }
        [...entriesUnsubscribes.keys()].filter((id) => !items.some((item) => item.id === id)).forEach((id) => stopEntries(id));
        items.filter((item) => !entriesUnsubscribes.has(item.id)).forEach((item) => {
          entriesUnsubscribes.set(item.id, onSnapshot(query(scopedQuery("timetableEntries"), where("scheduleId", "==", item.id), where("teacherId", "==", teacher.id)), (entries) => { entriesBySchedule.set(item.id, currentTimetableEntries(docs(entries))); emitEntries(); }, input.onError));
        });
        emitEntries();
      }, input.onError),
    ];
  }, input.onError);
  unsubscribes.push(teacherUnsubscribe);
  return () => { unsubscribes.forEach((unsubscribe) => unsubscribe()); scopedUnsubscribes.forEach((unsubscribe) => unsubscribe()); stopEntries(); };
}
