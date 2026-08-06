import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: vi.fn().mockResolvedValue("token-for-test") }));

import { provisionSchoolUser } from "./provisioning";

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
});
