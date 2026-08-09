import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../../types";

const firestore = vi.hoisted(() => {
  const subscriptions: Array<{ source: unknown; next: (snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => void; error: (cause: Error) => void; unsubscribe: ReturnType<typeof vi.fn> }> = [];
  return {
    subscriptions,
    collection: vi.fn((_db: unknown, name: string) => ({ name })),
    where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
    query: vi.fn((source: unknown, ...filters: unknown[]) => ({ source, filters })),
    onSnapshot: vi.fn((source: unknown, next: (snapshot: { docs: Array<{ id: string; data: () => unknown }> }) => void, error: (cause: Error) => void) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ source, next, error, unsubscribe });
      return unsubscribe;
    }),
  };
});

vi.mock("../../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => ({
  ...firestore,
  doc: vi.fn(),
  runTransaction: vi.fn(),
  setDoc: vi.fn(),
  writeBatch: vi.fn(),
}));

import { subscribeToStudyData } from "./studyService";

const user: AppUser = { id: "director-1", name: "Direction", email: "direction@example.test", role: "study_director", schoolId: "school-1" };

function subscribe(overrides: Partial<Parameters<typeof subscribeToStudyData>[0]> = {}) {
  return subscribeToStudyData({
    user,
    schoolId: "school-1",
    schoolYearId: "year-1",
    onTeachers: vi.fn(),
    onSubjects: vi.fn(),
    onClasses: vi.fn(),
    onAssignments: vi.fn(),
    onAvailabilities: vi.fn(),
    onPeriods: vi.fn(),
    onTimetables: vi.fn(),
    onTimetableEntries: vi.fn(),
    onRooms: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  });
}

describe("listeners temps réel Direction des études", () => {
  beforeEach(() => {
    firestore.subscriptions.length = 0;
    vi.clearAllMocks();
  });

  it("crée une seule écoute par collection avec les bons périmètres", () => {
    subscribe();
    expect(firestore.subscriptions).toHaveLength(9);
    expect(firestore.collection.mock.calls.map((call) => call[1])).toEqual([
      "teachers", "subjects", "classes", "pedagogicalAssignments", "teacherAvailabilities", "schedulePeriods", "timetables", "timetableEntries", "rooms",
    ]);
    expect(new Set(firestore.collection.mock.calls.map((call) => call[1])).size).toBe(9);
    for (const subscription of firestore.subscriptions) {
      expect(subscription.source).toMatchObject({ filters: [
        { field: "schoolId", operator: "==", value: "school-1" },
        { field: "schoolYearId", operator: "==", value: "year-1" },
      ] });
    }
  });

  it("transmet ajouts, modifications, désactivations et déduplique un snapshot", () => {
    const onAvailabilities = vi.fn();
    subscribe({ onAvailabilities });
    const availabilityListener = firestore.subscriptions[4];
    availabilityListener.next({ docs: [
      { id: "rest", data: () => ({ status: "rest", active: false }) },
      { id: "available", data: () => ({ status: "available", active: true }) },
      { id: "available", data: () => ({ status: "available", active: true }) },
    ] });
    expect(onAvailabilities).toHaveBeenCalledWith([
      { id: "rest", status: "rest", active: false },
      { id: "available", status: "available", active: true },
    ]);
    availabilityListener.next({ docs: [{ id: "unavailable", data: () => ({ status: "unavailable", active: true }) }] });
    expect(onAvailabilities).toHaveBeenLastCalledWith([{ id: "unavailable", status: "unavailable", active: true }]);
  });

  it("transmet les périodes et les erreurs puis désabonne toutes les écoutes", () => {
    const onPeriods = vi.fn();
    const onError = vi.fn();
    const unsubscribes = subscribe({ onPeriods, onError });
    firestore.subscriptions[5].next({ docs: [{ id: "period-1", data: () => ({ type: "course", active: true }) }] });
    expect(onPeriods).toHaveBeenCalledWith([{ id: "period-1", type: "course", active: true }]);
    const failure = new Error("listener failed");
    firestore.subscriptions[4].error(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    expect(firestore.subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it("refuse les paramètres incomplets avant de créer un listener", () => {
    expect(() => subscribe({ schoolYearId: "" })).toThrow("Périmètre pédagogique non autorisé.");
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });
});
