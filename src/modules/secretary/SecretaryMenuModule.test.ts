import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Menu du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMenuModule.tsx", import.meta.url), "utf8");
  const adminMenuSource = readFileSync(new URL("../menu/MenuModule.tsx", import.meta.url), "utf8");

  it("conserve les outils existants et ajoute les trois accès partagés", () => {
    expect(source).not.toContain("Liste générale");
    expect(source).not.toContain("Export Excel");
    expect(source).not.toContain("Changer le mot de passe");
    expect(source).toContain("onLogout");
    expect(source).toContain("Déconnexion");
    expect(source).toContain("grid gap-3");
    for (const label of ["Importer les élèves d’une année archivée", "Tableau d’homogénéité d’âge", "Statistiques", "Fiches médicales", "Valves", "Parents / Tuteurs", "Empreintes et Cartes", "Déconnexion"]) expect(source).toContain(label);
    const positions = ["setValvesDrawerOpen(true)", "setMedicalDrawerOpen(true)", 'openBiometricView("menu")', "setParentsDrawerOpen(true)", "setAgeDrawerOpen(true)", "setStatisticsDrawerOpen(true)", "setImportDrawerOpen(true)"].map((value) => source.indexOf(value));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(source.indexOf("onClick={onLogout}")).toBeGreaterThan(positions.at(-1) ?? -1);
  });

  it("réutilise les composants Administrateur sans logique métier parallèle", () => {
    expect(source).toContain("<ValvesDrawerContent");
    expect(source).toContain("<ParentsDirectoryDrawer");
    expect(source).toContain("<ParentFormEditor");
    expect(source).toContain('onCreateParent={year.status === "active" ? () => openParentForm() : undefined}');
    expect(source).toContain('onEditParent={year.status === "active" ? (parent) => openParentForm(parent.id) : undefined}');
    expect(source).toContain('onDeleteParent={year.status === "active" ? openParentDelete : undefined}');
    expect(source).toContain("deleteParentAccount");
    expect(source).toContain("<BiometricStudentsPage");
    expect(source).toContain('canManage={year.status === "active" && user.role === "secretary" && user.status !== "inactive" && user.schoolId === school.id}');
    expect(source).toContain("school={school}");
    expect(source).toContain("year={year}");
  });

  it("accorde au Secrétaire actif de la bonne école la même interface Valves que l'Administrateur", () => {
    expect(source).toContain("<ValvesDrawerContent");
    expect(source).toContain('user.role === "secretary"');
    expect(source).toContain('user.status !== "inactive"');
    expect(source).toContain("user.schoolId === school.id");
  });

  it("ne modifie pas l'ordre des entrées équivalentes du menu Administrateur", () => {
    const positions = ['title: "Valves"', 'title: "Parents / Tuteurs"', 'title: "Empreintes et Cartes"'].map((label) => adminMenuSource.indexOf(label));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("centralise un seul listener médical, uniquement lorsque les Drawers en ont besoin", () => {
    expect(source).toContain("subscribeToStudentMedicalRecords");
    expect(source).toContain("if (!statisticsDrawerOpen && !medicalDrawerOpen) return undefined");
    expect(source).toContain("<SecretaryStatisticsDrawer");
    expect(source).toContain("<SecretaryMedicalRecordsDrawer");
  });

  it("déplace les deux outils Élèves dans des Drawers distincts du Menu", () => {
    expect(source).toContain("Importer les élèves d’une année archivée");
    expect(source).toContain("Tableau d’homogénéité d’âge");
    expect(source).toContain("<ArchivedStudentsImportDrawer");
    expect(source).toContain("<AgeHomogeneityDrawer");
    expect(source).toContain("setImportDrawerOpen(false)");
    expect(source).toContain("setAgeDrawerOpen(false)");
  });

  it("reprend exactement le style du bouton Déconnexion Administrateur", () => {
    expect(source).toContain('className="inline-flex w-full items-center justify-center gap-2 rounded border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 transition hover:bg-red-100"');
  });
});
