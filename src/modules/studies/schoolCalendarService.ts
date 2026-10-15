import { collection, doc, onSnapshot, runTransaction, Timestamp, type Firestore, type Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser, SchoolYear } from "../../types";
import { validateCalendarEvent, type SchoolCalendar, type SchoolCalendarEvent } from "./schoolCalendar";

function calendarRef(yearId: string) {
  if (!db) throw new Error("Firestore indisponible.");
  return doc(db as unknown as Firestore, "schoolCalendars", yearId);
}

function calendarEventsRef(yearId: string) {
  if (!db) throw new Error("Firestore indisponible.");
  return collection(db as unknown as Firestore, "schoolCalendars", yearId, "events");
}

function dateTimestamp(day: string): Timestamp {
  return Timestamp.fromDate(new Date(`${day}T00:00:00Z`));
}

function eventDocument(event: SchoolCalendarEvent, schoolId: string, schoolYearId: string) {
  if (event.origin === "official-proposal" && (!event.sourceUrl || !event.educationLevel)) {
    throw new Error("Provenance officielle incomplète.");
  }
  return {
    id: event.id, schoolId, schoolYearId, title: event.title, kind: event.kind,
    startsAt: dateTimestamp(event.startsAt), endsAt: dateTimestamp(event.endsAt), origin: event.origin,
    ...(event.suspendsCourses !== undefined ? { suspendsCourses: event.suspendsCourses } : {}),
    ...(event.startTime !== undefined ? { startTime: event.startTime, endTime: event.endTime } : {}),
    ...(event.origin === "official-proposal" ? {
      sourceUrl: event.sourceUrl, educationLevel: event.educationLevel,
      ...(event.publishedAt ? { publishedAt: dateTimestamp(event.publishedAt) } : {}),
    } : {}),
  };
}

function eventDay(value: unknown): string {
  if (!(value instanceof Timestamp)) throw new Error("Date du calendrier invalide.");
  return value.toDate().toISOString().slice(0, 10);
}

function readEvent(data: Record<string, unknown>, id: string): SchoolCalendarEvent {
  if (data.id !== id || typeof data.title !== "string" || typeof data.kind !== "string" || typeof data.origin !== "string") {
    throw new Error("Événement du calendrier invalide.");
  }
  return {
    id, title: data.title, kind: data.kind as SchoolCalendarEvent["kind"],
    startsAt: eventDay(data.startsAt), endsAt: eventDay(data.endsAt),
    origin: data.origin as SchoolCalendarEvent["origin"],
    ...(typeof data.suspendsCourses === "boolean" ? { suspendsCourses: data.suspendsCourses } : {}),
    ...(typeof data.startTime === "string" && typeof data.endTime === "string" ? { startTime: data.startTime, endTime: data.endTime } : {}),
    ...(typeof data.sourceUrl === "string" ? { sourceUrl: data.sourceUrl } : {}),
    ...(data.publishedAt instanceof Timestamp ? { publishedAt: eventDay(data.publishedAt) } : {}),
    ...(typeof data.educationLevel === "string" ? { educationLevel: data.educationLevel } : {}),
  };
}

export function subscribeSchoolCalendar(input: { user: AppUser; schoolId: string; schoolYearId: string; onData: (calendar?: SchoolCalendar) => void; onError: (error: Error) => void }): Unsubscribe {
  if (!input.schoolYearId || input.user.schoolId !== input.schoolId || !["teacher", "study_director"].includes(input.user.role) || input.user.active === false || input.user.status === "inactive") throw new Error("Accès au calendrier non autorisé.");
  let metadata: Record<string, unknown> | undefined;
  let metadataLoaded = false;
  let documents: SchoolCalendarEvent[] = [];
  let eventsLoaded = false;
  const emit = () => {
    if (!metadataLoaded || !eventsLoaded) return;
    if (!metadata) { input.onData(undefined); return; }
    if (metadata.schoolId !== input.schoolId || metadata.schoolYearId !== input.schoolYearId) { input.onError(new Error("Calendrier hors périmètre.")); return; }
    const legacy = Array.isArray(metadata.events) ? metadata.events as SchoolCalendarEvent[] : [];
    input.onData({ ...metadata, events: Array.isArray(metadata.events) ? legacy : documents } as SchoolCalendar);
  };
  const unsubscribeMetadata = onSnapshot(calendarRef(input.schoolYearId), (snapshot) => {
    metadata = snapshot.exists() ? snapshot.data() : undefined;
    metadataLoaded = true;
    emit();
  }, input.onError);
  const unsubscribeEvents = onSnapshot(calendarEventsRef(input.schoolYearId), (snapshot) => {
    try {
      documents = snapshot.docs.map((event) => readEvent(event.data(), event.id)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      eventsLoaded = true;
      emit();
    } catch (error) { input.onError(error instanceof Error ? error : new Error("Calendrier invalide.")); }
  }, input.onError);
  return () => { unsubscribeMetadata(); unsubscribeEvents(); };
}

export async function saveSchoolCalendar(input: { user: AppUser; schoolId: string; year: SchoolYear; expectedUpdatedAt?: string; previousEventIds: string[]; events: SchoolCalendarEvent[]; status: "draft" | "validated" }) {
  if (input.user.role !== "study_director" || input.user.schoolId !== input.schoolId || input.year.schoolId !== input.schoolId || input.user.active === false || input.user.status === "inactive") throw new Error("Modification du calendrier non autorisée.");
  if (input.events.length > 100 || new Set(input.events.map((event) => event.id)).size !== input.events.length) throw new Error("Événements du calendrier invalides.");
  for (const event of input.events) {
    const error = validateCalendarEvent(event, input.year, input.events);
    if (error) throw new Error(error);
  }
  if (!db) throw new Error("Firestore indisponible.");
  const reference = calendarRef(input.year.id);
  await runTransaction(db as unknown as Firestore, async (transaction) => {
    const current = await transaction.get(reference);
    if ((current.exists() ? current.data().updatedAt : undefined) !== input.expectedUpdatedAt) throw new Error("Le calendrier a changé dans une autre session. Rechargez-le avant de réessayer.");
    if (current.exists() && (current.data().schoolId !== input.schoolId || current.data().schoolYearId !== input.year.id)) throw new Error("Calendrier hors périmètre.");
    const nextIds = new Set(input.events.map((event) => event.id));
    const removed = await Promise.all(input.previousEventIds.filter((id) => !nextIds.has(id)).map(async (id) => {
      const reference = doc(calendarEventsRef(input.year.id), id);
      return { reference, snapshot: await transaction.get(reference) };
    }));
    const now = new Date().toISOString();
    const updatedAt = now === input.expectedUpdatedAt ? new Date(Date.now() + 1).toISOString() : now;
    transaction.set(reference, { schoolId: input.schoolId, schoolYearId: input.year.id, status: input.status, updatedAt, updatedBy: input.user.id });
    for (const { reference: eventReference, snapshot } of removed) {
      if (snapshot.exists()) transaction.delete(eventReference);
    }
    for (const event of input.events) {
      transaction.set(doc(calendarEventsRef(input.year.id), event.id), eventDocument(event, input.schoolId, input.year.id));
    }
  });
}
