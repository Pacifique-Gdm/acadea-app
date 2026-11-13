import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./auth", () => ({ getCurrentFirebaseIdToken: async () => "local-unit-token" }));
vi.mock("../config/apiUrl", () => ({ resolveApiUrl: (path: string) => path }));
import { AllocationApiError, allocationRequest, loadAllocationWorkspace, saveAllocationDrafts } from "./feeAllocation";
afterEach(() => vi.unstubAllGlobals());
describe("transport préparatoire sans succès optimiste", () => {
  const page = (index: number, fingerprint = "a".repeat(64)) => ({ operational: false, school: { id: "s" }, year: { id: "y" }, currency: "USD", fees: [], configs: [],
    ledger: { movements: [{ id: `m${index}` }], pagination: { page: index, pages: 2, total: 2, fingerprint } } });
  it("n'expose le registre qu'après toutes ses pages cohérentes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page(0)))).mockResolvedValueOnce(new Response(JSON.stringify(page(1))));
    vi.stubGlobal("fetch", fetch);
    const workspace = await loadAllocationWorkspace("s");
    expect(workspace.ledger?.movements.map(m => m.id)).toEqual(["m0", "m1"]);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ schoolId: "s", ledgerPage: 1, ledgerFingerprint: "a".repeat(64) });
  });
  it.each(["changed", "duplicate", "missing", "network"])("ne renvoie aucun total partiel si une page est %s", async kind => {
    const second = page(1, kind === "changed" ? "b".repeat(64) : "a".repeat(64));
    if (kind === "duplicate") second.ledger.movements = [{ id: "m0" }];
    if (kind === "missing") second.ledger.movements = [];
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(page(0))));
    if (kind === "network") fetch.mockRejectedValueOnce(new TypeError("network")); else fetch.mockResolvedValueOnce(new Response(JSON.stringify(second)));
    vi.stubGlobal("fetch", fetch);
    await expect(loadAllocationWorkspace("s")).rejects.toThrow();
  });
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
