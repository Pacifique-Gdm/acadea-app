import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allocationConfigured, noAllocationConfigured, noAllocationConfiguredShort, projectAllocations } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationWorkspace } from "../services/feeAllocation";

const message = "Aucune répartition n'est encore configurée. Cliquez sur « + Ajouter » pour commencer.";
const short = "Aucune répartition n'est encore configurée.";
const drawer = readFileSync(new URL("../modules/menu/FeeAllocationDrawer.tsx", import.meta.url), "utf8");
// École fictive sans aucune répartition : le prévu existe déjà, entièrement « Non affecté ».
function workspace(configured: boolean): AllocationWorkspace {
  return {
    school: { id: "school", name: "École fictive", activeSchoolYearId: "year" }, year: { id: "year", schoolId: "school", name: "2027-2028", status: "active", startsAt: null, endsAt: null },
    currency: "USD", canConfigure: true, operational: false,
    fees: [{ id: "minerval", name: "Minerval", className: "1ère", classOptionKey: null, amount: 100 }],
    configs: configured ? [{ id: "c", schoolId: "school", schoolYearId: "year", feeTypeId: "minerval", className: "1ère", currency: "USD", draftRevision: 1 }] : [],
    forecast: { status: "complete", revision: null, calculatedAt: "", studentCount: 1, rows: [{ feeTypeId: "minerval", className: "1ère", classOptionKey: null, table: 1,
      rubricId: "__unallocated", rubricName: "Non affecté", amountMinor: 10000, studentsCount: 1, rubricShare: 10000, tariffMinor: 10000, rubricMode: null, basisPoints: null }] },
  } as unknown as AllocationWorkspace;
}
const pdf = (configured: boolean, canAdd = true) => {
  const w = workspace(configured);
  return feeAllocationPdfSections(projectAllocations([w], { kind: "fee", value: "", from: "", to: "" }), "Tous les frais", "École fictive · 2027-2028 · USD", false,
    { configured: allocationConfigured([w]), canAdd }).join("");
};

describe("aucune répartition configurée : ni tableaux ni « Non affecté » (21/11)", () => {
  it("le message exact est partagé par l'écran et le PDF", () => {
    expect(noAllocationConfigured(true)).toBe(message);
    expect(noAllocationConfigured(false)).toBe(short);
    expect(noAllocationConfiguredShort).toBe(short);
    expect(allocationConfigured([workspace(false)])).toBe(false);
    expect(allocationConfigured([workspace(true)])).toBe(true);
  });
  it("écran : message à la place des tableaux, tableaux seulement si une répartition existe", () => {
    expect(drawer).toContain("{ready && !configured && <p role=\"status\" data-no-allocation>{noAllocationConfigured(configurable)}</p>}");
    expect(drawer).toContain("const hasConfiguration = configured && ");
    expect(drawer).toMatch(/\{ready && hasConfiguration && projection\.rows\.length > 0 && \(staffView/);
    expect(drawer).toContain("configured: allocationConfigured(fresh), canAdd: configurable");
  });
  it("PDF sans répartition : le message, sans tableau ni « Non affecté »", () => {
    const html = pdf(false);
    const text = html.replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&laquo;|&raquo;/g, (e) => e === "&laquo;" ? "«" : "»");
    expect(text).toContain(message);
    expect(html).not.toMatch(/Tableau [123]|Non affecté/);
  });
  it("sans bouton « + Ajouter » : seulement la première phrase, à l'écran comme dans le PDF", () => {
    const text = pdf(false, false).replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
    expect(text).toContain(short);
    expect(text).not.toContain("Cliquez sur");
    expect(text).not.toMatch(/Tableau [123]|Non affecté/);
  });
  it("PDF avec une répartition : les tableaux reviennent", () => {
    const html = pdf(true);
    expect(html).toContain("Tableau 1 — Élèves normalement inscrits");
    expect(html).not.toContain("Aucune répartition n");
  });
});
