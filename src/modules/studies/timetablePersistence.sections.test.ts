import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";
import type { Timetable, TimetableEntry } from "./studyTypes";

const mocks = vi.hoisted(() => { const set = vi.fn(), update = vi.fn(), remove = vi.fn(), commit = vi.fn(async () => undefined); return { set, update, remove, commit, writeBatch: vi.fn(() => ({ set, update, delete: remove, commit })), doc: vi.fn((_db: unknown, ...path: string[]) => path.join("/")) }; });
vi.mock("@firebase/firestore", () => mocks);
import { persistGeneratedTimetable } from "./timetablePersistence";

// Lot R5 : un brouillon ne remplace que le brouillon actif du même périmètre.
const user = { id: "u", role: "study_director", schoolId: "s" } as AppUser;
const metadata = { algorithm: "deterministic-backtracking", exploredBranches: 1, durationMs: 1, maxSameAssignmentPeriodsPerDay: 2 } as Timetable["generationMetadata"];
const draft = (id: string, sectionId?: Timetable["sectionId"]) => ({ id, schoolId: "s", schoolYearId: "y", version: 1, status: "DRAFT", activeDraft: true, createdBy: "x", createdAt: "n", updatedAt: "n", generationMetadata: metadata, ...(sectionId ? { sectionId } : {}) }) as Timetable;
const entry = { id: "e", scheduleId: "pending", schoolId: "s", schoolYearId: "y", classId: "c", teacherId: "t", subjectId: "m", assignmentId: "a", dayOfWeek: "monday", periodId: "p", roomId: null, createdAt: "n", updatedAt: "n" } as TimetableEntry;
const existing = [draft("ecole"), draft("prim", "Primaire"), draft("sec", "Secondaire")];

describe("brouillon par section (R5)", () => {
  beforeEach(() => vi.clearAllMocks());
  it("un brouillon de section ne désactive que celui de sa section", async () => {
    const created = await persistGeneratedTimetable({} as never, { user, schoolId: "s", schoolYearId: "y", version: 5, entries: [entry], existing, metadata, sectionId: "Primaire" });
    expect(created).toMatchObject({ id: "s__y__Primaire__v5", sectionId: "Primaire", activeDraft: true });
    const deactivated = mocks.update.mock.calls.filter(([, value]) => value.activeDraft === false).map(([path]) => path);
    expect(deactivated).toEqual(["timetables/prim"]);
  });
  it("un brouillon de toute l'école garde le fonctionnement d'avant (sans sectionId)", async () => {
    const created = await persistGeneratedTimetable({} as never, { user, schoolId: "s", schoolYearId: "y", version: 5, entries: [entry], existing, metadata });
    expect(created.id).toBe("s__y__v5");
    expect(created).not.toHaveProperty("sectionId");
    expect(mocks.update.mock.calls.filter(([, value]) => value.activeDraft === false).map(([path]) => path)).toEqual(["timetables/ecole"]);
  });
});
