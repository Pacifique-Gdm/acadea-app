import { describe, expect, it } from "vitest";
import { teacherTabs } from "../../components/layout/teacherNavigation";

describe("navigation Enseignant Phase 3", () => {
  it("contient exactement les quatre onglets autorisés dans l'ordre demandé", () => {
    expect(teacherTabs.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "dashboard", label: "Tableau de bord" },
      { id: "courses", label: "Mes cours" },
      { id: "schedule", label: "Mon horaire" },
      { id: "menu", label: "Menu" },
    ]);
  });
});
