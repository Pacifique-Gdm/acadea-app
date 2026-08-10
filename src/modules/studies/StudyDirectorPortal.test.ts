import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { studyDirectorTabs } from "../../components/layout/studyDirectorNavigation";

describe("portail Directeur des études — phase 1", () => {
  it("expose exactement les quatre onglets demandés dans le bon ordre", () => {
    expect(studyDirectorTabs.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "dashboard", label: "Dashboard" },
      { id: "teachers", label: "Enseignants" },
      { id: "schedules", label: "Horaires" },
      { id: "menu", label: "Menu" },
    ]);
    expect(studyDirectorTabs).toHaveLength(4);
  });

  it("branche l’onglet Horaires sur le module Phase 4 sans OR-Tools", () => {
    const source = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('activeTab === "schedules"');
    expect(source).toContain("<StudySchedulesModule");
    expect(source).not.toContain("disponibles dans une prochaine phase");
    expect(source).not.toContain("OR-Tools");
  });
});
