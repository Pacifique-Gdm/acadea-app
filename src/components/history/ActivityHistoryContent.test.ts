import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Historique responsive", () => {
  const source = readFileSync(new URL("./ActivityHistoryContent.tsx", import.meta.url), "utf8");

  it("contraint le contenu à la largeur du drawer sans tableau horizontal", () => {
    expect(source).toContain("grid w-full min-w-0 max-w-full gap-4");
    expect(source).toContain("input min-w-0 max-w-full");
    expect(source).toContain("break-words text-xs");
    expect(source).not.toContain("overflow-x-auto");
    expect(source).not.toContain("overflow-x-hidden");
    expect(source).not.toContain("<table");
  });

  it("rend des états de chargement, erreur publique sûre et vide", () => {
    expect(source).toContain("Chargement de l’historique…");
    expect(source).toContain("Impossible de charger l’historique. Veuillez réessayer.");
    expect(source).toContain("Aucune activité disponible.");
  });
});
