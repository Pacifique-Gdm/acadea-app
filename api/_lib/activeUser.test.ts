import { describe, expect, it, vi } from "vitest";
import { requireActiveApiUser, verifyActorIdToken } from "./activeUser.js";

function database(profile: Record<string, unknown> | undefined) {
  return { doc: vi.fn(() => ({ get: vi.fn(async () => ({ exists: Boolean(profile), data: () => profile })) })) };
}

describe("profil actif pour les API Vercel", () => {
  const caller = { uid: "user-a", role: "super_admin" };

  it.each([
    { status: "active", active: true },
    { role: "super_admin" },
  ])("accepte un compte actif moderne ou legacy", async (profile) => {
    const db = database(profile);
    await expect(requireActiveApiUser(db, caller)).resolves.toBe(caller);
    expect(db.doc).toHaveBeenCalledWith("users/user-a");
  });

  it.each([
    { status: "inactive", active: true },
    { status: "active", active: false },
    undefined,
  ])("refuse un profil inactif ou absent malgré un ancien token", async (profile) => {
    await expect(requireActiveApiUser(database(profile), caller)).rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
  });

  it("refuse les API métier d'une école suspendue sans bloquer la supervision", async () => {
    const db = { doc: vi.fn((path: string) => ({ get: vi.fn(async () => ({ exists: true, data: () => path.startsWith("schools/") ? { status: "suspended" } : path === "users/super-a" ? { role: "super_admin", status: "active" } : { role: "school_admin", schoolId: "school-a", status: "active" } })) })) };
    await expect(requireActiveApiUser(db, { uid: "admin-a", role: "school_admin", schoolId: "school-a" })).rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    await expect(requireActiveApiUser(db, { uid: "super-a", role: "super_admin" })).resolves.toMatchObject({ role: "super_admin" });
  });

  it("refuse un ancien jeton après transfert ou changement de rôle", async () => {
    const db = { doc: vi.fn((path: string) => ({ get: vi.fn(async () => ({
      exists: true,
      data: () => path.startsWith("schools/") ? { status: "active" } : { role: "secretary", schoolId: "school-b", status: "active", active: true },
    })) })) };
    await expect(requireActiveApiUser(db, { uid: "user-a", role: "secretary", schoolId: "school-a" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveApiUser(db, { uid: "user-a", role: "cashier", schoolId: "school-b" })).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveApiUser(db, { uid: "user-a", role: "secretary", schoolId: "school-b" })).resolves.toMatchObject({ schoolId: "school-b" });
  });

  it("refuse les anciens identifiants de parent ou de coordination", async () => {
    await expect(requireActiveApiUser(database({ role: "parent", schoolId: "school-a", parentId: "parent-new" }), {
      uid: "user-a", role: "parent", schoolId: "school-a", parentId: "parent-old",
    })).rejects.toMatchObject({ statusCode: 403 });
    await expect(requireActiveApiUser(database({ role: "coordination_admin", coordinationId: "coord-new" }), {
      uid: "user-a", role: "coordination_admin", coordinationId: "coord-old",
    })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("jeton d'acteur API", () => {
  it.each(["auth/argument-error", "auth/invalid-id-token", "auth/id-token-expired", "auth/id-token-revoked", "auth/user-disabled"])("répond 401 pour %s", async (code) => {
    const auth = { verifyIdToken: vi.fn().mockRejectedValue(Object.assign(new Error("Invalid token"), { code })) };
    await expect(verifyActorIdToken(auth, "invalid")).rejects.toMatchObject({ statusCode: 401, code: "unauthenticated" });
    expect(auth.verifyIdToken).toHaveBeenCalledWith("invalid", true);
  });

  it("préserve les erreurs d'infrastructure", async () => {
    const error = Object.assign(new Error("Service unavailable"), { code: "auth/internal-error" });
    await expect(verifyActorIdToken({ verifyIdToken: vi.fn().mockRejectedValue(error) }, "token")).rejects.toBe(error);
  });
});


describe("section administrators release gate", () => {
  it.each(["kindergarten_admin", "primary_admin", "studies_prefect"])("rejects %s with current or stale privileged claims", async role => {
    const profile = { role, status: "active", schoolId: "school-a", sectionIds: ["Primaire"] };
    for (const claimRole of [role, "school_admin", "super_admin"]) {
      await expect(requireActiveApiUser(database(profile), { uid: "section-admin", role: claimRole, schoolId: "school-a" }))
        .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
    }
    await expect(requireActiveApiUser(database({ ...profile, role: "school_admin" }), { uid: "section-admin", role, schoolId: "school-a" }))
      .rejects.toMatchObject({ statusCode: 403, code: "permission-denied" });
  });
});
