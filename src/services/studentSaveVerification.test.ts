import { describe, expect, it, vi } from "vitest";
import type { Student } from "../types";

vi.mock("../firebase", () => ({ db: undefined }));

import { findSavedStudent } from "./studentSaveVerification";

const saved = { id: "student-1", schoolId: "school-a", schoolYearId: "year-a", nom: "TEST" } as Student;

describe("vérification d'une inscription après coupure réseau", () => {
  it("confirme l'élève quand la fiche existe dans l'école et l'année demandées", async () => {
    await expect(findSavedStudent("student-1", "school-a", "year-a", async () => saved)).resolves.toEqual(saved);
  });

  it("répond « non enregistré » si la fiche est absente ou si les règles refusent un document absent", async () => {
    await expect(findSavedStudent("student-1", "school-a", "year-a", async () => null)).resolves.toBeNull();
    await expect(findSavedStudent("student-1", "school-a", "year-a", async () => { throw { code: "permission-denied", message: "Missing or insufficient permissions." }; })).resolves.toBeNull();
  });

  it("ne confirme jamais une fiche d'une autre école ou d'une autre année", async () => {
    await expect(findSavedStudent("student-1", "school-b", "year-a", async () => saved)).resolves.toBeNull();
    await expect(findSavedStudent("student-1", "school-a", "year-b", async () => saved)).resolves.toBeNull();
  });

  it("répond « impossible à vérifier » tant que la connexion est coupée", async () => {
    await expect(findSavedStudent("student-1", "school-a", "year-a", async () => { throw { code: "unavailable", message: "Failed to get document because the client is offline." }; })).resolves.toBeUndefined();
  });
});
