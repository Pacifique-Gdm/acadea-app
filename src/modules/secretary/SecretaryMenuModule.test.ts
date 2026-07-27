import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Menu du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryMenuModule.tsx", import.meta.url), "utf8");

  it("propose les listes administratives sans statistique financière", () => {
    for (const label of ["Liste générale", "Liste par classe", "Nouvelles inscriptions", "Réinscriptions", "Transférés", "Archivés"]) expect(source).toContain(label);
    expect(source).not.toContain("payments");
    expect(source).not.toContain("feeTypes");
  });

  it("réutilise le PDF Élèves et exporte uniquement la liste filtrée", () => {
    expect(source).toContain("exportStudentsPdf");
    expect(source).toContain("sortStudentsForPdfByClass(visible)");
    expect(source).toContain("...visible.map");
  });

  it("expose profil, changement de mot de passe, aide, notifications et déconnexion", () => {
    expect(source).toContain("sendPasswordReset");
    expect(source).toContain("cloche de l'en-tête");
    expect(source).toContain("onLogout");
  });

  it("déplace les deux outils Élèves dans des Drawers distincts du Menu", () => {
    expect(source).toContain("Importer les élèves d’une année archivée");
    expect(source).toContain("Tableau d’homogénéité d’âge");
    expect(source).toContain("<ArchivedStudentsImportDrawer");
    expect(source).toContain("<AgeHomogeneityDrawer");
    expect(source).toContain("setImportDrawerOpen(false)");
    expect(source).toContain("setAgeDrawerOpen(false)");
  });
});
