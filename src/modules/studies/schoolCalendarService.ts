import { collection, doc, onSnapshot, runTransaction, Timestamp, type Firestore, type Unsubscribe } from "@firebase/firestore";
import { db } from "../../firebase";
import type { AppUser, SchoolSection, SchoolYear } from "../../types";
import { canManageSections, type SectionAuthority } from "../../utils/sectionAuthority";
import { userSectionIds } from "../../utils/userSections";
import { calendarEventSections, validateCalendarEvent, type CalendarPdfSource, type SchoolCalendar, type SchoolCalendarEvent } from "./schoolCalendar";

function calendarRef(yearId: string) {
  if (!db) throw new Error("Service indisponible. Veuillez réessayer.");
  return doc(db as unknown as Firestore, "schoolCalendars", yearId);
}

function calendarEventsRef(yearId: string) {
  if (!db) throw new Error("Service indisponible. Veuillez réessayer.");
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
    ...(event.origin === "pdf-import" ? { sourcePdfPath: event.sourcePdfPath, sourcePage: event.sourcePage, educationLevel: event.educationLevel } : {}),
    // Lot R4 : écrit seulement si l'événement vise des sections (sinon toute l'école, comme avant).
    ...(calendarEventSections(event).length ? { sectionIds: calendarEventSections(event) } : {}),
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
    ...(typeof data.sourcePdfPath === "string" ? { sourcePdfPath: data.sourcePdfPath } : {}),
    ...(typeof data.sourcePage === "number" ? { sourcePage: data.sourcePage } : {}),
    ...(Array.isArray(data.sectionIds) && calendarEventSections({ sectionIds: data.sectionIds as SchoolSection[] }).length ? { sectionIds: calendarEventSections({ sectionIds: data.sectionIds as SchoolSection[] }) } : {}),
  };
}

