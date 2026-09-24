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
