import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collection: vi.fn((_db, name) => name),
  where: vi.fn((field, op, value) => ({ field, op, value })),
  query: vi.fn((...parts) => ({ parts })),
  onSnapshot: vi.fn(),
}));

vi.mock("firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {} }));

import { useRealtimeSchoolRecords } from "./useRealtimeSchoolRecords";

const effects: Array<() => void | (() => void)> = [];
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => effects.push(effect) }));

const baseUser = { id: "user-1", name: "Test", email: "test@acadea.test", role: "school_admin", schoolId: "school-1", status: "active" } as const;

describe("useRealtimeSchoolRecords", () => {
  beforeEach(() => {
    effects.length = 0;
    mocks.onSnapshot.mockReset();
  });

  it("écoute les élèves, parents et sanctions de l'école et nettoie chaque listener", () => {
    const unsubscribes = [vi.fn(), vi.fn(), vi.fn()];
    mocks.onSnapshot.mockImplementationOnce(() => unsubscribes[0]).mockImplementationOnce(() => unsubscribes[1]).mockImplementationOnce(() => unsubscribes[2]);
    useRealtimeSchoolRecords({ user: baseUser, schoolId: "school-1", schoolYearId: "year-1", onData: vi.fn() });
    const cleanup = effects[0]();
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(3);
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "==", "school-1");
    expect(mocks.where).toHaveBeenCalledWith("schoolYearId", "==", "year-1");
    expect(typeof cleanup).toBe("function");
    cleanup?.();
    unsubscribes.forEach((unsubscribe) => expect(unsubscribe).toHaveBeenCalledOnce());
  });

  it("limite le caissier aux élèves et parents nécessaires au Dashboard", () => {
    mocks.onSnapshot.mockReturnValue(vi.fn());
    useRealtimeSchoolRecords({ user: { ...baseUser, role: "cashier" }, schoolId: "school-1", schoolYearId: "year-1", onData: vi.fn() });
    effects[0]();
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.collection).toHaveBeenCalledWith({}, "students");
    expect(mocks.collection).toHaveBeenCalledWith({}, "parents");
  });

  it("ne démarre aucune lecture sans contexte complet", () => {
    useRealtimeSchoolRecords({ user: baseUser, schoolId: "school-1", schoolYearId: "", onData: vi.fn() });
    effects[0]();
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });
});
