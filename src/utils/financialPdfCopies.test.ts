import { describe, expect, it } from "vitest";
import type { School, SchoolYear } from "../types";
import { buildTwoCopyPdfHtml, escapePdfHtml, pdfInfoGrid, pdfSection } from "./pdf";
import { DEFAULT_PDF_SETTINGS } from "./pdfSettings";

const school = {
  id: "school-a",
  name: "Établissement scolaire Acadéa avec une adresse administrative particulièrement longue",
  acronym: "EA",
  motto: "Discipline - Travail - Excellence",
  address: "123, très longue avenue de la Réussite scolaire, Commune de la Formation",
  phone: "+243 000 000 000",
  email: "administration@example.test",
} as School;

const year = { id: "year-a", name: "2026-2027" } as SchoolYear;
const generatedAt = new Date("2026-08-08T10:00:00.000Z");

function occurrences(value: string, expected: string) {
  return value.split(expected).length - 1;
}

function renderCopies(title: string, labels: readonly [string, string], section: string) {
  return buildTwoCopyPdfHtml({
    title,
    school,
    year,
    generatedAt,
    logoDataUrl: "data:image/png;base64,dGVzdA==",
    showDocumentTitle: true,
    centerDocumentTitle: false,
    sections: [section],
    pdfSettings: DEFAULT_PDF_SETTINGS,
    renderWidth: 900,
    renderHeight: 1348,
    copyLabels: labels,
  });
}

describe("PDF financiers en deux exemplaires", () => {
  it("duplique intégralement le reçu avec le même numéro sur une page et une ligne de découpe", () => {
    const receiptNumber = "REC-2026-00042";
    const html = renderCopies(
      "Reçu de paiement",
      ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],
      pdfInfoGrid([
        { label: "Reçu", value: receiptNumber },
        { label: "Élève", value: "Nom d'élève volontairement très long pour vérifier le retour à la ligne" },
        { label: "Type de frais", value: "Frais scolaires annuels et fournitures pédagogiques obligatoires" },
      ]),
    );

    expect(occurrences(html, "Reçu de paiement")).toBe(2);
    expect(occurrences(html, receiptNumber)).toBe(2);
    expect(occurrences(html, '<header class="pdf-header">')).toBe(2);
    expect(occurrences(html, '<article class="pdf-copy">')).toBe(2);
    expect(html.indexOf("EXEMPLAIRE ÉCOLE")).toBeLessThan(html.indexOf("EXEMPLAIRE PARENT"));
    expect(html).toContain("min-height: 35px");
    expect(html).toContain("padding: 6px 6px");
    expect(html).toContain("word-spacing: 0.18em");
    expect(html).toContain("white-space: nowrap");
    expect(html).not.toContain("EXEMPLAIREÉCOLE");
    expect(html).not.toContain("EXEMPLAIREPARENT");
    expect(html).toContain('class="pdf-cut-line"');
    expect(html).toContain("grid-template-rows: minmax(0, 1fr) 22px minmax(0, 1fr)");
  });

  it("duplique intégralement le justificatif avec des contenus longs", () => {
    const description = "Acquisition de fournitures administratives et pédagogiques pour plusieurs services de l'établissement";
    const html = renderCopies(
      "Justificatif de dépense",
      ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE BÉNÉFICIAIRE"],
      pdfSection("Dépense", pdfInfoGrid([
        { label: "Libellé / motif", value: description },
        { label: "Catégorie", value: "Fournitures administratives, pédagogiques et équipements de bureau" },
        { label: "Bénéficiaire / fournisseur", value: "Fournisseur au nom particulièrement long pour le contrôle du wrapping" },
      ])),
    );

    expect(occurrences(html, "Justificatif de dépense")).toBe(2);
    expect(occurrences(html, escapePdfHtml(description))).toBe(2);
    expect(occurrences(html, '<header class="pdf-header">')).toBe(2);
    expect(html.indexOf("EXEMPLAIRE ÉCOLE")).toBeLessThan(html.indexOf("EXEMPLAIRE BÉNÉFICIAIRE"));
    expect(html).toContain("overflow-wrap: anywhere");
    expect(html).toContain("min-height: 35px");
    expect(html).toContain("line-height: 1.22");
    expect(html).not.toContain("EXEMPLAIREÉCOLE");
    expect(html).not.toContain("EXEMPLAIREBÉNÉFICIAIRE");
    expect(html).toContain('class="pdf-cut-line"');
  });

  it("rend la zone Signature et cachet dans les deux exemplaires", () => {
    const html = renderCopies(
      "Justificatif de dépense",
      ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE BÉNÉFICIAIRE"],
      '<section class="signature-row"><div><span>Signature et cachet</span><strong></strong></div></section>',
    );

    expect(occurrences(html, "Signature et cachet")).toBe(2);
    expect(occurrences(html, 'class="signature-row"')).toBe(2);
  });
});
