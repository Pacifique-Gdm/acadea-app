import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { feeAllocationPdfSections } from "./feeAllocationPdf";
import type { AllocationRow } from "./feeAllocationView";

// Version 1.20.1 : les en-têtes de colonnes du PDF ne sont jamais coupés au milieu d'un mot (« OUVERTU / RE »).
const pdfCss = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
const row = (table: 1 | 2): AllocationRow => ({ key: `${table}`, schoolId: "s", schoolName: "École fictive", yearName: "2026-2027", feeName: "Minerval", table, rubricId: "p",
  classLabel: "1ère", currency: "USD", rubricName: "Part du Promoteur", amountMinor: 4000, percent: 0, config: {} as AllocationRow["config"], stale: false,
  financial: { receivedMinor: 4000, spentMinor: 0, availableMinor: 4000, openingMinor: 0, arrearsMinor: 0, cumulativeReceivedMinor: 4000, cumulativeSpentMinor: 0, formerMinor: 0 } });
/** Largeur utile du tableau dans le PDF A4 (688 px de rendu moins les marges de la section). */
const TABLE_PX = 652;
/** Largeur d'une lettre majuscule grasse d'en-tête (9,5 px) avec une marge de sécurité, plus les marges de la cellule. */
const fits = (word: string, percent: number) => word.length * 7 + 10 <= (percent / 100) * TABLE_PX;
const decode = (text: string) => text.replace(/&#0?39;|&rsquo;/g, "’").replace(/&amp;/g, "&");

describe("PDF « Répartition des frais » : en-têtes sans mot coupé", () => {
  for (const period of [false, true]) it(`chaque mot de chaque en-tête tient dans sa colonne, dans les 3 tableaux (filtre ${period ? "période" : "frais"})`, () => {
    const sections = feeAllocationPdfSections([row(1), row(2)], "Frais : Tous les frais", "", period);
    expect(sections).toHaveLength(3);
    for (const html of sections) {
      const widths = [...html.matchAll(/<col style="width:([\d.]+)%" \/>/g)].map((m) => Number(m[1]));
      const headers = [...html.matchAll(/<th[^>]*><span class="cell-inner">([^<]*)<\/span><\/th>/g)].map((m) => decode(m[1]));
      expect(headers).toHaveLength(7);
      expect(widths).toHaveLength(7);
      headers.forEach((header, i) => { for (const word of header.split(/\s+/)) expect(fits(word, widths[i]), `« ${word} » dans « ${header} » (${widths[i]} %)`).toBe(true); });
    }
  });
  it("les en-têtes passent à la ligne seulement entre deux mots (pas de coupure au milieu)", () => {
    expect(pdfCss).toContain(".acadea-pdf .fee-allocation-table-pdf-section th, .acadea-pdf .fee-allocation-table-pdf-section th * { overflow-wrap: normal; word-break: keep-all; }");
  });
});
