import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("liste des rapports du Secrétaire", () => {
  const source = readFileSync(new URL("./SecretaryReportsModule.tsx", import.meta.url), "utf8");

  it("affiche Voir, le PDF individuel et la suppression", () => {
    expect(source).toContain("Voir</button>");
    expect(source).toContain('title="Afficher le PDF"');
    expect(source).toContain('aria-label="Afficher le PDF"');
    expect(source).toContain("showReportPdf(report)");
    expect(source).toContain("Supprimer définitivement");
  });

  it("combine la recherche, le filtre de type et l'export de la liste visible", () => {
    expect(source).toContain('disabled>Types de rapport</option>');
    expect(source).toContain('<option value="all">Tous les types</option>');
    expect(source).toContain("filterSecretaryReports(reports, queryText, typeFilter || \"all\", labels)");
    expect(source).toContain("exportSecretaryReportListPdf({ rows: visible");
    expect(source).toContain("Exporter PDF");
  });
});
