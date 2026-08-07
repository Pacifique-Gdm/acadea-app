import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_SETTINGS, getPdfLayout, getPdfLineHeight, normalizePdfSettings, pdfEditorStyle, PDF_FONT_FAMILIES, PDF_FONT_SIZES, PDF_LINE_SPACINGS, resolvePdfFont } from "./pdfSettings";

describe("réglages PDF canoniques", () => {
  it("utilise les valeurs par défaut pour un ancien document", () => {
    expect(normalizePdfSettings()).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it("normalise chaque valeur inconnue", () => {
    expect(normalizePdfSettings({ fontFamily: "Comic Sans MS", fontSize: 20, lineSpacing: 4, pageSize: "A3" } as never)).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it.each(PDF_FONT_FAMILIES)("résout et applique la police professionnelle %s", (font) => {
    expect(resolvePdfFont(font)).toContain(font);
    expect(pdfEditorStyle({ ...DEFAULT_PDF_SETTINGS, fontFamily: font }).fontFamily).toBe(resolvePdfFont(font));
  });

  it.each(PDF_FONT_SIZES)("applique uniquement la taille professionnelle %s pt", (fontSize) => {
    expect(getPdfLayout({ ...DEFAULT_PDF_SETTINGS, fontSize }).settings.fontSize).toBe(fontSize);
    expect(pdfEditorStyle({ ...DEFAULT_PDF_SETTINGS, fontSize }).fontSize).toBe(`${fontSize}pt`);
  });

  it.each(PDF_LINE_SPACINGS)("applique l'interligne %s dans l'éditeur et le PDF", (lineSpacing) => {
    expect(getPdfLineHeight({ ...DEFAULT_PDF_SETTINGS, lineSpacing })).toBe(lineSpacing);
    expect(pdfEditorStyle({ ...DEFAULT_PDF_SETTINGS, lineSpacing }).lineHeight).toBe(lineSpacing);
  });

  it("refuse toute taille libre supérieure à 18 pt", () => {
    expect(normalizePdfSettings({ ...DEFAULT_PDF_SETTINGS, fontSize: 19 as never }).fontSize).toBe(12);
    expect(PDF_FONT_SIZES.at(-1)).toBe(18);
  });

  it.each([
    ["A4", 210, 297],
    ["A5", 148, 210],
    ["LETTER", 215.9, 279.4],
  ] as const)("recalcule le format %s", (pageSize, width, height) => {
    const layout = getPdfLayout({ ...DEFAULT_PDF_SETTINGS, pageSize });
    expect(layout.page).toEqual({ width, height });
    expect(layout.contentWidth).toBe(width - 28);
    expect(layout.contentHeight).toBe(height - 32);
  });
});
