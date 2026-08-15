import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTwoCopyPdfHtml, pdfInfoGrid, pdfSection } from "./pdf";
import { DEFAULT_PDF_SETTINGS } from "./pdfSettings";
import type { School } from "../types";

const phrases = [
  "A B",
  "Mot un Mot deux",
  "Répartition par classe",
  "Répartition par niveau",
  "EXEMPLAIRE ÉCOLE",
  "EXEMPLAIRE PARENT",
  "EXEMPLAIRE BÉNÉFICIAIRE",
] as const;

describe("typographie du moteur PDF HTML", () => {
  it("conserve les espaces ASCII dans les contenus transmis au rasteriseur", () => {
    const html = buildTwoCopyPdfHtml({
      title: "Test espaces",
      school: { id: "school-a", name: "Établissement scolaire Acadéa" } as School,
      generatedAt: new Date("2026-08-09T00:00:00.000Z"),
      logoDataUrl: "",
      showDocumentTitle: true,
      centerDocumentTitle: false,
      sections: phrases.slice(0, 4).map((phrase) => pdfSection(phrase, pdfInfoGrid([{ label: phrase, value: phrase }]))),
      pdfSettings: DEFAULT_PDF_SETTINGS,
      renderWidth: 900,
      renderHeight: 1348,
      copyLabels: [phrases[4], phrases[5]],
    });

    for (const phrase of phrases.slice(0, 6)) expect(html).toContain(phrase);
    for (const collapsed of ["AB", "MotunMotdeux", "Répartitionparclasse", "Répartitionparniveau", "EXEMPLAIREÉCOLE", "EXEMPLAIREPARENT"]) {
      expect(html).not.toContain(collapsed);
    }
  });

  it("utilise les métriques natives du navigateur sans chemin graphème par graphème", () => {
    const source = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
    expect(source).toContain("letter-spacing: normal !important");
    expect(source).toContain("word-spacing: 0.12em !important");
    expect(source).toContain("await document.fonts.ready");
    expect(source).toContain("await document.fonts.load");
    expect(source).toContain("await html2canvas(element");
    expect(source).toContain("const renderScale = 2");
    expect(source).not.toContain("doc.html(element");
    expect(source).not.toMatch(/letter-spacing:\s*-|scaleX\s*\(/);
    expect(source).not.toContain("setCharSpace");
    expect(source).not.toContain("getTextWidth");
    expect(source).not.toContain("splitTextToSize");
  });

  it("conserve un ratio uniforme entre le canvas source et la largeur PDF", () => {
    const source = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
    expect(source).toContain("pageCanvas.width = source.width");
    expect(source).toContain("layout.contentWidth, renderedHeightMm");
    expect(source).toContain("sliceHeight / pageHeightPx * layout.contentHeight");
    expect(source).not.toContain("transform: scaleX");
    expect(source).toContain("source.width / Math.max(1, elementRect.width)");
    expect(source).toContain("source.width / layout.contentWidth");
  });

  it("protège les blocs insécables et cherche une ligne blanche avant la coupure raster", () => {
    const source = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
    expect(source).toContain("collectPdfProtectedRanges(element, sourcePixelsPerCssPixel, pageHeightPx)");
    expect(source).toContain("avoidProtectedPdfRangeCut");
    expect(source).toContain("findPdfWhitespaceCut");
    expect(source).toContain('".outgoing-signature-row"');
    expect(source).toContain('".report-signatures-block"');
    expect(source).toMatch(/\.acadea-pdf\s*\{[\s\S]*?padding:\s*0 0 12px;/);
    expect(source).toMatch(/\.pdf-page-break\s*\{[\s\S]*?padding:\s*0;/);
    expect(source).toContain("findPdfContentEnd");
  });
});
