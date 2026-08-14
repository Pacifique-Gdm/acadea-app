import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, name: string) => ({ name })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({ field, operator, value })),
  query: vi.fn((source: unknown, ...filters: unknown[]) => ({ source, filters })),
  onSnapshot: vi.fn(() => vi.fn()),
}));
vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("@firebase/firestore", () => firestore);

import { INTERNAL_PERSONNEL_ROLES, isArchivedPersonnel, isInternalPersonnel, normalizePersonnelSnapshot, personnelDisplayName, personnelIdentity, subscribeToSchoolPersonnel } from "./personnel";

const admin = { id: "admin-a", name: "Admin", email: "admin@test", role: "school_admin", schoolId: "school-a", status: "active" } as AppUser;

describe("service Personnels", () => {
  beforeEach(() => vi.clearAllMocks());

  it("utilise une liste explicite des rôles internes et exclut Parent", () => {
    expect(INTERNAL_PERSONNEL_ROLES).toEqual(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]);
    expect(isInternalPersonnel(admin)).toBe(true);
    expect(isInternalPersonnel({ ...admin, role: "parent" })).toBe(false);
  });

  it("reconnaît les deux représentations historiques d’un compte archivé", () => {
    expect(isArchivedPersonnel({ ...admin, status: "inactive" })).toBe(true);
    expect(isArchivedPersonnel({ ...admin, active: false })).toBe(true);
    expect(isArchivedPersonnel(admin)).toBe(false);
  });

  it("écoute en temps réel uniquement les personnels internes de l’école", () => {
    expect(subscribeToSchoolPersonnel({ user: admin, schoolId: "school-a", onData: vi.fn(), onError: vi.fn() })).toBeTypeOf("function");
    expect(firestore.query).toHaveBeenCalledWith(expect.anything(),
      { field: "schoolId", operator: "==", value: "school-a" },
      { field: "role", operator: "in", value: [...INTERNAL_PERSONNEL_ROLES] },
    );
  });

  it("déduplique strictement une même identité Auth par UID sans fusionner deux homonymes", () => {
    const homonym = { ...admin, id: "admin-b", email: "other@test" };
    expect(normalizePersonnelSnapshot([admin, { ...admin }, homonym]).map((item) => item.id)).toEqual(["admin-a", "admin-b"]);
  });

  it("ne masque pas deux UID distincts portant le même email", () => {
    expect(normalizePersonnelSnapshot([admin, { ...admin, id: "admin-b" }])).toHaveLength(2);
  });

  it("préserve le nom complet legacy sans inventer un postnom ou un prénom", () => {
    expect(personnelIdentity({ ...admin, name: "Kabeya Ilunga Alice" })).toEqual({ lastName: "Kabeya Ilunga Alice", middleName: "", firstName: "" });
  });

  it("recompose le nom canonique depuis les trois champs administratifs", () => {
    const identity = personnelIdentity(admin, { lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice" });
    expect(identity).toEqual({ lastName: "Kabeya", middleName: "Ilunga", firstName: "Alice" });
    expect(personnelDisplayName(identity)).toBe("Kabeya Ilunga Alice");
  });

  it("refuse avant réseau un autre rôle, une autre école ou un administrateur archivé", () => {
    for (const user of [{ ...admin, role: "secretary" }, { ...admin, schoolId: "school-b" }, { ...admin, active: false }] as AppUser[]) {
      subscribeToSchoolPersonnel({ user, schoolId: "school-a", onData: vi.fn(), onError: vi.fn() });
    }
    expect(firestore.onSnapshot).not.toHaveBeenCalled();
  });
});
