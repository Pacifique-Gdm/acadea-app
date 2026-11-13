import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "local-unit-token" }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));
import { AllocationApiError, allocationRequest, loadAllocationWorkspace, saveAllocationDrafts } from "./feeAllocation";
afterEach(() => vi.unstubAllGlobals());
describe("transport préparatoire sans succès optimiste", () => {
  it("préserve le véritable rejet serveur", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "permission-denied", error: "École étrangère" }), { status: 403 })));
    await expect(allocationRequest("get-workspace", { schoolId: "other" })).rejects.toMatchObject({ status: 403, code: "permission-denied", message: "École étrangère", confirmedRejection: true });
  });
  it("ne transforme pas une réponse perdue en rejet confirmé ni en succès", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("network"); }); vi.stubGlobal("fetch", fetch);
    await expect(allocationRequest("save-drafts", { requestId: "same-request" })).rejects.toMatchObject({ confirmedRejection: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new AllocationApiError("server", 500).confirmedRejection).toBe(false);
  });
  it("refuse une réponse opérationnelle ou incomplète", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ operational: true }), { status: 200 })));
    await expect(allocationRequest("get-workspace", {})).rejects.toThrow("aucune activation");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ operational: false, configs: [] }), { status: 200 })));
    await expect(saveAllocationDrafts({ requestId: "request", schoolYearId: "y", baseFeeTypeId: "f", rubrics: [], targets: [{ feeTypeId: "f", expectedRevision: 0 }] })).rejects.toThrow("Confirmation incomplète");
  });
  it("refuse une réponse d'une autre école", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ operational: false, school: { id: "other" }, year: { id: "y" }, currency: "USD", fees: [], configs: [] }), { status: 200 })));
    await expect(loadAllocationWorkspace("s")).rejects.toThrow("Contexte");
  });
});
