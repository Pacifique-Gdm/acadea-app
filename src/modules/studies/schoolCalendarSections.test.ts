import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser, SchoolYear } from "../../types";
import { resolveSectionAuthority } from "../../utils/sectionAuthority";
import { calendarEventSections, calendarStatusForSection, schoolCourseSuspended, validateCalendarEvent, type SchoolCalendar, type SchoolCalendarEvent } from "./schoolCalendar";

const writes: { kind: "set" | "delete"; path: string; data?: Record<string, unknown> }[] = [];
let stored: Record<string, unknown> | undefined;

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => {
  class Timestamp {
    constructor(private readonly date: Date) {}
    static fromDate(date: Date) { return new Timestamp(date); }
    toDate() { return this.date; }
  }
  const ref = (...parts: unknown[]) => ({ path: parts.filter((part) => typeof part === "string").join("/") });
  return {
    Timestamp,
    doc: (parent: { path?: string } | unknown, ...parts: string[]) => ref((parent as { path?: string }).path, ...parts),
    collection: (_db: unknown, ...parts: string[]) => ref(...parts),
    onSnapshot: vi.fn(),
    runTransaction: async (_db: unknown, run: (transaction: unknown) => Promise<void>) => run({
      get: async (reference: { path: string }) => reference.path.split("/").length === 2
        ? { exists: () => Boolean(stored), data: () => stored }
        : { exists: () => true, data: () => ({}) },
      set: (reference: { path: string }, data: Record<string, unknown>) => writes.push({ kind: "set", path: reference.path, data }),
      delete: (reference: { path: string }) => writes.push({ kind: "delete", path: reference.path }),
    }),
  };
});

const { saveSchoolCalendar } = await import("./schoolCalendarService");

const year = { id: "year-a", schoolId: "school-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-07-01", status: "active" } as SchoolYear;
const school = { educationLevels: ["Maternelle", "Primaire", "CTEB", "Secondaire"] };
const user = (extra: Partial<AppUser> = {}) => ({ id: "director", schoolId: "school-a", role: "study_director", active: true, status: "active", ...extra }) as AppUser;
const event = (id: string, extra: Partial<SchoolCalendarEvent> = {}): SchoolCalendarEvent => ({ id, title: id, kind: "holiday", startsAt: "2026-10-14", endsAt: "2026-10-14", origin: "local", suspendsCourses: true, ...extra });
const calendar = (events: SchoolCalendarEvent[], extra: Partial<SchoolCalendar> = {}): SchoolCalendar => ({ schoolId: "school-a", schoolYearId: "year-a", status: "validated", events, updatedAt: "v1", updatedBy: "director", ...extra });

describe("calendrier par section : effet sur les cours", () => {
  it("un calendrier déjà enregistré (sans section) donne exactement le même résultat qu'avant", () => {
    const old = calendar([event("conge")]);
    for (const section of [undefined, "Maternelle", "Primaire", "CTEB", "Secondaire"] as const) {
      expect(schoolCourseSuspended(old, "2026-10-14", "08:00", "09:00", section)).toBe(true);
      expect(schoolCourseSuspended({ ...old, status: "draft" }, "2026-10-14", "08:00", "09:00", section)).toBe(false);
    }
    expect(calendarEventSections(event("conge"))).toEqual([]);
  });
  it("un événement d'une section ne suspend que les cours de cette section", () => {
    const primary = calendar([event("primaire", { sectionIds: ["Primaire"] })]);
    expect(schoolCourseSuspended(primary, "2026-10-14", "08:00", "09:00", "Primaire")).toBe(true);
    expect(schoolCourseSuspended(primary, "2026-10-14", "08:00", "09:00", "Secondaire")).toBe(false);
    expect(schoolCourseSuspended(primary, "2026-10-14", "08:00", "09:00")).toBe(false);
  });
  it("le statut propre à une section l'emporte, sinon celui du calendrier", () => {
    const value = calendar([event("primaire", { sectionIds: ["Primaire"] }), event("ecole", { startsAt: "2026-10-20", endsAt: "2026-10-20" })], { status: "draft", sectionStatus: { Primaire: "validated" } });
    expect(calendarStatusForSection(value, "Primaire")).toBe("validated");
    expect(calendarStatusForSection(value, "Secondaire")).toBe("draft");
    expect(schoolCourseSuspended(value, "2026-10-14", "08:00", "09:00", "Primaire")).toBe(true);
    // Événement « toute l'école » : suit le statut du calendrier (brouillon ici).
    expect(schoolCourseSuspended(value, "2026-10-20", "08:00", "09:00", "Primaire")).toBe(false);
    expect(schoolCourseSuspended({ ...value, status: "validated", sectionStatus: { Primaire: "draft" } }, "2026-10-14", "08:00", "09:00", "Primaire")).toBe(false);
  });
  it("refuse des sections d'événement invalides", () => {
    const existing: SchoolCalendarEvent[] = [];
    expect(validateCalendarEvent(event("a", { sectionIds: ["Primaire"] }), year, existing)).toBeUndefined();
    expect(validateCalendarEvent(event("a", { sectionIds: ["Lycée" as never] }), year, existing)).toBe("Sections de l’événement invalides.");
    expect(validateCalendarEvent(event("a", { sectionIds: ["Primaire", "Primaire"] }), year, existing)).toBe("Sections de l’événement invalides.");
  });
});

