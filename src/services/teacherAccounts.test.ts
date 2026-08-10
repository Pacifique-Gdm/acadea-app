import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  where: vi.fn((field: string, operator: string, value: string) => ({ field, operator, value })),
  query: vi.fn((source: unknown, ...filters: unknown[]) => ({ source, filters })),
  onSnapshot: vi.fn(() => vi.fn()),
}));
vi.mock("../firebase", () => ({ db: {} }));
vi.mock("@firebase/firestore", () => firestore);

import { subscribeToSchoolTeacherAccounts } from "./teacherAccounts";

const admin = { id: "admin", role: "school_admin", schoolId: "school-a", status: "active" } as AppUser;

describe("écoute des comptes Enseignant pour le formulaire Administrateur", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filtre strictement par école et rôle teacher", () => {
    expect(subscribeToSchoolTeacherAccounts({ user: admin, schoolId: "school-a", onData: vi.fn(), onError: vi.fn() })).toBeTypeOf("function");
    expect(firestore.query).toHaveBeenCalledWith(expect.anything(),
      { field: "schoolId", operator: "==", value: "school-a" },
      { field: "role", operator: "==", value: "teacher" },
    );
  });

  it("refuse les autres rôles, écoles et comptes inactifs avant réseau", () => {
    for (const user of [
      { ...admin, role: "study_director" },
      { ...admin, schoolId: "school-b" },
      { ...admin, status: "inactive" },
    ] as AppUser[]) expect(subscribeToSchoolTeacherAccounts({ user, schoolId: "school-a", onData: vi.fn(), onError: vi.fn() })).toBeUndefined();
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });
});
