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

import { mergeStudyTeachers, subscribeToStudyData } from "./studyService";

const user: AppUser = { id: "director-1", name: "Direction", email: "direction@example.test", role: "study_director", schoolId: "school-1" };

function subscribe(overrides: Partial<Parameters<typeof subscribeToStudyData>[0]> = {}) {
  return subscribeToStudyData({
    user,
    schoolId: "school-1",
    schoolYearId: "year-1",
    onTeachers: vi.fn(),
    onSubjects: vi.fn(),
    onClasses: vi.fn(),
    onStudents: vi.fn(),
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
    expect(firestore.subscriptions).toHaveLength(11);
    expect(firestore.collection.mock.calls.map((call) => call[1])).toEqual([
      "teachers", "users", "subjects", "classes", "students", "pedagogicalAssignments", "teacherAvailabilities", "schedulePeriods", "timetables", "timetableEntries", "rooms",
    ]);
    expect(new Set(firestore.collection.mock.calls.map((call) => call[1])).size).toBe(11);
    expect(firestore.subscriptions[1].source).toMatchObject({ filters: [
      { field: "schoolId", operator: "==", value: "school-1" },
      { field: "role", operator: "==", value: "teacher" },
    ] });
    for (const subscription of firestore.subscriptions.filter((_, index) => index !== 1)) {
      expect(subscription.source).toMatchObject({ filters: [
        { field: "schoolId", operator: "==", value: "school-1" },
        { field: "schoolYearId", operator: "==", value: "year-1" },
      ] });
    }
  });

  it("transmet ajouts, modifications, désactivations et déduplique un snapshot", () => {
    const onAvailabilities = vi.fn();
    subscribe({ onAvailabilities });
    const availabilityListener = firestore.subscriptions[6];
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

  it("transmet en temps réel les élèves inscrits dans l’école et l’année", () => {
    const onStudents = vi.fn();
    subscribe({ onStudents });
    firestore.subscriptions[4].next({ docs: [{ id: "student-1", data: () => ({ schoolId: "school-1", schoolYearId: "year-1", className: "8ème CTEB" }) }] });
    expect(onStudents).toHaveBeenCalledWith([{ id: "student-1", schoolId: "school-1", schoolYearId: "year-1", className: "8ème CTEB" }]);
  });

  it("fait apparaître automatiquement un utilisateur Enseignant dès les snapshots users/teachers", () => {
    const onTeachers = vi.fn();
    subscribe({ onTeachers });
    firestore.subscriptions[0].next({ docs: [
      { id: "profile-1", data: () => ({ userId: "teacher-1", schoolId: "school-1", schoolYearId: "year-1", status: "active" }) },
    ] });
    expect(onTeachers).not.toHaveBeenCalled();
    firestore.subscriptions[1].next({ docs: [
      { id: "teacher-1", data: () => ({ name: "Alice Mukendi", email: "alice@example.test", role: "teacher", schoolId: "school-1", status: "active" }) },
    ] });
    expect(onTeachers).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "profile-1", userId: "teacher-1", fullName: "Alice Mukendi" }),
    ]);
    firestore.subscriptions[1].next({ docs: [] });
    expect(onTeachers).toHaveBeenLastCalledWith([]);
  });

  it("transmet les périodes et les erreurs puis désabonne toutes les écoutes", () => {
    const onPeriods = vi.fn();
    const onError = vi.fn();
    const unsubscribes = subscribe({ onPeriods, onError });
    firestore.subscriptions[7].next({ docs: [{ id: "period-1", data: () => ({ type: "course", active: true }) }] });
    expect(onPeriods).toHaveBeenCalledWith([{ id: "period-1", type: "course", active: true }]);
    const failure = new Error("listener failed");
    firestore.subscriptions[6].error(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    unsubscribes.forEach((unsubscribe) => unsubscribe());
    expect(firestore.subscriptions.every(({ unsubscribe }) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it("refuse les paramètres incomplets avant de créer un listener", () => {
    expect(() => subscribe({ schoolYearId: "" })).toThrow("Périmètre pédagogique non autorisé.");
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });

  it("fusionne l'identité users avec le profil pédagogique sans casser les anciens teachers", () => {
    const profiles = [
      { id: "profile-new", userId: "teacher-user", schoolId: "school-1", schoolYearId: "year-1", status: "active" },
      { id: "profile-archived", userId: "inactive", schoolId: "school-1", schoolYearId: "year-1", status: "active" },
      { id: "legacy", schoolId: "school-1", schoolYearId: "year-1", firstName: "Ancien", lastName: "Profil", fullName: "Ancien Profil", status: "active" },
    ] as never[];
    const users = [
      { id: "teacher-user", name: "Alice Mukendi", email: "alice@example.test", phone: "0990000000", role: "teacher", schoolId: "school-1", status: "active" },
      { id: "inactive", name: "Inactif", email: "inactive@example.test", role: "teacher", schoolId: "school-1", status: "inactive" },
      { id: "other-role", name: "Caissier", email: "cashier@example.test", role: "cashier", schoolId: "school-1", status: "active" },
    ] as AppUser[];
    expect(mergeStudyTeachers(profiles, users)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "profile-new", fullName: "Alice Mukendi", email: "alice@example.test", phone: "0990000000" }),
      expect.objectContaining({ id: "profile-archived", fullName: "Inactif", status: "inactive" }),
      expect.objectContaining({ id: "legacy", fullName: "Ancien Profil" }),
    ]));
  });
});
