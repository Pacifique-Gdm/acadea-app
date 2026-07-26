import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Le module API Vercel est volontairement implémenté en JavaScript côté serveur.
import { removeSchoolAdmin } from "../../api/provision-school-account.js";

function createBackend(options?: { commitError?: Error }) {
  const update = vi.fn();
  const set = vi.fn();
  const commit = options?.commitError ? vi.fn().mockRejectedValue(options.commitError) : vi.fn().mockResolvedValue(undefined);
  const adminRef = {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ id: "admin-1", name: "Admin Test", role: "school_admin", schoolId: "school-1" }),
    }),
  };
  const db = {
    doc: vi.fn(() => adminRef),
    collection: vi.fn(() => ({ doc: vi.fn(() => ({ id: "audit-1" })) })),
    batch: vi.fn(() => ({ update, set, commit })),
  };
  const auth = { updateUser: vi.fn().mockResolvedValue(undefined) };
  return { auth, db, update, set, commit };
}

describe("API de retrait d'un administrateur", () => {
  it("refuse un appel provenant d'un utilisateur non Super Administrateur", async () => {
    const backend = createBackend();
    await expect(removeSchoolAdmin({
      ...backend,
      caller: { uid: "school-admin", role: "school_admin" },
      body: { schoolId: "school-1", adminId: "admin-1", confirmation: "SUPPRIMER ADMINISTRATEUR" },
    })).rejects.toThrow("Super Administrateur");
    expect(backend.auth.updateUser).not.toHaveBeenCalled();
  });

  it("refuse une confirmation non strictement identique", async () => {
    const backend = createBackend();
    await expect(removeSchoolAdmin({
      ...backend,
      caller: { uid: "super-1", role: "super_admin" },
      body: { schoolId: "school-1", adminId: "admin-1", confirmation: "SUPPRIMER ADMINISTRATEUR " },
    })).rejects.toThrow("Confirmation");
    expect(backend.auth.updateUser).not.toHaveBeenCalled();
  });

  it("desactive Auth et conserve le document avec son rattachement historique", async () => {
    const backend = createBackend();
    const result = await removeSchoolAdmin({
      ...backend,
      caller: { uid: "super-1", role: "super_admin", email: "super@example.test" },
      body: { schoolId: "school-1", adminId: "admin-1", confirmation: "SUPPRIMER ADMINISTRATEUR" },
    });
    expect(backend.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(backend.auth.updateUser).toHaveBeenCalledWith("admin-1", { disabled: true });
    expect(backend.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "inactive", removedBy: "super-1",
    }));
    expect(backend.update.mock.calls[0][1]).not.toHaveProperty("schoolId");
    expect(backend.commit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ adminId: "admin-1", status: "inactive", authStatus: "disabled" });
  });

  it("reactive Auth si l'ecriture Firestore echoue", async () => {
    const backend = createBackend({ commitError: new Error("Firestore indisponible") });
    await expect(removeSchoolAdmin({
      ...backend,
      caller: { uid: "super-1", role: "super_admin" },
      body: { schoolId: "school-1", adminId: "admin-1", confirmation: "SUPPRIMER ADMINISTRATEUR" },
    })).rejects.toThrow("Firestore indisponible");
    expect(backend.auth.updateUser).toHaveBeenNthCalledWith(1, "admin-1", { disabled: true });
    expect(backend.auth.updateUser).toHaveBeenNthCalledWith(2, "admin-1", { disabled: false });
  });
});
