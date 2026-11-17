// Lot « répartition rapide » — un seul chargement, affichage immédiat, rechargement seulement sur vrai changement.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const tokens: Record<string, string> = { s1: "t1", s2: "t2" };
let version = 1;
vi.mock("./feeAllocation", () => ({
  allocationRequest: vi.fn(async (action: string, body: { schoolId: string }) => { calls.push(`${action}:${body.schoolId}`); return { schoolId: body.schoolId, token: tokens[body.schoolId] }; }),
  loadAllocationWorkspace: vi.fn(async (schoolId: string) => { calls.push(`get-workspace:${schoolId}`); return { school: { id: schoolId }, version }; }),
}));
const store = await import("./feeAllocationStore");
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) });

beforeEach(() => { calls.length = 0; store.forgetAllocationSnapshots(); memory.clear(); tokens.s1 = "t1"; tokens.s2 = "t2"; version = 1; });
const workspaceLoads = () => calls.filter((c) => c.startsWith("get-workspace")).length;

describe("lot répartition rapide — cache du drawer dans l'onglet", () => {
  it("avant : rechargement complet à chaque ouverture ; après : une seule fois, puis une simple vérification", async () => {
    await store.loadAllocationSnapshot("u", ["s1", "s2"]);
    expect(workspaceLoads()).toBe(2);
    calls.length = 0;
    const kept = store.peekAllocationSnapshot("u", ["s2", "s1"]);
    expect(kept?.workspaces).toHaveLength(2); // affichage immédiat, dans n'importe quel ordre d'écoles
    expect(await store.allocationSnapshotIsCurrent(kept!)).toBe(true);
    expect(workspaceLoads()).toBe(0);
    expect(calls).toEqual(["get-forecast-revision:s1", "get-forecast-revision:s2"]);
  });
  it("l'empreinte est lue AVANT les données (jamais une donnée plus ancienne que son empreinte)", async () => {
    await store.loadAllocationSnapshot("u", ["s1"]);
    expect(calls).toEqual(["get-forecast-revision:s1", "get-workspace:s1"]);
  });
  it("un paiement, une dépense ou une correction (empreinte changée) : la vérification le voit", async () => {
    const kept = await store.loadAllocationSnapshot("u", ["s1", "s2"]);
    tokens.s2 = "t2-bis";
    expect(await store.allocationSnapshotIsCurrent(kept)).toBe(false);
  });
  it("deux demandes simultanées (préchargement et ouverture) ne lisent qu'une fois ; un rechargement forcé relit", async () => {
    const [a, b] = await Promise.all([store.loadAllocationSnapshot("u", ["s1"]), store.loadAllocationSnapshot("u", ["s1"])]);
    expect(a).toBe(b);
    expect(workspaceLoads()).toBe(1);
    version = 2;
    const first = store.loadAllocationSnapshot("u", ["s1"]);
    const forced = store.loadAllocationSnapshot("u", ["s1"], true);
    expect(forced).not.toBe(first);
    await Promise.all([first, forced]);
    expect((store.peekAllocationSnapshot("u", ["s1"])!.workspaces[0] as unknown as { version: number }).version).toBe(2);
  });
  it("chaque compte a ses propres données ; la déconnexion efface tout", async () => {
    await store.loadAllocationSnapshot("u", ["s1"]);
    expect(store.peekAllocationSnapshot("autre", ["s1"])).toBeNull();
    store.forgetAllocationSnapshots();
    expect(store.peekAllocationSnapshot("u", ["s1"])).toBeNull();
  });
  it("sans empreinte (ancien serveur), les données ne sont jamais considérées à jour", async () => {
    delete (tokens as Record<string, string | undefined>).s1;
    const kept = await store.loadAllocationSnapshot("u", ["s1"]);
    expect(await store.allocationSnapshotIsCurrent(kept)).toBe(false);
  });
  it("préchargement à la connexion seulement pour un compte qui utilise déjà ce drawer (pas de lectures en plus)", async () => {
    store.prefetchAllocationSnapshot("u", ["s1"]);
    expect(calls).toEqual([]);
    store.rememberAllocationUse("u");
    store.prefetchAllocationSnapshot("u", ["s1"]);
    await store.pendingAllocationSnapshot("u", ["s1"]);
    expect(workspaceLoads()).toBe(1);
    store.prefetchAllocationSnapshot("u", ["s1"]);
    expect(workspaceLoads()).toBe(1);
  });
});
