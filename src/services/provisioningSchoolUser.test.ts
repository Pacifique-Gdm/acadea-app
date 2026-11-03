import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: vi.fn().mockResolvedValue("token-for-test") }));

import { provisionSchoolAdmin, provisionSchoolUser } from "./provisioning";

describe("provisionSchoolUser", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("transmet le mot de passe proposé ou personnalisé sans l'ajouter au profil", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "user-1", role: "cashier", phone: "0991234567" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await provisionSchoolUser({
      role: "cashier",
      schoolId: "school-1",
      schoolYearId: "year-1",
      name: "Utilisateur test",
      email: "generated@example.invalid",
      password: "custom-password",
      phone: "0991234567",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(payload.password).toBe("custom-password");
    expect(payload.password).not.toBe(payload.phone);
    expect(result).not.toHaveProperty("password");
  });

  it("transmet le rôle teacher au provisioning existant", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: "teacher-1", role: "teacher", schoolId: "school-1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await provisionSchoolUser({ role: "teacher", schoolId: "school-1", schoolYearId: "year-1", name: "Enseignant Test", email: "enseignant001@example.invalid", password: "0991234567", phone: "0991234567" });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ role: "teacher" });
  });

  it("retrouve l'accusé serveur après la perte de la réponse sans recréer le compte", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ user: { id: "confirmed-user", role: "secretary" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await provisionSchoolUser({ role: "secretary", schoolId: "school-1", schoolYearId: "year-1", name: "Secrétaire", email: "lost-response@example.invalid", password: "test-password", phone: "0991234567" });
    expect(result.id).toBe("confirmed-user");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, string>;
    const recovery = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, string>;
    expect(recovery).toMatchObject({ action: "recover-creation", clientRequestId: first.clientRequestId });
    expect(first.clientRequestId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("ne confond pas un refus réel avec un succès et ne relance aucune création", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Action refusée." }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(provisionSchoolUser({ role: "teacher", schoolId: "school-2", schoolYearId: "year-1", name: "Enseignant", email: "refused@example.invalid", password: "test-password", phone: "0991234567" })).rejects.toThrow("Action refusée");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("récupère l'école et son administrateur après une réponse réseau perdue", async () => {
    const result = { school: { id: "school-confirmed" }, schoolYear: { id: "year-confirmed" }, adminUser: { id: "admin-confirmed" }, auditLog: { id: "audit-confirmed" } };
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => result });
    vi.stubGlobal("fetch", fetchMock);
    expect((await provisionSchoolAdmin({ schoolName: "École fictive", adminName: "Administrateur", adminEmail: "admin-lost@example.invalid", adminPassword: "test-password" })).school.id).toBe("school-confirmed");
    const first = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, string>;
    const recovery = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)) as Record<string, string>;
    expect(recovery).toMatchObject({ action: "recover-creation", clientRequestId: first.clientRequestId, schoolName: "École fictive" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
