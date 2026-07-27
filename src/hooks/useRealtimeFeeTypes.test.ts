import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser, FeeType } from "../types";

const mocks = vi.hoisted(() => ({ collection: vi.fn(() => "fees"), where: vi.fn((field, op, value) => ({ field, op, value })), query: vi.fn((...parts) => ({ parts })), onSnapshot: vi.fn() }));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));

import { canSubscribeToRealtimeFeeTypes, reconcileRealtimeFeeTypes, subscribeToRealtimeFeeTypes } from "./useRealtimeFeeTypes";

const user = (role: AppUser["role"], overrides: Partial<AppUser> = {}): AppUser => ({ id: role, name: role, email: `${role}@test.local`, role, schoolId: "school-a", status: "active", ...overrides });
const fee = (id: string, overrides: Partial<FeeType> = {}): FeeType => ({ id, schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100, className: "1ère Primaire", ...overrides });

describe("types de frais en temps réel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("réconcilie création, modification et suppression sans doublon", () => {
    const result = reconcileRealtimeFeeTypes([fee("updated", { amount: 50 }), fee("deleted"), fee("foreign", { schoolId: "school-b" })], [fee("created"), fee("updated", { amount: 125 }), fee("updated", { amount: 125 })], "school-a", "year-a");
    expect(result.map((item) => item.id)).toEqual(["foreign", "created", "updated"]);
    expect(result.find((item) => item.id === "updated")?.amount).toBe(125);
  });

  it("limite l'écoute aux Administrateurs et Caissiers actifs du périmètre", () => {
    expect(canSubscribeToRealtimeFeeTypes(user("school_admin"), "school-a", "year-a")).toBe(true);
    expect(canSubscribeToRealtimeFeeTypes(user("cashier"), "school-a", "year-a")).toBe(true);
    expect(canSubscribeToRealtimeFeeTypes(user("parent"), "school-a", "year-a")).toBe(false);
    expect(canSubscribeToRealtimeFeeTypes(user("cashier", { status: "inactive" }), "school-a", "year-a")).toBe(false);
  });

  it("crée une requête école/année unique et se désabonne", () => {
    const unsubscribe = vi.fn();
    mocks.onSnapshot.mockReturnValue(unsubscribe);
    const stop = subscribeToRealtimeFeeTypes({} as never, user("cashier"), "school-a", "year-a", vi.fn());
    expect(mocks.onSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.where).toHaveBeenNthCalledWith(1, "schoolId", "==", "school-a");
    expect(mocks.where).toHaveBeenNthCalledWith(2, "schoolYearId", "==", "year-a");
    stop?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("conserve les données existantes en cas d'erreur", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail: ((error: Error) => void) | undefined;
    mocks.onSnapshot.mockImplementation((_query, _next, error) => { fail = error; return vi.fn(); });
    const onFees = vi.fn();
    subscribeToRealtimeFeeTypes({} as never, user("cashier"), "school-a", "year-a", onFees);
    fail?.(new Error("network"));
    expect(onFees).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });
});
