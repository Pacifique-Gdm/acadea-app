import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUser } from "../types";

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
}));

vi.mock("../firebase", () => ({ db: {}, firebaseReady: true }));
vi.mock("@firebase/firestore", () => ({
  collection: (_db: unknown, name: string) => name,
  query: (name: string) => name,
  where: () => ({}),
  doc: () => ({}),
  getDoc: vi.fn(),
  getDocs: firestore.getDocs,
}));

import { loadSuperAdminInitialData } from "./superAdminData";

const user = { id: "super-1", role: "super_admin", name: "Test" } as AppUser;

describe("chargement Super Admin", () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.getDocs.mockImplementation(async (name: string) => ({
      docs: name === "schools" ? [{ id: "school-1", data: () => ({ name: "École test", schoolOptions: [] }) }] : [],
    }));
  });

  it("lot SA-2b : l'ouverture ne charge plus aucune école ni aucune année (chargées à la demande)", async () => {
    const { data } = await loadSuperAdminInitialData(user.id, user);
    expect(data.schools).toHaveLength(0);
    expect(data.schoolYears).toHaveLength(0);
    expect(data.users).toHaveLength(1);
  });

  it("lot SA-3 : les chiffres viennent du serveur, chargés à part des écoles, et leurs erreurs restent visibles", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const platform = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    const service = readFileSync(new URL("./superAdminData.ts", import.meta.url), "utf8");
    expect(service).not.toContain("getCountFromServer");
    expect(app.indexOf("void reloadPlatformStats(forcePlatformStats)")).toBeLessThan(app.indexOf("await loadSuperAdminInitialData(bootstrapUser.id"));
    expect(app).toContain("setData(firestoreData)");
    expect(app).toContain("setPlatformLoadError(");
    expect(platform).toContain('<ErrorNotice error={platformLoadError}');
    expect(platform).toContain('platformStats?.students ?? "—"');
  });

  it("lot SA-3 : la carte « Écoles » ne compte plus la liste chargée (écoles supprimées comprises)", () => {
    const platform = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(platform).not.toContain("value={data.schools.length}");
    expect(platform).toContain('const totalSchools = platformStats?.schools.total ?? "—"');
    expect(platform).toContain('<PlatformCard label="Écoles" value={totalSchools}');
    expect(platform).toContain('total={platformStats?.schools.total ?? "—"}');
    expect(platform).toContain('total={coordinationsLoaded ? coordinations.length : "—"}');
  });

  it("lot SA-3 : « Actualiser » demande un recalcul, une action sur une école relit les chiffres", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const platform = readFileSync(new URL("../modules/platform/PlatformModule.tsx", import.meta.url), "utf8");
    expect(app).toContain("onRefresh={() => { platformStatsForceRef.current = true; setBootstrapRetry((value) => value + 1); }}");
    expect(app).toContain("onSchoolsChanged={() => void reloadPlatformStats()}");
    expect(platform.match(/onSchoolsChanged\?\.\(\);/g)).toHaveLength(3);
  });
});
