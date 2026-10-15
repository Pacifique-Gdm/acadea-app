import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../../types";
import { schoolStudyDay } from "../teacher/teacherPortalData";
import { applicableSchoolYear, defaultEventSuspendsCourses, parseOfficialCalendarProposal, schoolCivilDate, schoolCourseSuspended, teachingDayStatus, validateCalendarEvent, type SchoolCalendar, type SchoolCalendarEvent } from "./schoolCalendar";

const year = (id: string, startsAt: string, endsAt: string, schoolId = "school-a") => ({ id, schoolId, name: id, startsAt, endsAt, status: "active" }) as SchoolYear;
const current = year("2026-2027", "2026-09-01", "2027-07-01");
const event = (kind: SchoolCalendarEvent["kind"], startsAt: string, endsAt = startsAt): SchoolCalendarEvent => ({ id: `${kind}-${startsAt}`, title: kind, kind, startsAt, endsAt, origin: "local" });
const calendar = (events: SchoolCalendarEvent[], status: SchoolCalendar["status"] = "validated"): SchoolCalendar => ({ schoolId: "school-a", schoolYearId: current.id, status, events, updatedAt: "now", updatedBy: "director" });

describe("calendrier scolaire et date de l'établissement", () => {
  it("suit le jour civil local à minuit, sans dépendre du fuseau du navigateur", () => {
    const before = new Date("2026-10-14T22:59:00Z");
    const after = new Date("2026-10-14T23:00:00Z");
    expect(schoolCivilDate(before, "Africa/Kinshasa")).toBe("2026-10-14");
    expect(schoolCivilDate(after, "Africa/Kinshasa")).toBe("2026-10-15");
    expect(schoolStudyDay(before, "Africa/Kinshasa")).toBe("wednesday");
    expect(schoolStudyDay(after, "Africa/Kinshasa")).toBe("thursday");
    expect(schoolCivilDate(after, "UTC")).toBe("2026-10-14");
    expect(schoolCivilDate(after, "Invalid/Zone")).toBeUndefined();
    expect(schoolCivilDate(after, undefined)).toBeUndefined();
  });
  it("reconnaît lundi à samedi et refuse le dimanche", () => {
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", undefined];
    days.forEach((day, index) => expect(schoolStudyDay(new Date(`2026-10-${String(12 + index).padStart(2, "0")}T12:00:00Z`), "UTC")).toBe(day));
  });
  it("utilise les bornes réelles de l'année, y compris décembre et janvier", () => {
    expect(applicableSchoolYear([current], "school-a", "2026-12-31")).toMatchObject({ status: "current", year: current });
    expect(applicableSchoolYear([current], "school-a", "2027-01-01")).toMatchObject({ status: "current", year: current });
    expect(applicableSchoolYear([current], "school-a", "2026-08-31")).toEqual({ status: "before" });
    expect(applicableSchoolYear([current], "school-a", "2027-07-02")).toEqual({ status: "after" });
    expect(applicableSchoolYear([current], "school-b", "2026-10-14")).toEqual({ status: "missing" });
    expect(applicableSchoolYear([current, year("next", "2027-07-02", "2028-07-01")], "school-a", "2027-07-02")).toMatchObject({ status: "current", year: { id: "next" } });
    expect(applicableSchoolYear([current, year("overlap", "2027-01-01", "2028-06-01")], "school-a", "2027-01-02")).toEqual({ status: "ambiguous" });
    expect(applicableSchoolYear([current, year("bad", "", "")], "school-a", "2026-10-14")).toEqual({ status: "incomplete" });
  });
  it("distingue calendrier absent, brouillon, vacances et autres interruptions enregistrées", () => {
    expect(teachingDayStatus(undefined, "2026-10-14")).toBe("unconfigured");
    expect(teachingDayStatus(calendar([], "draft"), "2026-10-14")).toBe("draft");
    expect(teachingDayStatus(calendar([{ ...event("holiday", "2026-10-14"), endsAt: "2026-02-30" }]), "2026-10-14")).toBe("incomplete");
    for (const kind of ["vacation", "holiday", "pedagogical", "suspension"] as const) expect(teachingDayStatus(calendar([{ ...event(kind, "2026-10-14"), suspendsCourses: true }]), "2026-10-14")).toBe(kind);
    expect(teachingDayStatus(calendar([{ ...event("vacation", "2026-12-20", "2027-01-05"), suspendsCourses: true }]), "2027-01-02")).toBe("vacation");
    expect(teachingDayStatus(calendar([{ ...event("vacation", "2026-12-20", "2027-01-05"), suspendsCourses: true }]), "2027-01-06")).toBe("teaching");
    expect(teachingDayStatus(calendar([event("resumption", "2026-10-14")]), "2026-10-14")).toBe("teaching");
  });
  it("ne suspend jamais les événements legacy ou informatifs, ni les brouillons", () => {
    expect(defaultEventSuspendsCourses("vacation")).toBe(true);
    expect(defaultEventSuspendsCourses("pedagogical")).toBe(false);
    for (const kind of ["meeting", "ceremony", "classCouncil", "exam", "activity"] as const) {
      expect(defaultEventSuspendsCourses(kind)).toBe(false);
      expect(schoolCourseSuspended(calendar([{ ...event(kind, "2026-10-14"), suspendsCourses: false }]), "2026-10-14", "08:00", "09:00")).toBe(false);
    }
    expect(validateCalendarEvent({ ...event("resumption", "2026-10-14"), suspendsCourses: true }, current, [])).toContain("reprise");
    expect(teachingDayStatus(calendar([event("vacation", "2026-10-14")]), "2026-10-14")).toBe("teaching");
    expect(schoolCourseSuspended(calendar([event("holiday", "2026-10-14")]), "2026-10-14", "08:00", "09:00")).toBe(false);
    expect(schoolCourseSuspended(calendar([{ ...event("pedagogical", "2026-10-14"), suspendsCourses: false }]), "2026-10-14", "08:00", "09:00")).toBe(false);
    expect(schoolCourseSuspended(calendar([{ ...event("suspension", "2026-10-14"), suspendsCourses: true }], "draft"), "2026-10-14", "08:00", "09:00")).toBe(false);
  });
  it("distingue suspensions complètes, partielles et autres jours", () => {
    const full = calendar([{ ...event("vacation", "2026-10-14", "2026-10-16"), suspendsCourses: true }]);
    expect(schoolCourseSuspended(full, "2026-10-15", "08:00", "09:00")).toBe(true);
    expect(schoolCourseSuspended(full, "2026-10-17", "08:00", "09:00")).toBe(false);
    const partial = calendar([{ ...event("suspension", "2026-10-14"), suspendsCourses: true, startTime: "09:00", endTime: "10:00" }]);
    expect(schoolCourseSuspended(partial, "2026-10-14", "08:00", "09:00")).toBe(false);
    expect(schoolCourseSuspended(partial, "2026-10-14", "09:00", "10:00")).toBe(true);
    expect(validateCalendarEvent(partial.events[0], current, [])).toBeUndefined();
    expect(validateCalendarEvent({ ...partial.events[0], endsAt: "2026-10-15" }, current, [])).toContain("Créneau");
  });
  it("refuse dates impossibles, hors année, reprises contradictoires et source officielle incomplète", () => {
    expect(validateCalendarEvent(event("holiday", "2026-02-30"), current, [])).toBe("Dates incohérentes.");
    expect(validateCalendarEvent(event("holiday", "2026-08-31"), current, [])).toBe("Événement hors de l'année scolaire.");
    expect(validateCalendarEvent(event("resumption", "2026-10-14"), current, [event("vacation", "2026-10-10", "2026-10-20")])).toContain("Chevauchement");
    expect(validateCalendarEvent({ ...event("holiday", "2026-10-14"), origin: "official-proposal" }, current, [])).toContain("Source officielle");
    expect(validateCalendarEvent({ ...event("holiday", "2026-10-14"), origin: "official-proposal", sourceUrl: "https://edu-nc.gouv.cd/calendrier-scolaire", educationLevel: "Secondaire" }, current, [])).toBeUndefined();
    expect(validateCalendarEvent({ ...event("holiday", "2026-10-14"), origin: "official-proposal", sourceUrl: "https://edu.example.org/calendar", educationLevel: "Secondaire" }, current, [])).toContain("Source officielle");
  });
  it("n'importe qu'une proposition sourcée, prévisualisable, sans date officielle codée en dur", () => {
    const source = { url: "https://edu-nc.gouv.cd/calendrier-scolaire", publishedAt: "2026-09-01", educationLevel: "Secondaire" };
    const raw = JSON.stringify([{ title: "Congé annoncé", kind: "holiday", startsAt: "2026-10-14", endsAt: "2026-10-14" }]);
    expect(parseOfficialCalendarProposal(raw, source, current, [])).toMatchObject([{ title: "Congé annoncé", origin: "official-proposal", sourceUrl: source.url, educationLevel: "Secondaire" }]);
    expect(() => parseOfficialCalendarProposal(raw, { ...source, url: "" }, current, [])).toThrow("Source officielle");
    expect(() => parseOfficialCalendarProposal(raw, { ...source, url: "https://edu-nc.gouv.cd.evil.example/" }, current, [])).toThrow("Source officielle");
    expect(parseOfficialCalendarProposal(raw, { ...source, publishedAt: "" }, current, [])[0].publishedAt).toBeUndefined();
    expect(() => parseOfficialCalendarProposal(raw, source, current, [event("resumption", "2026-10-14")])).toThrow("Chevauchement");
    expect(() => parseOfficialCalendarProposal("not json", source, current, [])).toThrow("JSON valide");
  });
});
