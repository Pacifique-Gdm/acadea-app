import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Le module API Vercel est volontairement implémenté en JavaScript côté serveur.
import { setSchoolAdminStatus } from "../../api/provision-school-account.js";

function createBackend(options: { profile?: Record<string, unknown>; commitError?: Error } = {}) {
  const update = vi.fn();
  const create = vi.fn();
  const commit = options.commitError ? vi.fn().mockRejectedValue(options.commitError) : vi.fn().mockResolvedValue(undefined);
  const adminRef = { get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ id: "admin-1", role: "school_admin", schoolId: "school-1", status: "active", ...options.profile }) }) };
  const db = {
    doc: vi.fn(() => adminRef),
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: "audit-1" })) })),
    batch: vi.fn(() => ({ update, create, commit })),
  };
  const auth = { updateUser: vi.fn().mockResolvedValue(undefined), revokeRefreshTokens: vi.fn().mockResolvedValue(undefined) };
  return { auth, db, update, create, commit };
}
const superAdmin = { uid: "super-1", role: "super_admin", email: "super@example.test" };
const body = (status: string, overrides: Record<string, unknown> = {}) => ({ action: "set-school-admin-status", schoolId: "school-1", adminId: "admin-1", status, ...overrides });

describe("désactivation réelle d'un administrateur d'école", () => {
  it("coupe le compte, marque le profil inactif puis révoque les sessions", async () => {
    const backend = createBackend();
    const result = await setSchoolAdminStatus({ ...backend, caller: superAdmin, body: body("inactive") });
    expect(result).toMatchObject({ adminId: "admin-1", status: "inactive", authStatus: "disabled" });
    expect(backend.auth.updateUser).toHaveBeenCalledWith("admin-1", { disabled: true });
    expect(backend.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "inactive", active: false, deactivatedBy: "super-1" }));
    expect(backend.update.mock.calls[0][1]).not.toHaveProperty("schoolId");
    expect(backend.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ eventType: "user.disabled", resourceId: "admin-1" }));
    expect(backend.auth.revokeRefreshTokens).toHaveBeenCalledWith("admin-1");
    expect(backend.auth.revokeRefreshTokens.mock.invocationCallOrder[0]).toBeGreaterThan(backend.commit.mock.invocationCallOrder[0]);
  });

  it("réactive le compte sans révoquer de session", async () => {
    const backend = createBackend({ profile: { status: "inactive", active: false } });
    const result = await setSchoolAdminStatus({ ...backend, caller: superAdmin, body: body("active") });
    expect(result).toMatchObject({ status: "active", authStatus: "enabled" });
    expect(backend.auth.updateUser).toHaveBeenCalledWith("admin-1", { disabled: false });
    expect(backend.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "active", active: true }));
    expect(backend.auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it.each([
    ["un directeur d'école", { uid: "admin-x", role: "school_admin", schoolId: "school-1" }, body("inactive")],
    ["un coordinateur", { uid: "coord-1", role: "coordination_admin" }, body("inactive")],
    ["un statut inconnu", superAdmin, body("suspended")],
    ["un champ en trop", superAdmin, body("inactive", { role: "super_admin" })],
    ["son propre compte", { ...superAdmin, uid: "admin-1" }, body("inactive")],
  ])("refuse %s sans toucher au compte", async (_label, caller, request) => {
    const backend = createBackend();
    await expect(setSchoolAdminStatus({ ...backend, caller, body: request })).rejects.toBeInstanceOf(Error);
    expect(backend.auth.updateUser).not.toHaveBeenCalled();
    expect(backend.commit).not.toHaveBeenCalled();
  });

  it("refuse un administrateur d'une autre école ou un autre rôle", async () => {
    for (const profile of [{ schoolId: "school-2" }, { role: "cashier" }]) {
      const backend = createBackend({ profile });
      await expect(setSchoolAdminStatus({ ...backend, caller: superAdmin, body: body("inactive") })).rejects.toThrow("hors de cette ecole");
      expect(backend.auth.updateUser).not.toHaveBeenCalled();
    }
  });

  it("ne réactive pas un administrateur retiré définitivement", async () => {
    const backend = createBackend({ profile: { status: "inactive", removedAt: "2026-11-01T00:00:00.000Z" } });
    await expect(setSchoolAdminStatus({ ...backend, caller: superAdmin, body: body("active") })).rejects.toThrow("retire");
    expect(backend.auth.updateUser).not.toHaveBeenCalled();
  });

  it("rouvre le compte Auth si l'écriture du profil échoue, sans révoquer", async () => {
    const backend = createBackend({ commitError: new Error("commit failed") });
    await expect(setSchoolAdminStatus({ ...backend, caller: superAdmin, body: body("inactive") })).rejects.toThrow("commit failed");
    expect(backend.auth.updateUser).toHaveBeenNthCalledWith(2, "admin-1", { disabled: false });
    expect(backend.auth.revokeRefreshTokens).not.toHaveBeenCalled();
  });

  it("le bouton de la plateforme passe par le serveur au lieu de réécrire les utilisateurs depuis le navigateur", () => {
    const source = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(source).toContain("await setSchoolAdminStatus({ schoolId: admin.schoolId");
    expect(source).not.toContain("users: data.users.map((item) => (item.id === admin.id ? { ...item, status: nextStatus } : item)),");
  });
});
