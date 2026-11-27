// Soldes des sous-rubriques : lignes « ↳ » dans les tableaux 1-2-3, le PDF et la vue partagée (décision du 27/11/2026).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allocationSubLines, allocationTotals, buildAllocationTables, type AllocationRow } from "./feeAllocationView";
import { feeAllocationPdfSections } from "./feeAllocationPdf";

const balance = { openingMinor: 100, subView: [
  { id: "1111111111111111", name: "Craies", mode: "percent" as const, basisPoints: 3000, receivedMinor: 300, spentMinor: 20, availableMinor: 280 },
  { id: "2222222222222222", name: "Entretien", mode: "fixed" as const, fixedMinor: 200, receivedMinor: 200, spentMinor: 0, availableMinor: 200 },
  { id: "UNALLOCATED", name: "Non affecté (Fonctionnement)", receivedMinor: 500, spentMinor: 30, availableMinor: 470 }] };
const lines = allocationSubLines(balance, "USD")!;
const financial = { receivedMinor: 900, spentMinor: 50, availableMinor: 950, openingMinor: 100, arrearsMinor: 0, cumulativeReceivedMinor: 900, cumulativeSpentMinor: 50, formerMinor: 0 };
const row = (table: 1 | 2, extra: Partial<AllocationRow> = {}) => ({ key: `school/year/${table}/r`, schoolId: "school", schoolName: "École", yearName: "2026-2027", feeName: "Rubrique commune", classLabel: "Toutes les classes",
  currency: "USD", rubricName: "Fonctionnement", amountMinor: 1000, percent: 0, config: {}, stale: false, table, rubricId: "r", financial: { ...financial }, ...extra }) as unknown as AllocationRow;

describe("lignes « ↳ » des sous-rubriques", () => {
  it("chaque sous-rubrique avec sa part, puis « Non affecté (rubrique) » qui porte l'ouverture", () => {
    expect(lines.map((l) => [l.openingMinor, l.cumulativeReceivedMinor, l.cumulativeSpentMinor, l.availableMinor])).toEqual([[null, 300, 20, 280], [null, 200, 0, 200], [100, 400, 30, 470]]);
    expect(lines[0].name).toBe("Craies (30 %)");
    expect(lines[1].name).toMatch(/^Entretien \(.*2,00.* fixe\)$/);
    expect(lines[2].name).toBe("Non affecté (Fonctionnement)");
    expect(lines.reduce((n, l) => n + l.availableMinor, 0)).toBe(950);
    expect(allocationSubLines({ openingMinor: 0 }, "USD")).toBeUndefined();
  });
  it("les lignes « ↳ » ne changent pas les totaux et suivent la rubrique dans le tableau 3", () => {
    const tables = buildAllocationTables([row(1, { subLines: lines }), row(2, { subLines: lines })]);
    expect(tables.three[0].subLines).toEqual(lines);
    expect(allocationTotals(tables.three)).toEqual(allocationTotals(buildAllocationTables([row(1), row(2)]).three));
  });
  it("PDF : lignes « ↳ » sous la rubrique, « — » pour le prévu et l'encaissé selon le filtre, totaux inchangés", () => {
    const html = feeAllocationPdfSections([row(1, { subLines: lines }), row(2, { subLines: lines })], "Frais : Tous les frais", "École · 2026-2027").join("");
    const plain = feeAllocationPdfSections([row(1), row(2)], "Frais : Tous les frais", "École · 2026-2027").join("");
    expect(html).toContain("↳ Craies (30 %)");
    expect(html).toContain("↳ Non affecté (Fonctionnement)");
    expect(html).toContain("—");
    expect((html.match(/Total USD : prévu[^<]*/g) ?? [])).toEqual(plain.match(/Total USD : prévu[^<]*/g));
    expect(plain).not.toContain("↳");
  });
  it("tableaux du drawer (et vue partagée, même tableau) : lignes « ↳ » non cliquables, situation globale seulement", () => {
    const drawer = readFileSync(new URL("../modules/menu/FeeAllocationDrawer.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("...(row.financial ? row.subLines ?? [] : []).map((sub) => <tr key={`${row.key}/${sub.id}`} data-sub-rubric-row");
    expect(drawer).toContain('<td className="border-b p-2 pl-6">↳ {sub.name}</td><td className="border-b p-2">—</td><td className="border-b p-2">—</td>');
  });
});
