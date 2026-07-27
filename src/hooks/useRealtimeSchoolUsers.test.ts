import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const mocks = vi.hoisted(() => ({ collection: vi.fn(() => "users"), where: vi.fn((field, op, value) => ({ field, op, value })), query: vi.fn((...parts) => ({ parts })), onSnapshot: vi.fn() }));
vi.mock("@firebase/firestore", () => mocks);
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));

import { reconcileRealtimeSchoolUsers, subscribeToRealtimeSchoolUsers } from "./useRealtimeSchoolUsers";

const account = (id: string, role: AppUser["role"], overrides: Partial<AppUser> = {}): AppUser => ({ id, name: id, email: `${id}@test.local`, role, schoolId: "school-a", status: "active", ...overrides });

describe("utilisateurs d'école en temps réel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("réconcilie tous les rôles et les changements de statut", () => {
    const incoming = [account("admin", "school_admin"), account("parent", "parent"), account("cashier", "cashier"), account("discipline", "discipline_director"), account("inactive", "cashier", { status: "inactive" })];
    const result = reconcileRealtimeSchoolUsers([account("removed", "school_admin"), account("global", "super_admin", { schoolId: undefined })], incoming, "school-a");
    expect(result.map((item) => item.id)).toEqual(["global", "admin", "parent", "cashier", "discipline", "inactive"]);
  });

  it("écoute uniquement l'école ouverte et nettoie le listener", () => {
    const unsubscribe = vi.fn();
    mocks.onSnapshot.mockReturnValue(unsubscribe);
    const superAdmin = account("super", "super_admin", { schoolId: undefined });
    const stop = subscribeToRealtimeSchoolUsers({} as never, superAdmin, "school-a", vi.fn());
    expect(mocks.where).toHaveBeenCalledWith("schoolId", "==", "school-a");
    expect(mocks.onSnapshot).toHaveBeenCalledOnce();
    stop?.();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("refuse un utilisateur non Super Administrateur", () => {
    expect(subscribeToRealtimeSchoolUsers({} as never, account("admin", "school_admin"), "school-a", vi.fn())).toBeUndefined();
    expect(mocks.onSnapshot).not.toHaveBeenCalled();
  });
});
