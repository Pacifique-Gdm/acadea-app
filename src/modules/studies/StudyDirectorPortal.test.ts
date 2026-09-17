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
    expect(source).toContain("<StudentsModule");
    expect(source).toContain("<StudentDetailPage");
    expect(source).toContain("canLinkParent={false}");
    expect(source).toContain("canCreate: false");
    expect(source).toContain("canEdit: false");
    expect(source).toContain("canArchive: false");
    expect(source).toContain("canReactivate: false");
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

  it("place la messagerie dans le Menu juste après l’Assistant IA", () => {
    const source = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    expect(source).toContain('setDrawer("messages")');
    expect(source).toContain('<MessagesModule');
    expect(source).toContain("<StudyAiAssistant");
  });

  it("expose la création et la gestion des seuls personnels enseignants", () => {
    const source = readFileSync(new URL("./StudyDirectorPortal.tsx", import.meta.url), "utf8");
    const creation = readFileSync(new URL("./StudyTeacherManagement.tsx", import.meta.url), "utf8");
    expect(source).toContain("Créer enseignant");
    expect(source).toContain("Personnels enseignants");
    expect(source).toContain('<StudyTeacherCreateContent');
    expect(source).toContain('allowedRoles={["teacher"]}');
    expect(creation).toContain('role: "teacher"');
    expect(creation).toContain('schoolId: school.id');
    expect(creation).toContain('schoolYearId: year.id');
    expect(creation).toContain('<PasswordField');
  });
});
