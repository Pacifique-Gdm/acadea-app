import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { studyDirectorTabs } from "../../components/layout/studyDirectorNavigation";

describe("portail Directeur des études — phase 1", () => {
  it("expose les cinq onglets dont Élèves en lecture seule", () => {
    expect(studyDirectorTabs.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "dashboard", label: "Dashboard" },
      { id: "teachers", label: "Enseignants" },
      { id: "students", label: "Élèves" },
      { id: "schedules", label: "Horaires" },
      { id: "menu", label: "Menu" },
    ]);
    expect(studyDirectorTabs).toHaveLength(5);
  });

  it("réutilise le drawer d’homogénéité avec le périmètre multi-sections", () => {
    const source = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain("<StudyStudentsModule");
    expect(source).toContain("<AgeHomogeneityDrawer");
    expect(source).toContain("allowedSections={userSectionIds(user)}");
  });

  it("branche l’onglet Horaires sur le module Phase 4 sans OR-Tools", () => {
    const source = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('activeTab === "schedules"');
    expect(source).toContain("<StudySchedulesModule");
    expect(source).not.toContain("disponibles dans une prochaine phase");
    expect(source).not.toContain("OR-Tools");
  });
});
