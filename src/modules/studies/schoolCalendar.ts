import type { SchoolYear } from "../../types";

export type CalendarEventKind = "vacation" | "holiday" | "pedagogical" | "suspension" | "resumption" | "meeting" | "ceremony" | "classCouncil" | "exam" | "activity";
const calendarEventKinds: CalendarEventKind[] = ["vacation", "holiday", "pedagogical", "suspension", "resumption", "meeting", "ceremony", "classCouncil", "exam", "activity"];
export type SchoolCalendarEvent = {
  id: string;
  title: string;
  kind: CalendarEventKind;
  startsAt: string;
  endsAt: string;
  origin: "local" | "official-proposal";
  sourceUrl?: string;
  publishedAt?: string;
  educationLevel?: string;
  suspendsCourses?: boolean;
  startTime?: string;
  endTime?: string;
};
export type SchoolCalendar = {
  schoolId: string;
  schoolYearId: string;
  status: "draft" | "validated";
  events: SchoolCalendarEvent[];
  updatedAt: string;
  updatedBy: string;
};

const isoDay = /^\d{4}-\d{2}-\d{2}$/;
export function validCalendarDate(value: string): boolean {
  if (!isoDay.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function officialCalendarSource(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "edu-nc.gouv.cd";
  } catch { return false; }
}

export function defaultEventSuspendsCourses(kind: CalendarEventKind): boolean {
  return kind === "vacation" || kind === "holiday" || kind === "suspension";
}

export function schoolCivilDate(now: Date, timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    const value = `${part("year")}-${part("month")}-${part("day")}`;
    return validCalendarDate(value) ? value : undefined;
  } catch { return undefined; }
}

function yearDay(value: string | undefined): string | undefined {
  const day = value?.slice(0, 10) ?? "";
  return validCalendarDate(day) ? day : undefined;
}

export function applicableSchoolYear(years: SchoolYear[], schoolId: string, date: string):
  { status: "current"; year: SchoolYear } | { status: "missing" | "ambiguous" | "incomplete" | "before" | "after" } {
  const scoped = years.filter((year) => year.schoolId === schoolId);
  if (!scoped.length) return { status: "missing" };
  if (scoped.some((year) => !yearDay(year.startsAt) || !yearDay(year.endsAt) || yearDay(year.startsAt)! > yearDay(year.endsAt)!)) return { status: "incomplete" };
  const matches = scoped.filter((year) => yearDay(year.startsAt)! <= date && date <= yearDay(year.endsAt)!);
  if (matches.length > 1) return { status: "ambiguous" };
  if (matches.length === 1) return { status: "current", year: matches[0] };
  return { status: date < scoped.map((year) => yearDay(year.startsAt)!).sort()[0] ? "before" : "after" };
}

export function validateCalendarEvent(event: SchoolCalendarEvent, year: SchoolYear, existing: SchoolCalendarEvent[]): string | undefined {
  if (!event.id || !event.title.trim() || event.title.length > 120 || !calendarEventKinds.includes(event.kind)) return "Événement incomplet.";
  if (!validCalendarDate(event.startsAt) || !validCalendarDate(event.endsAt) || event.startsAt > event.endsAt) return "Dates incohérentes.";
  if (event.suspendsCourses !== undefined && typeof event.suspendsCourses !== "boolean") return "Suspension des cours invalide.";
  if (event.kind === "resumption" && event.suspendsCourses === true) return "Une reprise des cours ne peut pas suspendre les cours.";
  if (event.startTime !== undefined || event.endTime !== undefined) {
    if (!event.suspendsCourses || event.startsAt !== event.endsAt || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.startTime ?? "") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.endTime ?? "") || event.startTime! >= event.endTime!) return "Créneau de suspension invalide : choisissez un seul jour et deux heures cohérentes.";
  }
  const start = yearDay(year.startsAt), end = yearDay(year.endsAt);
  if (!start || !end) return "Dates de l'année scolaire incomplètes.";
  if (event.startsAt < start || event.endsAt > end) return "Événement hors de l'année scolaire.";
  if (event.origin === "official-proposal" && (!officialCalendarSource(event.sourceUrl ?? "") || (event.publishedAt && !validCalendarDate(event.publishedAt)) || !event.educationLevel?.trim())) return "Source officielle du ministère et niveau requis ; date de publication valide si renseignée.";
  if (event.origin !== "local" && event.origin !== "official-proposal") return "Origine de l’événement invalide.";
  if (existing.some((item) => item.id !== event.id && event.startsAt <= item.endsAt && item.startsAt <= event.endsAt && (item.kind === "resumption") !== (event.kind === "resumption"))) return "Chevauchement contradictoire avec une reprise des cours.";
  return undefined;
}

