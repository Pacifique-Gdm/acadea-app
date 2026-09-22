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

import { persistSchoolEducationLevel, persistSchoolOption, persistSchoolSettings } from "./schoolOptionsRepository";
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

  it("ne permet pas à la sauvegarde des autres paramètres de modifier les sections", async () => {
    mocks.snapshotData = { ...school([]), educationLevels: ["Primaire", "CTEB"], schoolType: "Mixte" };
    const desired = { ...school([]), educationLevels: ["Secondaire"], schoolType: "Secondaire" } as School;
    const saved = await persistSchoolSettings(school([]), [], desired);
    expect(saved.educationLevels).toEqual(["Primaire", "CTEB"]);
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty("educationLevels");
    expect(mocks.update.mock.calls[0]?.[1]).not.toHaveProperty("schoolType");
  });

  it("coche uniquement la section demandée et conserve les autres champs", async () => {
    mocks.snapshotData = { ...school(["Initiale"]), educationLevels: ["Primaire"], schoolType: "Primaire", name: "Nom actuel" };
    const saved = await persistSchoolEducationLevel("school-a", "CTEB", false);
    expect(saved.educationLevels).toEqual(["Primaire", "CTEB"]);
    expect(saved.name).toBe("Nom actuel");
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ path: "schools/school-a" }), {
      educationLevels: ["Primaire", "CTEB"], schoolType: "Mixte",
    });
  });

  it("décoche uniquement la section demandée", async () => {
    mocks.snapshotData = { ...school([]), educationLevels: ["Primaire", "CTEB"], schoolType: "Mixte" };
    const saved = await persistSchoolEducationLevel("school-a", "CTEB", true);
    expect(saved.educationLevels).toEqual(["Primaire"]);
    expect(mocks.update).toHaveBeenCalledWith(expect.anything(), { educationLevels: ["Primaire"], schoolType: "Primaire" });
  });

  it("refuse une section devenue incohérente avant transaction, sans écriture", async () => {
    mocks.snapshotData = { ...school([]), educationLevels: ["Primaire", "CTEB"], schoolType: "Mixte" };
    await expect(persistSchoolEducationLevel("school-a", "CTEB", false)).rejects.toThrow("a changé");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuse de décocher la dernière section, sans écriture", async () => {
    mocks.snapshotData = { ...school([]), educationLevels: ["Primaire"], schoolType: "Primaire" };
    await expect(persistSchoolEducationLevel("school-a", "Primaire", true)).rejects.toThrow("au moins une section");
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
