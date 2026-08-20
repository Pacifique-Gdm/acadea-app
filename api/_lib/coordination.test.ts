import { describe, expect, it, vi } from "vitest";
import { activeCoordinationSchoolIds, chunks, requireActiveCoordinationActor, requireActiveCoordinator, resolveCoordinationSchoolScope } from "./coordination.js";

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

  it("valide les claims minimaux du Sous-coordinateur et son profil canonique", async () => {
    const auth = { verifyIdToken: vi.fn(async () => ({ uid: "sub-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" })) };
    const values = [
      { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", active: true },
      { id: "coord-a", status: "active" },
      { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "sub-user", status: "active", active: true },
    ];
    const db = { doc: vi.fn((path: string) => ({ path })), getAll: vi.fn(async () => values.map((value) => ({ exists: true, data: () => value }))) };
    await expect(requireActiveCoordinationActor(auth, db, "token")).resolves.toMatchObject({ role: "sub_coordination_admin", subCoordinationId: "sub-a" });
  });

  it("refuse un Sous-coordinateur archivé et ne confond pas son rôle avec le principal", async () => {
    const auth = { verifyIdToken: vi.fn(async () => ({ uid: "sub-user", role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" })) };
    const values = [
      { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a", active: true },
      { id: "coord-a", status: "active" },
      { id: "sub-a", coordinationId: "coord-a", coordinatorUserId: "sub-user", status: "archived", active: false },
    ];
    const db = { doc: vi.fn((path: string) => ({ path })), getAll: vi.fn(async () => values.map((value) => ({ exists: true, data: () => value }))) };
    await expect(requireActiveCoordinationActor(auth, db, "token")).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveCoordinator(auth, coordinatorDb({}, {}), "token")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("intersecte le périmètre délégué avec les écoles actives de la Coordination principale", async () => {
    const snapshots = {
      subCoordinationSchools: [
        { schoolId: "school-a", coordinationId: "coord-a", active: true },
        { schoolId: "school-b", coordinationId: "coord-a", active: true },
        { schoolId: "school-c", coordinationId: "coord-a", active: false },
      ],
      coordinationSchools: [
        { schoolId: "school-a", active: true },
        { schoolId: "school-b", active: false },
      ],
    };
    const db = {
      collection: vi.fn((name: keyof typeof snapshots) => ({ where: vi.fn(() => ({ get: vi.fn(async () => ({ docs: snapshots[name].map((value) => ({ data: () => value })) })) })) })),
      doc: vi.fn((path: string) => ({ path })),
      getAll: vi.fn(async (...refs: Array<{ path: string }>) => refs.map((ref) => ({ id: ref.path.split("/").at(-1), exists: true, data: () => ({ status: "active" }) }))),
    };
    await expect(resolveCoordinationSchoolScope(db, { role: "sub_coordination_admin", coordinationId: "coord-a", subCoordinationId: "sub-a" })).resolves.toEqual(["school-a"]);
  });
});
