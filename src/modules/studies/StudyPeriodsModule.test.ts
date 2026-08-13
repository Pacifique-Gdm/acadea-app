import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Périodes & tranches horaires — présentation", () => {
  const source = readFileSync(
    new URL("./StudyPeriodsModule.tsx", import.meta.url),
    "utf8",
  );

  it("ne répète pas le titre déjà porté par le drawer", () => {
    expect(source).not.toContain("<h2");
    expect(source).not.toContain(">Périodes & tranches horaires</");
  });

  it("affiche le bouton d'ajout sur toute la largeur", () => {
    expect(source).toContain(
      'className="primary-button w-full justify-center"',
    );
    expect(source).toContain("Ajouter une période");
  });

  it("rend l'éditeur avant le bouton d'ajout et conserve une fermeture explicite", () => {
    expect(source).toContain('data-testid="period-editor"');
    expect(source.indexOf('data-testid="period-editor"')).toBeLessThan(source.indexOf('>Ajouter une période</button>'));
    expect(source).toContain('onClick={() => setEditorOpen(false)}>Annuler</button>');
  });

  it("présente chaque période verticalement avec deux actions équilibrées", () => {
    expect(source).toContain('className="grid min-w-0 gap-2');
    expect(source).toContain('className="grid grid-cols-2 gap-2"');
    expect(source).toContain("studyVacationLabels");
    expect(source).toContain("periodTypeLabel(item.type)");
  });
});
