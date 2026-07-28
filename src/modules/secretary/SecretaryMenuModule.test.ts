import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Menu du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMenuModule.tsx", import.meta.url), "utf8");

  it("conserve uniquement les quatre outils demandés et la déconnexion", () => {
    expect(source).not.toContain("Liste générale");
    expect(source).not.toContain("Export Excel");
    expect(source).not.toContain("Changer le mot de passe");
    expect(source).toContain("onLogout");
    expect(source).toContain("Déconnexion");
    expect(source).toContain("grid gap-3");
    for (const label of ["Importer les élèves d’une année archivée", "Tableau d’homogénéité d’âge", "Statistiques", "Fiches médicales", "Déconnexion"]) expect(source).toContain(label);
    const positions = ["setImportDrawerOpen(true)", "setAgeDrawerOpen(true)", "setStatisticsDrawerOpen(true)", "setMedicalDrawerOpen(true)", "onClick={onLogout}"].map((value) => source.indexOf(value));
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
