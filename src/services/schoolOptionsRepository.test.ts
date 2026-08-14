import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  snapshotData: {} as unknown,
}));

vi.mock("../firebase", () => ({ db: { kind: "firestore" } }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, operation: (transaction: unknown) => Promise<unknown>) => operation({
    get: vi.fn().mockResolvedValue({ exists: () => true, data: () => mocks.snapshotData }),
    update: mocks.update,
    set: mocks.set,
  }),
}));

import { persistSchoolOption, persistSchoolSettings } from "./schoolOptionsRepository";
import type { School } from "../types";

const school = (schoolOptions: string[]): School => ({
  id: "school-a", schoolId: "school-a", name: "École A", address: "", phone: "", email: "a@example.invalid",
  activeSchoolYearId: "year-a", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0, schoolOptions,
});

describe("schoolOptionsRepository", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.snapshotData = school(["Initiale"]); });

  it("persiste Sciences une seule fois à partir de l'alias historique", async () => {
    mocks.snapshotData = school(["Sciences"]);
    const result = await persistSchoolOption("school-a", " SCIENTIFIQUE ");
    expect(result).toEqual({ option: "Sciences", schoolOptions: ["Sciences"] });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), { schoolOptions: ["Sciences"] });
  });

  it("préserve l'ajout concurrent du Secrétaire pendant la sauvegarde Admin", async () => {
    mocks.snapshotData = school(["Initiale", "Ajout secrétaire"]);
    const saved = await persistSchoolSettings(school(["Initiale"]), ["Initiale"], school(["Initiale", "Ajout admin"]));
    expect(saved.schoolOptions).toEqual(["Initiale", "Ajout secrétaire", "Ajout admin"]);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), expect.objectContaining({
      schoolOptions: ["Initiale", "Ajout secrétaire", "Ajout admin"],
    }));
  });
});
