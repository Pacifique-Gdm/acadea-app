import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("diagramme financier Administrateur", () => {
  const source = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
  it("affiche le titre simplifié et la couleur calculée des impayés", () => {
    expect(source).toContain('aria-label="Répartition des montants"');
    expect(source).toContain(">Répartition des montants</h3>");
    expect(source).not.toContain("Répartition des montants encaissés");
    expect(source).not.toContain("Par type de frais, selon les filtres et la période sélectionnés.");
    expect(source).toContain("row.color ?? feeShareColors");
  });
});
