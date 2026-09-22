import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire Valves partagé", () => {
  const source = readFileSync(new URL("./ValvesDrawerContent.tsx", import.meta.url), "utf8");

  it("rend le bouton Publier pleine largeur pour Administrateur et Secrétaire", () => {
    expect(source).toContain('className="primary-button w-full justify-center disabled:opacity-50"');
    expect(source).toContain('editingId ? "Enregistrer" : "Publier"');
  });

  it("partage les sections actives de l'école entre Administrateur et Secrétaire", () => {
    expect(source).toContain("buildValveVisibilityChoices(school");
    expect(source).toContain("valveVisibilityChoices.map");
    expect(source).not.toContain("(Object.keys(valveVisibilityLabels) as ValveVisibility[]).map");
  });
});
