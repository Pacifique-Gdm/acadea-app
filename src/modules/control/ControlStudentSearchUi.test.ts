import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/control/ControlModule.tsx", "utf8");

describe("recherche des élèves dans le Contrôle Administrateur et Caissier", () => {
  it("place la recherche immédiatement après l'export PDF dans la barre partagée", () => {
    const exportButton = source.indexOf("onClick={printFilteredStudents}");
    const searchInput = source.indexOf('aria-label="Rechercher un élève dans le contrôle"', exportButton);
    const resetButton = source.indexOf("onClick={resetControlFilters}", exportButton);

    expect(exportButton).toBeGreaterThan(-1);
    expect(searchInput).toBeGreaterThan(exportButton);
    expect(searchInput).toBeLessThan(resetButton);
  });

  it("filtre uniquement les cartes visibles et conserve les lignes PDF", () => {
    expect(source).toContain("const visibleRows = filterControlStudentRows(rows, controlStudentSearch)");
    expect(source).toContain("{visibleRows.map(({ student, balance, progress, hasApplicableFees }) => (");
    expect(source).toContain("[...rows].sort(");
    expect(source).not.toContain("[...visibleRows].sort(");
  });
});
