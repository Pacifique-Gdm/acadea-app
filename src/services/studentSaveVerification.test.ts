import { describe, expect, it, vi } from "vitest";
import type { Student } from "../types";

vi.mock("../firebase", () => ({ db: undefined }));

import { discardUploadedPhotoIfUnused, findSavedStudent } from "./studentSaveVerification";
import { readFileSync } from "node:fs";

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

describe("photo envoyée pour une inscription qui a échoué (lot 9)", () => {
  const path = "schools/school-a/student-photos/student-1/123e4567-e89b-42d3-a456-426614174000.jpg";
  const target = { path, studentId: "student-1", schoolId: "school-a", schoolYearId: "year-a" };
  it("garde la photo si la fiche l'utilise (le serveur a enregistré malgré l'erreur)", async () => {
    const remove = vi.fn();
    expect(await discardUploadedPhotoIfUnused(target, { read: async () => ({ ...saved, photoPath: path }), remove })).toBe("kept");
    expect(remove).not.toHaveBeenCalled();
  });
  it("garde la photo tant que la vérification est impossible (réponse incertaine, hors ligne)", async () => {
    const remove = vi.fn();
    expect(await discardUploadedPhotoIfUnused(target, { read: async () => { throw { code: "unavailable", message: "offline" }; }, remove })).toBe("kept");
    expect(remove).not.toHaveBeenCalled();
  });
  it("ne retire la photo qu'après confirmation qu'aucune fiche ne l'utilise", async () => {
    const remove = vi.fn();
    expect(await discardUploadedPhotoIfUnused(target, { read: async () => null, remove })).toBe("deleted");
    expect(await discardUploadedPhotoIfUnused(target, { read: async () => ({ ...saved, photoPath: "schools/school-a/student-photos/student-1/ancienne.jpg" }), remove })).toBe("deleted");
    expect(remove).toHaveBeenCalledTimes(2);
  });
  it("l'écran Élèves ne supprime plus la photo directement après une erreur", () => {
    const source = readFileSync(new URL("../modules/students/StudentsModule.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("void deleteStudentPhoto(uploadedPhotoPath)");
    expect(source).toContain("discardUploadedPhotoIfUnused(");
  });
});
