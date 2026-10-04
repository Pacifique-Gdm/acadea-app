import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const control = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const students = readFileSync(new URL("./CoordinationStudents.tsx", import.meta.url), "utf8");
const portal = readFileSync(new URL("./CoordinationPortal.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./useCoordinationControlPage.ts", import.meta.url), "utf8");

describe("disposition des filtres Coordination et Sous-coordination", () => {
  it("retire uniquement la recherche de Contrôle et neutralise la requête cachée", () => {
    expect(control).not.toContain('aria-label="Rechercher un élève dans le contrôle"');
    expect(page).toContain('search: ""');
    expect(page).not.toContain('setSearch');
    expect(students).toContain('placeholder="Rechercher"');
  });

  it("place la carte École/Année avant le titre Contrôle en deux colonnes", () => {
    expect(control.indexOf('aria-label="Filtrer par école"')).toBeLessThan(control.indexOf('aria-label="Année scolaire"'));
    expect(control.indexOf('aria-label="Année scolaire"')).toBeLessThan(control.indexOf('<SectionTitle title="Contrôle"'));
    expect(control).toContain('grid-cols-2 gap-2 rounded border border-blue-100');
  });

  it("maintient la carte Élèves avant son titre avec les deux filtres côte à côte", () => {
    expect(students.indexOf('aria-label="Filtrer par école"')).toBeLessThan(students.indexOf('aria-label="Année scolaire"'));
    expect(students.indexOf('aria-label="Année scolaire"')).toBeLessThan(students.indexOf('<h2 className="text-lg font-bold">Élèves'));
    expect(students).toContain('grid-cols-2 gap-2 rounded border border-blue-100');
    expect(portal).toContain('tab !== "control" && tab !== "students"');
  });

  it("étend la bande institutionnelle tout en bornant son contenu", () => {
    expect(portal).toContain('className="sticky top-0 z-20 w-full border-b');
    expect(portal).toContain('className="mx-auto flex max-w-6xl flex-wrap');
    expect(portal).toContain('className="mx-auto grid max-w-6xl gap-4 px-4 py-5"');
  });
});
