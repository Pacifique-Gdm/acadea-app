import { collection, onSnapshot, query, where } from "@firebase/firestore";
import type { Firestore, Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser } from "../../types";
import type { Timetable, TimetableEntry } from "./studyTypes";

export type PublishedTimetableSnapshot = { timetable: Timetable; entries: TimetableEntry[] } | null;

const publishedReaderRoles = new Set<AppUser["role"]>(["school_admin", "secretary", "discipline_director"]);

export function canReadPublishedTimetable(user: AppUser) {
  return publishedReaderRoles.has(user.role) && user.status !== "inactive" && Boolean(user.schoolId);
}

export function subscribeToActivePublishedTimetable(input: {
  user: AppUser;
  schoolId: string;
  schoolYearId: string;
  onData: (value: PublishedTimetableSnapshot) => void;
  onError: (error: Error) => void;
}): Unsubscribe {
  if (!db || !canReadPublishedTimetable(input.user) || input.user.schoolId !== input.schoolId || !input.schoolId || !input.schoolYearId) {
    throw new Error("Consultation de l’horaire publié non autorisée.");
  }

  const database = db as unknown as Firestore;
  let entriesUnsubscribe: Unsubscribe | undefined;
  let currentTimetableId = "";
  const timetablesQuery = query(
    collection(database, "timetables"),
    where("schoolId", "==", input.schoolId),
    where("schoolYearId", "==", input.schoolYearId),
    where("status", "==", "PUBLISHED"),
    where("activePublished", "==", true),
  );

  const timetableUnsubscribe = onSnapshot(timetablesQuery, (snapshot) => {
    const timetableDocument = snapshot.docs[0];
    if (!timetableDocument) {
      currentTimetableId = "";
      entriesUnsubscribe?.();
      entriesUnsubscribe = undefined;
      input.onData(null);
      return;
    }

    const timetable = { id: timetableDocument.id, ...timetableDocument.data() } as Timetable;
    if (currentTimetableId === timetable.id) return;
    currentTimetableId = timetable.id;
    entriesUnsubscribe?.();
    entriesUnsubscribe = onSnapshot(
      query(
        collection(database, "timetableEntries"),
        where("schoolId", "==", input.schoolId),
        where("schoolYearId", "==", input.schoolYearId),
        where("scheduleId", "==", timetable.id),
      ),
      (entriesSnapshot) => input.onData({
        timetable,
        entries: entriesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as TimetableEntry),
      }),
      input.onError,
    );
  }, input.onError);

  return () => {
    entriesUnsubscribe?.();
    timetableUnsubscribe();
  };
}
