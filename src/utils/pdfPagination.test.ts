import { describe, expect, it } from "vitest";
import { avoidProtectedPdfRangeCut, findPdfContentEnd } from "./pdf";
import { PDF_BOTTOM_SAFE_AREA_MM } from "./pdfSettings";

describe("pagination PDF sans clipping", () => {
  it("déplace une signature entière sur la page suivante", () => {
    expect(avoidProtectedPdfRangeCut(0, 1000, 1000, [{ start: 920, end: 1080 }])).toBe(920);
  });

  it("ne produit pas une page presque vide pour un bloc commencé trop près du haut", () => {
    expect(avoidProtectedPdfRangeCut(0, 1000, 1000, [{ start: 200, end: 1050 }])).toBe(1000);
  });

  it("réserve explicitement la zone basse utilisée par le footer", () => {
    expect(PDF_BOTTOM_SAFE_AREA_MM).toBe(18);
  });

  it("conserve un fond blanc après le dernier glyphe sans générer une hauteur vide arbitraire", () => {
    const context = {
      getImageData: (_x: number, y: number, width: number) => {
        const pixels = new Uint8ClampedArray(width * 4).fill(255);
        if (y === 84) pixels[0] = 20;
        return { data: pixels };
      },
    } as unknown as CanvasRenderingContext2D;
    expect(findPdfContentEnd(context, 10, 100, 8)).toBe(93);
  });

  it("garde une surface minimale sûre pour un canvas entièrement blanc", () => {
    const context = { getImageData: (_x: number, _y: number, width: number) => ({ data: new Uint8ClampedArray(width * 4).fill(255) }) } as unknown as CanvasRenderingContext2D;
    expect(findPdfContentEnd(context, 10, 100, 8)).toBe(8);
  });
});