describe("calendrier par section : enregistrement", () => {
  beforeEach(() => { writes.length = 0; stored = { schoolId: "school-a", schoolYearId: "year-a", status: "validated", updatedAt: "v1", updatedBy: "autre" }; });
  const before = [event("ecole"), event("primaire", { sectionIds: ["Primaire"] }), event("secondaire", { sectionIds: ["Secondaire"] })];
  const base = { schoolId: "school-a", year, expectedUpdatedAt: "v1", previousEventIds: before.map((item) => item.id), previousEvents: before };

  it("un compte sans section enregistre tout, comme avant (sans statut par section)", async () => {
    await saveSchoolCalendar({ ...base, user: user(), events: before, status: "validated", authority: resolveSectionAuthority(user(), school) });
    expect(writes.filter((item) => item.path.includes("/events/")).map((item) => item.path)).toEqual(["schoolCalendars/year-a/events/ecole", "schoolCalendars/year-a/events/primaire", "schoolCalendars/year-a/events/secondaire"]);
    expect(writes[0].data).toMatchObject({ status: "validated" });
    expect(writes[0].data).not.toHaveProperty("sectionStatus");
    expect(writes[0].data).not.toHaveProperty("updatedScope");
    expect(writes.find((item) => item.path.endsWith("/primaire"))?.data).toMatchObject({ sectionIds: ["Primaire"] });
    expect(writes.find((item) => item.path.endsWith("/ecole"))?.data).not.toHaveProperty("sectionIds");
  });
  it("un compte couvrant toutes les sections enregistre tout et le déclare « toute l'école »", async () => {
    const everything = user({ sectionIds: ["Maternelle", "Primaire", "CTEB", "Secondaire"] });
    await saveSchoolCalendar({ ...base, user: everything, events: before, status: "validated", authority: resolveSectionAuthority(everything, school) });
    expect(writes[0].data).toMatchObject({ status: "validated", updatedScope: "school" });
    expect(writes.filter((item) => item.path.includes("/events/"))).toHaveLength(3);
  });
  it("un compte Primaire n'écrit que ses événements et le statut de sa section", async () => {
    const primary = user({ sectionIds: ["Primaire"] });
    const events = [before[0], { ...before[1], title: "Congé corrigé" }, before[2], event("nouveau", { sectionIds: ["Primaire"] })];
    await saveSchoolCalendar({ ...base, user: primary, events, status: "draft", authority: resolveSectionAuthority(primary, school) });
    expect(writes.map((item) => item.path)).toEqual(["schoolCalendars/year-a", "schoolCalendars/year-a/events/primaire", "schoolCalendars/year-a/events/nouveau"]);
    expect(writes[0].data).toMatchObject({ status: "validated", sectionStatus: { Primaire: "draft" } });
    expect(writes[0].data).not.toHaveProperty("updatedScope");
  });
  it("un compte Primaire ne peut ni modifier ni supprimer un événement de toute l'école ou d'une autre section", async () => {
    const primary = user({ sectionIds: ["Primaire"] });
    const authority = resolveSectionAuthority(primary, school);
    await expect(saveSchoolCalendar({ ...base, user: primary, events: [{ ...before[0], title: "x" }, before[1], before[2]], status: "draft", authority })).rejects.toThrow("Vous ne pouvez modifier que les événements de vos sections.");
    await expect(saveSchoolCalendar({ ...base, user: primary, events: [before[0], before[1]], status: "draft", authority })).rejects.toThrow("Vous ne pouvez modifier que les événements de vos sections.");
    await expect(saveSchoolCalendar({ ...base, user: primary, events: [...before, event("ecole2")], status: "draft", authority })).rejects.toThrow("Vous ne pouvez ajouter des événements que pour vos sections.");
    expect(writes).toEqual([]);
  });
  it("un compte Primaire peut supprimer un événement de sa section", async () => {
    const primary = user({ sectionIds: ["Primaire"] });
    await saveSchoolCalendar({ ...base, user: primary, events: [before[0], before[2]], status: "draft", authority: resolveSectionAuthority(primary, school) });
    expect(writes.map((item) => `${item.kind}:${item.path}`)).toEqual(["set:schoolCalendars/year-a", "delete:schoolCalendars/year-a/events/primaire"]);
  });
});
