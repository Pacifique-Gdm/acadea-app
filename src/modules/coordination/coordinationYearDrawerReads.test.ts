import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Compteur des lectures Firestore : chaque getDocs = une requête lue par le téléphone.
const reads = vi.hoisted(() => ({ getDocs: 0, server: 0 }));
vi.mock("../../firebase", () => ({ db: {}, auth: { currentUser: { uid: "u1" } } }));
vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => name,
  where: () => ({}),
  limit: () => ({}),
  startAfter: () => ({}),
  query: (name: string) => name,
  getDocs: async () => { reads.getDocs += 1; return { docs: [] }; },
}));

import { loadCoordinationReadModel } from "../../services/coordinationReadModel";
import { coordinationYearStatusCache, coordinationYearStatusKey, type CoordinationSchoolYearStatus } from "../../services/coordinationSchoolYears";
import { createLoadCache } from "../../utils/loadCache";

const menu = readFileSync(new URL("./CoordinationMenu.tsx", import.meta.url), "utf8");
const archiveDrawer = readFileSync(new URL("../../components/archive/SchoolYearArchiveDrawer.tsx", import.meta.url), "utf8");
const status: CoordinationSchoolYearStatus = { rows: [{ schoolId: "s1", schoolName: "École", activeYear: { id: "y1", name: "2026-2027" } }], referenceYear: "2026-2027", governance: null };
const loadStatus = async () => { reads.server += 1; return status; };

beforeEach(() => { reads.getDocs = 0; reads.server = 0; coordinationYearStatusCache.clear(); });

describe("tiroir « Année scolaire » : ouverture sans rechargement", () => {
  it("AVANT : chaque ouverture relisait tout le modèle de la coordination (9 requêtes Firestore pour une école) et rappelait le serveur", async () => {
    for (let opening = 0; opening < 3; opening += 1) { await loadCoordinationReadModel("c1", ["s1"]); await loadStatus(); }
    expect(reads.getDocs).toBe(27); // 3 ouvertures × 9 requêtes
    expect(reads.server).toBe(3);
  });

  it("APRÈS : le tiroir ne lit plus le modèle ; l'état des années est lu une fois, puis affiché tout de suite", async () => {
    const key = coordinationYearStatusKey({ uid: "u1", coordinationId: "c1", refreshToken: 0 });
    for (let opening = 0; opening < 3; opening += 1) {
      const shown = coordinationYearStatusCache.peek(key) ?? await coordinationYearStatusCache.load(key, loadStatus);
      expect(shown.referenceYear).toBe("2026-2027");
    }
    expect(reads.getDocs).toBe(0);
    expect(reads.server).toBe(1);
  });

  it("recharge seulement sur un vrai changement : bouton Actualiser ou autre compte", async () => {
    await coordinationYearStatusCache.load(coordinationYearStatusKey({ uid: "u1", coordinationId: "c1", refreshToken: 0 }), loadStatus);
    await coordinationYearStatusCache.load(coordinationYearStatusKey({ uid: "u1", coordinationId: "c1", refreshToken: 1 }), loadStatus);
    await coordinationYearStatusCache.load(coordinationYearStatusKey({ uid: "u2", coordinationId: "c1", refreshToken: 1 }), loadStatus);
    expect(reads.server).toBe(3);
  });

  it("le Menu de la coordination ne lance plus la lecture du modèle pour le tiroir des années", () => {
    expect(menu).toContain('if (!drawer || drawer === "years") return undefined;');
    expect(menu).toContain("coordinationYearStatusCache.peek(yearStatusKey)");
    expect(menu).toContain("coordinationYearStatusCache.set(yearStatusKey, status);"); // après ouverture, clôture ou réactivation
  });

  it("le tiroir des archives (caissier, parent, enseignant…) garde sa liste et la relit si l'année active change", () => {
    expect(archiveDrawer).toContain("archivedYearsCache.peek(yearsKey)");
    expect(archiveDrawer).toContain("archiveSummaryCache.load(");
    expect(archiveDrawer).toContain("activeSchoolYearId");
  });
});

describe("cache de session commun", () => {
  it("deux ouvertures rapides partagent le même appel, et un échec n'est pas gardé", async () => {
    const cache = createLoadCache<number>();
    let calls = 0;
    const [a, b] = await Promise.all([cache.load("k", async () => { calls += 1; return 5; }), cache.load("k", async () => { calls += 1; return 6; })]);
    expect([a, b, calls]).toEqual([5, 5, 1]);
    await expect(cache.load("x", async () => { throw new Error("réseau"); })).rejects.toThrow("réseau");
    expect(cache.peek("x")).toBeUndefined();
    expect(await cache.load("x", async () => 7)).toBe(7);
  });

  it("garde un nombre limité d'entrées", () => {
    const cache = createLoadCache<number>(2);
    cache.set("a", 1); cache.set("b", 2); cache.set("c", 3);
    expect([cache.peek("a"), cache.peek("b"), cache.peek("c")]).toEqual([undefined, 2, 3]);
  });
});
