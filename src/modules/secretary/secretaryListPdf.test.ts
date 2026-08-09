import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { secretaryListPdfTitle } from "./secretaryListPdf";

describe("exports PDF filtrés du Secrétaire", () => {
  const source = readFileSync(new URL("./secretaryListPdf.ts", import.meta.url), "utf8");

  it("utilise exclusivement les lignes reçues et exclut la colonne Action", () => {
    expect(source).toContain("rows, school, year, filters");
    expect(source).toContain('correspondence: "LISTE DES COURRIERS"');
    expect(source).toContain('reports: "LISTE DES RAPPORTS"');
    expect(source.match(/centerDocumentTitle: true/g)).toHaveLength(2);
    expect(secretaryListPdfTitle("correspondence")).toBe("LISTE DES COURRIERS");
    expect(secretaryListPdfTitle("reports")).toBe("LISTE DES RAPPORTS");
    expect(source).toContain('label: "NOMBRE DE RÉSULTATS", value: String(rows.length)');
    expect(source).not.toContain('header: "ACTION"');
    expect(source).not.toContain('header: "ACTIONS"');
  });

  it("utilise le style partagé de titre centré avec un espacement naturel", () => {
    const pdfSource = readFileSync(new URL("../../utils/pdf.ts", import.meta.url), "utf8");
    expect(pdfSource).toContain(".document-title--center h2");
    expect(pdfSource).toContain("word-spacing: 0.12em !important");
    expect(pdfSource).toContain("letter-spacing: normal !important");
    expect(pdfSource).toContain("white-space: nowrap");
    expect(pdfSource).toContain("overflow-wrap: normal");
  });

  it("refuse de générer un document vide", () => {
    expect(source).toContain("Aucun courrier ne correspond aux filtres actifs.");
    expect(source).toContain("Aucun rapport ne correspond aux filtres actifs.");
  });
});
