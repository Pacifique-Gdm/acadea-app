import { describe, expect, it } from "vitest";
import { pdfInfoGrid } from "./pdf";

describe("mise en page PDF homogénéité", () => {
  it("place toutes les cartes de calcul sur une ligne à largeur dynamique", () => {
    const html = pdfInfoGrid(Array.from({ length: 7 }, (_, index) => ({ label: `Carte ${index + 1}`, value: index })), { className: "age-calculation-info-grid", columns: 7 });
    expect(html).toContain("age-calculation-info-grid");
    expect(html).toContain("grid-template-columns:repeat(7,minmax(0,1fr))");
    expect(html.match(/class="info-box"/g)).toHaveLength(7);
  });
});