export function parseOfficialCalendarProposal(raw: string, source: { url: string; publishedAt: string; educationLevel: string }, year: SchoolYear, existing: SchoolCalendarEvent[]): SchoolCalendarEvent[] {
  if (!officialCalendarSource(source.url) || (source.publishedAt && !validCalendarDate(source.publishedAt)) || !source.educationLevel.trim()) throw new Error("Source officielle du ministère et niveau requis ; date de publication valide si renseignée.");
  let values: unknown;
  try { values = JSON.parse(raw); } catch { throw new Error("Le calendrier proposé doit être un tableau JSON valide."); }
  if (!Array.isArray(values) || values.length === 0 || values.length + existing.length > 100) throw new Error("Le calendrier proposé doit contenir entre 1 et 100 événements.");
  const proposals: SchoolCalendarEvent[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") throw new Error("Événement proposé invalide.");
    const item = value as Record<string, unknown>;
    if (!calendarEventKinds.includes(item.kind as CalendarEventKind)) throw new Error("Type d’événement proposé invalide.");
    const candidate: SchoolCalendarEvent = {
      id: crypto.randomUUID(), title: String(item.title ?? ""), kind: item.kind as CalendarEventKind,
      startsAt: String(item.startsAt ?? ""), endsAt: String(item.endsAt ?? ""),
      origin: "official-proposal", sourceUrl: source.url, ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}), educationLevel: source.educationLevel.trim(),
      suspendsCourses: defaultEventSuspendsCourses(item.kind as CalendarEventKind),
    };
    const issue = validateCalendarEvent(candidate, year, [...existing, ...proposals]);
    if (issue) throw new Error(issue);
    proposals.push(candidate);
  }
  return proposals;
}

export type TeachingDayStatus = "teaching" | "unconfigured" | "draft" | "incomplete" | Exclude<CalendarEventKind, "resumption">;
export function teachingDayStatus(calendar: SchoolCalendar | undefined, date: string): TeachingDayStatus {
  if (!calendar) return "unconfigured";
  if (calendar.status !== "validated") return "draft";
  if (!Array.isArray(calendar.events) || calendar.events.some((event) => !event || !validCalendarDate(event.startsAt) || !validCalendarDate(event.endsAt) || event.startsAt > event.endsAt || !calendarEventKinds.includes(event.kind))) return "incomplete";
  const blockers = calendar.events.filter((event) => event.suspendsCourses === true && event.startsAt <= date && date <= event.endsAt && event.kind !== "resumption");
  const kind = blockers[0]?.kind;
  return kind && kind !== "resumption" ? kind : "teaching";
}

export function schoolCourseSuspended(calendar: SchoolCalendar | undefined, date: string, startTime: string, endTime: string): boolean {
  if (calendar?.status !== "validated") return false;
  return calendar.events.some((event) => event.suspendsCourses === true && event.kind !== "resumption"
    && event.startsAt <= date && date <= event.endsAt
    && (event.startTime === undefined || event.endTime === undefined || (startTime < event.endTime && endTime > event.startTime)));
}

export const teachingDayMessages: Record<Exclude<TeachingDayStatus, "teaching">, string> = {
  unconfigured: "Calendrier scolaire non configuré.",
  draft: "Calendrier scolaire non encore validé.",
  incomplete: "Calendrier scolaire incomplet ou incohérent.",
  vacation: "Vacances scolaires — aucun cours.",
  holiday: "Jour férié — aucun cours.",
  pedagogical: "Journée pédagogique — aucun cours.",
  suspension: "Cours suspendus aujourd’hui.",
  meeting: "Réunion — cours suspendus.",
  ceremony: "Cérémonie — cours suspendus.",
  classCouncil: "Conseil de classe — cours suspendus.",
  exam: "Examen — cours suspendus.",
  activity: "Activité — cours suspendus.",
};
