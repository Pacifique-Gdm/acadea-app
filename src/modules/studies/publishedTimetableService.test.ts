import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";

const firestore = vi.hoisted(() => {
  const subscriptions: Array<{ source: unknown; next: (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void; error: (error: Error) => void; unsubscribe: ReturnType<typeof vi.fn> }> = [];
  return {
    subscriptions,
    collection: vi.fn((_db: unknown, name: string) => ({ name })),
    where: vi.fn((field: string, operator: string, value: unknown) => ({ field, operator, value })),
    query: vi.fn((source: unknown, ...filters: unknown[]) => ({ source, filters })),
    onSnapshot: vi.fn((source: unknown, next: (snapshot: { docs: Array<{ id: string; data: () => Record<string, unknown> }> }) => void, error: (error: Error) => void) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ source, next, error, unsubscribe });
      return unsubscribe;
    }),
  };
});

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => firestore);

import { canReadPublishedTimetable, subscribeToActivePublishedTimetable } from "./publishedTimetableService";

const user: AppUser = { id: "secretary", name: "Secrétaire", email: "secretary@example.test", role: "secretary", schoolId: "school-a" };

describe("horaire publié en temps réel", () => {
  beforeEach(() => { firestore.subscriptions.length = 0; vi.clearAllMocks(); });

  it("filtre strictement l'horaire actif publié puis ses créneaux", () => {
    const onData = vi.fn();
    subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData, onError: vi.fn() });
    expect(firestore.subscriptions[0].source).toMatchObject({ filters: [
      { field: "schoolId", operator: "==", value: "school-a" }, { field: "schoolYearId", operator: "==", value: "year-a" },
      { field: "status", operator: "==", value: "PUBLISHED" }, { field: "activePublished", operator: "==", value: true },
    ] });
    firestore.subscriptions[0].next({ docs: [{ id: "schedule-1", data: () => ({ version: 1, status: "PUBLISHED", activePublished: true }) }] });
    expect(firestore.subscriptions[1].source).toMatchObject({ filters: expect.arrayContaining([{ field: "scheduleId", operator: "==", value: "schedule-1" }]) });
    firestore.subscriptions[1].next({ docs: [{ id: "entry-1", data: () => ({ scheduleId: "schedule-1" }) }] });
    expect(onData).toHaveBeenLastCalledWith(expect.objectContaining({ timetable: expect.objectContaining({ id: "schedule-1" }), entries: [expect.objectContaining({ id: "entry-1" })] }));
  });

  it("retourne un état vide sans le traiter comme une erreur", () => {
    const onData = vi.fn();
    const onError = vi.fn();
    subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData, onError });
    firestore.subscriptions[0].next({ docs: [] });
    expect(onData).toHaveBeenCalledWith(null);
    expect(onError).not.toHaveBeenCalled();
  });

  it("remplace le listener des créneaux et conserve l'isolation de rôle et d'école", () => {
    const unsubscribe = subscribeToActivePublishedTimetable({ user, schoolId: "school-a", schoolYearId: "year-a", onData: vi.fn(), onError: vi.fn() });
    firestore.subscriptions[0].next({ docs: [{ id: "schedule-1", data: () => ({}) }] });
    firestore.subscriptions[0].next({ docs: [{ id: "schedule-2", data: () => ({}) }] });
    expect(firestore.subscriptions[1].unsubscribe).toHaveBeenCalledOnce();
    unsubscribe();
    expect(firestore.subscriptions[2].unsubscribe).toHaveBeenCalledOnce();
    expect(() => subscribeToActivePublishedTimetable({ user: { ...user, schoolId: "school-b" }, schoolId: "school-a", schoolYearId: "year-a", onData: vi.fn(), onError: vi.fn() })).toThrow();
    expect(() => subscribeToActivePublishedTimetable({ user: { ...user, role: "cashier" }, schoolId: "school-a", schoolYearId: "year-a", onData: vi.fn(), onError: vi.fn() })).toThrow();
  });

  it("expose l'entrée uniquement aux trois rôles lecteurs autorisés", () => {
    for (const role of ["school_admin", "secretary", "discipline_director"] as const) {
      expect(canReadPublishedTimetable({ ...user, role })).toBe(true);
    }
    expect(canReadPublishedTimetable({ ...user, role: "cashier" })).toBe(false);
    expect(canReadPublishedTimetable({ ...user, role: "study_director" })).toBe(false);
    expect(canReadPublishedTimetable({ ...user, status: "inactive" })).toBe(false);
  });
});
