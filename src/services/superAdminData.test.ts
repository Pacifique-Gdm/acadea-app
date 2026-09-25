import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getCountFromServer: vi.fn(),
}));

vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => name,
  query: (name: string) => name,
  where: () => ({}),
  doc: () => ({}),
  getDoc: vi.fn(),
  getDocs: firestore.getDocs,
  getCountFromServer: firestore.getCountFromServer,
}));

import { loadSuperAdminGlobalCounts, loadSuperAdminInitialData } from "./superAdminData";

const user = { id: "super-1", role: "super_admin", name: "Test" } as AppUser;

describe("chargement Super Admin", () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.getCountFromServer.mockReset();
    firestore.getDocs.mockImplementation(async (name: string) => ({
      docs: name === "schools" ? [{ id: "school-1", data: () => ({ name: "École test", schoolOptions: [] }) }] : [],
    }));
  });

  it("livre les écoles sans attendre les compteurs globaux", async () => {
    firestore.getCountFromServer.mockImplementation(() => new Promise(() => undefined));
    const { data } = await loadSuperAdminInitialData(user.id, user);
    expect(data.schools).toHaveLength(1);
    expect(firestore.getCountFromServer).not.toHaveBeenCalled();
  });

  it("isole l'échec d'un compteur des données initiales", async () => {
    firestore.getCountFromServer.mockRejectedValue(new Error("unavailable"));
    await expect(loadSuperAdminGlobalCounts()).rejects.toThrow("unavailable");
    const { data } = await loadSuperAdminInitialData(user.id, user);
    expect(data.schools).toHaveLength(1);
  });

  it("publie les écoles indépendamment des compteurs et rend leurs erreurs visibles", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const platform = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(app.indexOf("void loadSuperAdminGlobalCounts().then")).toBeLessThan(app.indexOf("await loadSuperAdminInitialData(bootstrapUser.id"));
    expect(app).toContain("setData(firestoreData)");
    expect(app).toContain("setPlatformLoadError(");
    expect(platform).toContain('{platformLoadError && <p role="alert"');
    expect(platform).toContain('platformCounts?.students ?? "—"');
  });
});
