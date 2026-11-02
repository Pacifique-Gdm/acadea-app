import { afterEach, describe, expect, it, vi } from "vitest";
import { FeeTypeSaveError, saveFeeTypes } from "./feeTypeMutations";

vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: vi.fn(async () => "e2e-token") }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));

const request = { schoolYearId: "year-a", requestId: "request-1234567890", fees: [{ id: "fee-1234567890", name: "Minerval", amount: 15000, className: "6ème Primaire" as const }] };

afterEach(() => vi.unstubAllGlobals());

describe("confirmation du type de frais côté client", () => {
  it("conserve l'incertitude lors d'une réponse réseau perdue ou d'un 500", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Erreur serveur" }), { status: 500 })));
    await expect(saveFeeTypes(request)).rejects.toThrow("Failed to fetch");
    await expect(saveFeeTypes(request)).rejects.toMatchObject({ confirmed: false });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body).requestId).toBe(request.requestId);
    expect(JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body).requestId).toBe(request.requestId);
  });

  it("distingue un refus confirmé d'une réponse incomplète", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Accès refusé" }), { status: 403 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 })));
    await expect(saveFeeTypes(request)).rejects.toMatchObject({ confirmed: true } satisfies Partial<FeeTypeSaveError>);
    await expect(saveFeeTypes(request)).rejects.toMatchObject({ confirmed: false } satisfies Partial<FeeTypeSaveError>);
  });
});
