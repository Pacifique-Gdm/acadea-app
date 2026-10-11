import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ data: { options: ["Sciences"] } as { options: string[] }, set: vi.fn() }));
vi.mock("../firebase", () => ({ db: { kind: "firestore" } }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  getDoc: async () => ({ exists: () => true, data: () => mocks.data }),
  runTransaction: async (_db: unknown, operation: (transaction: unknown) => Promise<unknown>) => operation({
    get: async () => ({ exists: () => true, data: () => mocks.data }),
    set: mocks.set,
  }),
}));
import { addSchoolOptionToCatalog, loadSchoolOptionCatalog } from "./schoolOptionCatalog";

describe("catalogue global des options", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.data = { options: ["Sciences"] }; });
  it("charge les options indépendamment des écoles", async () => {
    expect(await loadSchoolOptionCatalog()).toEqual(["Sciences"]);
  });
  it("ajoute transactionnellement sans sélectionner une école", async () => {
    expect(await addSchoolOptionToCatalog(" Informatique ")).toEqual(["Sciences", "Informatique"]);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ path: "platformSettings/schoolOptionsCatalog" }), expect.objectContaining({ options: ["Sciences", "Informatique"] }));
  });
  it("refuse un doublon normalisé", async () => {
    await expect(addSchoolOptionToCatalog("scientifique")).rejects.toThrow("existe déjà");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
