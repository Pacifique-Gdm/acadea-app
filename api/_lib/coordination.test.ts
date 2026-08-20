import { describe, expect, it, vi } from "vitest";
import { activeCoordinationSchoolIds, chunks, requireActiveCoordinator } from "./coordination.js";

function coordinatorDb(profile: Record<string, unknown>, coordination: Record<string, unknown>) {
  return {
    doc: vi.fn((path: string) => ({
      get: vi.fn(async () => ({ exists: true, data: () => path.startsWith("users/") ? profile : coordination })),
    })),
  };
}

describe("sécurité serveur Coordination", () => {
  it("valide simultanément claim, profil actif et Coordination active", async () => {
    const auth = { verifyIdToken: vi.fn(async () => ({ uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a" })) };
    const db = coordinatorDb({ role: "coordination_admin", coordinationId: "coord-a", active: true }, { status: "active" });
    await expect(requireActiveCoordinator(auth, db, "token")).resolves.toMatchObject({ uid: "coord-user", coordinationId: "coord-a" });
  });

  it("refuse un rôle, un profil ou une Coordination inactive", async () => {
    const wrongRole = { verifyIdToken: vi.fn(async () => ({ uid: "user", role: "school_admin", coordinationId: "coord-a" })) };
    await expect(requireActiveCoordinator(wrongRole, coordinatorDb({}, {}), "token")).rejects.toMatchObject({ statusCode: 403 });
    const coordinatorAuth = { verifyIdToken: vi.fn(async () => ({ uid: "coord-user", role: "coordination_admin", coordinationId: "coord-a" })) };
    await expect(requireActiveCoordinator(coordinatorAuth, coordinatorDb({ role: "coordination_admin", coordinationId: "coord-a", active: false }, { status: "active" }), "token")).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveCoordinator(coordinatorAuth, coordinatorDb({ role: "coordination_admin", coordinationId: "coord-a", active: true }, { status: "inactive" }), "token")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("calcule le périmètre depuis les seules relations actives et dédupliquées", async () => {
    const get = vi.fn(async () => ({ docs: [
      { data: () => ({ schoolId: "school-a", active: true }) },
      { data: () => ({ schoolId: "school-a", active: true }) },
      { data: () => ({ schoolId: "school-b", active: false }) },
    ] }));
    const db = { collection: vi.fn(() => ({ where: vi.fn(() => ({ get })) })) };
    await expect(activeCoordinationSchoolIds(db, "coord-a")).resolves.toEqual(["school-a"]);
  });

  it("borne les requêtes in à trente identifiants", () => {
    expect(chunks(Array.from({ length: 65 }, (_, index) => `school-${index}`))).toHaveLength(3);
    expect(chunks(Array.from({ length: 65 }, (_, index) => `school-${index}`)).map((batch: string[]) => batch.length)).toEqual([30, 30, 5]);
  });
});
