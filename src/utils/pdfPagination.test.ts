import { describe, expect, it } from "vitest";
import { avoidProtectedPdfRangeCut } from "./pdf";
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
});
