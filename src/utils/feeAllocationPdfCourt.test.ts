import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectAllocations } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationWorkspace } from "../services/feeAllocation";

// Version 1.20.1 : PDF court, un tableau par page.
const drawer = readFileSync(new URL("../modules/menu/FeeAllocationDrawer.tsx", import.meta.url), "utf8");
function workspace(): AllocationWorkspace {
  return {
    school: { id: "school", name: "École fictive", activeSchoolYearId: "year" }, year: { id: "year", schoolId: "school", name: "2027-2028", status: "active", startsAt: null, endsAt: null },
    currency: "USD", canConfigure: true, operational: false,
    fees: [{ id: "minerval", name: "Minerval", className: "1ère", classOptionKey: null, amount: 100 }],
    configs: [{ id: "c", schoolId: "school", schoolYearId: "year", feeTypeId: "minerval", className: "1ère", currency: "USD", draftRevision: 1 }],
    forecast: { status: "complete", revision: null, calculatedAt: "", studentCount: 2, rows: [1, 2].map((table) => ({ feeTypeId: "minerval", className: "1ère", classOptionKey: null, table,
      rubricId: "salaires", rubricName: "Salaires", amountMinor: 6000, studentsCount: 1, rubricShare: 6000, tariffMinor: 10000, rubricMode: "percent", basisPoints: 6000 })) },
  } as unknown as AllocationWorkspace;
}
const sections = (options: Parameters<typeof feeAllocationPdfSections>[4] = {}) =>
  feeAllocationPdfSections(projectAllocations([workspace()], { kind: "fee", value: "", from: "", to: "" }), "Frais : Tous les frais", "École fictive · 2027-2028", false, options);

describe("PDF « Répartition des frais » court (1.20.1)", () => {
  it("chaque tableau commence sur une nouvelle page (le premier suit l'en-tête)", () => {
    const parts = sections();
    expect(parts).toHaveLength(3);
    expect(parts[0]).not.toContain("pdf-page-break");
    for (const part of parts.slice(1)) expect(part.trim().startsWith('<div class="pdf-page-break"')).toBe(true);
  });
  it("plus de longues explications ni de cadre d'informations ; seulement les tableaux et leurs totaux", () => {
    const html = sections().join("");
    expect(html).not.toContain("info-grid");
    expect(html).not.toMatch(/Solde disponible = ouverture|Non affecté représente|Les encaissements selon le filtre ne sont pas/);
    expect(html).toContain("Total USD : prévu");
    for (const title of ["Tableau 1", "Tableau 2", "Tableau 3"]) expect(html).toContain(title);
  });
  it("un filtre choisi : une seule ligne courte ; sinon rien", () => {
    expect(sections().join("")).not.toContain("Frais : Tous les frais");
    const filtered = sections({ filtered: true });
    expect(filtered[0]).toContain("Frais : Tous les frais");
    expect(filtered[0]).toMatch(/^<p class="fee-allocation-pdf-note"[^>]*>[^<]+<\/p>$/);
  });
  it("en-tête : l'année y figure, plus de sous-titre long", () => {
    expect(drawer).toContain("year: fresh.length === 1 ? { ...fresh[0].year,");
    expect(drawer).not.toContain("Registre rapproché — situation par établissement");
    expect(drawer).not.toContain("Configuration préparatoire — aucune disponibilité financière");
  });
});