export function subscribeSchoolCalendar(input: { user: AppUser; schoolId: string; schoolYearId: string; onData: (calendar?: SchoolCalendar) => void; onError: (error: Error) => void }): Unsubscribe {
  if (!input.schoolYearId || input.user.schoolId !== input.schoolId || !["teacher", "study_director", "pedagogical_advisor", "orientation_advisor"].includes(input.user.role) || input.user.active === false || input.user.status === "inactive") throw new Error("Accès au calendrier non autorisé.");
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

/**
 * Lot R4 : `authority` (périmètre de réglage par section) est facultatif. Absent ou
 * « toute l'école » : enregistrement complet, exactement comme avant. Sinon, seuls les
 * événements des sections du compte sont écrits ou supprimés, et le statut est posé
 * pour ses sections seulement (`sectionStatus`) ; le reste du calendrier est conservé.
 */
export async function saveSchoolCalendar(input: { user: AppUser; schoolId: string; year: SchoolYear; expectedUpdatedAt?: string; previousEventIds: string[]; events: SchoolCalendarEvent[]; status: "draft" | "validated"; sourcePdf?: CalendarPdfSource; authority?: SectionAuthority; previousEvents?: SchoolCalendarEvent[] }) {
  if (input.user.role !== "study_director" || input.user.schoolId !== input.schoolId || input.year.schoolId !== input.schoolId || input.user.active === false || input.user.status === "inactive") throw new Error("Modification du calendrier non autorisée.");
  if (input.events.length > 100 || new Set(input.events.map((event) => event.id)).size !== input.events.length) throw new Error("Événements du calendrier invalides.");
  for (const event of input.events) {
    const error = validateCalendarEvent(event, input.year, input.events);
    if (error) throw new Error(error);
    if (event.origin === "pdf-import" && event.sourcePdfPath !== input.sourcePdf?.path) throw new Error("Source PDF de l'événement non liée au calendrier.");
  }
  const limited = input.authority && !input.authority.wholeSchool ? input.authority : undefined;
  if (limited) {
    if (!limited.sections.length) throw new Error("Modification du calendrier non autorisée : aucune de vos sections n'existe dans l'école.");
    const before = new Map((input.previousEvents ?? []).map((event) => [event.id, event]));
    if (input.previousEventIds.some((id) => !before.has(id))) throw new Error("Rechargez le calendrier avant de réessayer.");
    const after = new Map(input.events.map((event) => [event.id, event]));
    for (const [id, previous] of before) {
      const next = after.get(id);
      const changed = !next || JSON.stringify(next) !== JSON.stringify(previous);
      if (changed && !canManageSections(limited, calendarEventSections(previous))) throw new Error("Vous ne pouvez modifier que les événements de vos sections.");
    }
    for (const event of input.events) {
      if (!before.has(event.id) && !canManageSections(limited, calendarEventSections(event))) throw new Error("Vous ne pouvez ajouter des événements que pour vos sections.");
      if (before.has(event.id) && !canManageSections(limited, calendarEventSections(event)) && JSON.stringify(event) !== JSON.stringify(before.get(event.id))) throw new Error("Vous ne pouvez modifier que les événements de vos sections.");
    }
  }
  if (!db) throw new Error("Service indisponible. Veuillez réessayer.");
  const reference = calendarRef(input.year.id);
  await runTransaction(db as unknown as Firestore, async (transaction) => {
    const current = await transaction.get(reference);
    if ((current.exists() ? current.data().updatedAt : undefined) !== input.expectedUpdatedAt) throw new Error("Le calendrier a changé dans une autre session. Rechargez-le avant de réessayer.");
    if (current.exists() && (current.data().schoolId !== input.schoolId || current.data().schoolYearId !== input.year.id)) throw new Error("Calendrier hors périmètre.");
    if (current.exists() && current.data().sourcePdf && current.data().sourcePdf.path !== input.sourcePdf?.path) throw new Error("Le document PDF du calendrier ne peut pas être remplacé.");
    if (limited && !current.exists() && input.sourcePdf) throw new Error("Import PDF réservé à un compte qui agit pour toute l'école.");
    if (limited && current.exists() && (current.data().sourcePdf?.path ?? undefined) !== (input.sourcePdf?.path ?? undefined)) throw new Error("Import PDF réservé à un compte qui agit pour toute l'école.");
    const nextIds = new Set(input.events.map((event) => event.id));
    const previousById = new Map((input.previousEvents ?? []).map((event) => [event.id, event]));
    const ownEvent = (event: SchoolCalendarEvent | undefined) => !limited || Boolean(event && canManageSections(limited, calendarEventSections(event)));
    const removed = await Promise.all(input.previousEventIds.filter((id) => !nextIds.has(id) && ownEvent(previousById.get(id))).map(async (id) => {
      const reference = doc(calendarEventsRef(input.year.id), id);
      return { reference, snapshot: await transaction.get(reference) };
    }));
    const now = new Date().toISOString();
    const updatedAt = now === input.expectedUpdatedAt ? new Date(Date.now() + 1).toISOString() : now;
    if (limited) {
      // Compte d'une partie des sections : statut posé pour ses sections seulement.
      const data = current.exists() ? current.data() : undefined;
      const sectionStatus = { ...(data?.sectionStatus ?? {}), ...Object.fromEntries(limited.sections.map((section) => [section, input.status])) };
      transaction.set(reference, { schoolId: input.schoolId, schoolYearId: input.year.id, status: data?.status ?? "draft", updatedAt, updatedBy: input.user.id, ...(data?.sourcePdf ? { sourcePdf: data.sourcePdf } : {}), sectionStatus });
    } else {
      // Compte avec sections qui agit pour toute l'école : il le déclare, la règle de sécurité le vérifie une fois.
      // Compte sans section : document identique à avant.
      const declaredSchool = input.authority?.wholeSchool && userSectionIds(input.user).length > 0;
      transaction.set(reference, { schoolId: input.schoolId, schoolYearId: input.year.id, status: input.status, updatedAt, updatedBy: input.user.id, ...(input.sourcePdf ? { sourcePdf: input.sourcePdf } : {}), ...(declaredSchool ? { updatedScope: "school" } : {}) });
    }
    for (const { reference: eventReference, snapshot } of removed) {
      if (snapshot.exists()) transaction.delete(eventReference);
    }
    for (const event of input.events) {
      if (!ownEvent(event)) continue;
      transaction.set(doc(calendarEventsRef(input.year.id), event.id), eventDocument(event, input.schoolId, input.year.id));
    }
  });
}
