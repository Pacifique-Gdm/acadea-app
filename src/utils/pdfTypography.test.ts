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

  it("force le chemin par graphèmes tout en réservant l'espace entre les mots", () => {
    const source = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8");
    expect(source).toContain("letter-spacing: 0.01px !important");
    expect(source).toContain("word-spacing: 0.12em !important");
    expect(source).not.toContain("setCharSpace");
    expect(source).not.toContain("getTextWidth");
    expect(source).not.toContain("splitTextToSize");
  });
});
