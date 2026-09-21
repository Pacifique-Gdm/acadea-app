import { describe, expect, it } from "vitest";
import type { TeacherPortalData } from "./teacherPortalData";
import { applyTeacherSnapshot } from "./useTeacherPortalData";

const state = (error: string): TeacherPortalData => ({
  assignments: [], subjects: [], classes: [], rooms: [], periods: [], entries: [], loading: false, error,
});

describe("machine d’état du portail Enseignant", () => {
  it("efface une erreur de snapshot local vide dès que le profil serveur valide arrive", () => {
    const next = applyTeacherSnapshot(state("Aucun profil pédagogique n’est lié à ce compte Enseignant."), {
      id: "teacher-1", schoolId: "school-1", schoolYearId: "year-1", userId: "user-1", firstName: "Enseignant", lastName: "E2E", fullName: "Enseignant E2E", status: "active", createdAt: "2026-01-01", updatedAt: "2026-01-01", createdBy: "admin-1",
    });

    expect(next.teacher?.id).toBe("teacher-1");
    expect(next.error).toBe("");
  });

  it("ne masque pas l’erreur lorsqu’aucun profil valide n’est reçu", () => {
    const current = state("Aucun profil pédagogique n’est lié à ce compte Enseignant.");
    expect(applyTeacherSnapshot(current, undefined).error).toBe(current.error);
  });
});
