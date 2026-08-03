import { describe, expect, it } from "vitest";
import { DEFAULT_PDF_SETTINGS, getPdfLayout, getPdfLineHeight, normalizePdfSettings, resolvePdfFont } from "./pdfSettings";

describe("réglages PDF canoniques", () => {
  it("utilise les valeurs par défaut pour un ancien document", () => {
    expect(normalizePdfSettings()).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it("normalise chaque valeur inconnue", () => {
    expect(normalizePdfSettings({ fontFamily: "Calibri", fontSize: 20, lineSpacing: 3, pageSize: "A3" } as never)).toEqual(DEFAULT_PDF_SETTINGS);
  });

  it.each([["Arial", "Arial"], ["Times New Roman", "Times New Roman"]] as const)("résout la police %s", (font, expected) => {
    expect(resolvePdfFont(font)).toContain(expected);
  });

  it.each([9, 14] as const)("applique la taille %s pt", (fontSize) => {
    expect(getPdfLayout({ ...DEFAULT_PDF_SETTINGS, fontSize }).settings.fontSize).toBe(fontSize);
  });

  it.each([1, 1.15, 1.5, 2] as const)("applique l'interligne %s", (lineSpacing) => {
    expect(getPdfLineHeight({ ...DEFAULT_PDF_SETTINGS, lineSpacing })).toBe(lineSpacing);
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
