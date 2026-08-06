import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("exports PDF filtrés du Secrétaire", () => {
  const source = readFileSync(new URL("./secretaryListPdf.ts", import.meta.url), "utf8");

  it("utilise exclusivement les lignes reçues et exclut la colonne Action", () => {
    expect(source).toContain("rows, school, year, filters");
    expect(source).toContain('correspondence: "LISTE DES COURRIERS"');
    expect(source).toContain('reports: "LISTE DES RAPPORTS"');
    expect(source.match(/centerDocumentTitle: true/g)).toHaveLength(2);
    expect(source).toContain('label: "NOMBRE DE RÉSULTATS", value: String(rows.length)');
    expect(source).not.toContain('header: "ACTION"');
    expect(source).not.toContain('header: "ACTIONS"');
  });

  it("refuse de générer un document vide", () => {
    expect(source).toContain("Aucun courrier ne correspond aux filtres actifs.");
    expect(source).toContain("Aucun rapport ne correspond aux filtres actifs.");
  });
});
