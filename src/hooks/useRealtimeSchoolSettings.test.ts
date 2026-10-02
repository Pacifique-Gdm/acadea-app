import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  doc: vi.fn((_db: unknown, collection: string, id: string) => ({ collection, id })),
}));

vi.mock("../firebase", () => ({ db: { kind: "firestore" }, firebaseReady: true }));
vi.mock("firebase/firestore", () => ({
  doc: mocks.doc,
  onSnapshot: mocks.onSnapshot,
}));

import { canSubscribeToRealtimeSchoolSettings, subscribeToRealtimeSchoolSettings } from "./useRealtimeSchoolSettings";
import type { AppUser } from "../types";

const user = (role: AppUser["role"], schoolId = "school-a") => ({ id: "user-a", email: "a@example.invalid", role, schoolId, status: "active" }) as AppUser;

describe("useRealtimeSchoolSettings", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.onSnapshot.mockReturnValue(vi.fn()); });

  it("réserve l'écoute aux rôles scolaires de leur propre école", () => {
    expect(canSubscribeToRealtimeSchoolSettings(user("school_admin"), "school-a")).toBe(true);
    expect(canSubscribeToRealtimeSchoolSettings(user("secretary"), "school-a")).toBe(true);
    expect(canSubscribeToRealtimeSchoolSettings(user("school_admin"), "school-b")).toBe(false);
    for (const role of ["cashier", "study_director", "discipline_director", "teacher", "parent"] as const) {
      expect(canSubscribeToRealtimeSchoolSettings(user(role), "school-a")).toBe(true);
      expect(canSubscribeToRealtimeSchoolSettings(user(role), "school-b")).toBe(false);
    }
  });

  it("normalise et transmet l'école reçue en temps réel", () => {
    const onSchool = vi.fn();
    subscribeToRealtimeSchoolSettings({ kind: "firestore" } as never, user("school_admin"), "school-a", onSchool);
    const callback = mocks.onSnapshot.mock.calls[0][1] as (snapshot: { id: string; exists: () => boolean; data: () => unknown }) => void;
    callback({ id: "school-a", exists: () => true, data: () => ({ name: "École A", schoolOptions: ["Scientifique", "Sciences"] }) });
    expect(onSchool).toHaveBeenCalledWith(expect.objectContaining({ id: "school-a", schoolOptions: ["Sciences"] }));
  });
});
