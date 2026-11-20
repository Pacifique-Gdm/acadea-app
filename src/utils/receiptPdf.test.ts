import { describe, expect, it } from "vitest";
import type { Payment, School, Student } from "../types";
import { buildReceiptSections, buildTwoCopyPdfHtml, pdfFallbackBrandMark, RECEIPT_DESCRIPTION_WIDE_THRESHOLD, receiptCashierFunction } from "./pdf";
import { DEFAULT_PDF_SETTINGS } from "./pdfSettings";

const school = { id: "ecole-a", name: "École fictive Acadéa", currency: "USD" } as School;
const student = { id: "eleve-1", nom: "MUKENDI", postnom: "KABEYA", prenom: "Grâce", matricule: "EL-0001", className: "3e Humanités" } as unknown as Student;
const basePayment = {
  id: "pay-1", receiptNumber: "REC-2026-00042", schoolId: school.id, schoolYearId: "2026-2027", studentId: student.id,
  feeTypeId: "fee-1", feeName: "Frais scolaires", amount: 150, currency: "USD", paidAt: "2026-11-20", cashierName: "Josée NGALULA",
} as Payment;

function occurrences(value: string, expected: string) {
  return value.split(expected).length - 1;
}

function receiptHtml(payment: Payment, cashierName?: string, gender?: "F" | "M" | "Autre") {
  return buildTwoCopyPdfHtml({
    title: "Reçu de paiement",
    school,
    generatedAt: new Date("2026-11-20T10:00:00.000Z"),
    logoDataUrl: "data:image/png;base64,dGVzdA==",
    showDocumentTitle: true,
    centerDocumentTitle: false,
    sections: buildReceiptSections(payment, student, { name: "Frais scolaires" }, cashierName ?? payment.cashierName, gender),
    pdfSettings: DEFAULT_PDF_SETTINGS,
    renderWidth: 900,
    renderHeight: 1348,
    copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],
  });
}

describe("Reçu de paiement : description, signature et en-tête", () => {
  it("remplace la carte Caissier par la description du paiement dans les deux exemplaires", () => {
    const html = receiptHtml({ ...basePayment, note: "Tranche 2 de septembre" });
    expect(occurrences(html, "Description du paiement")).toBe(2);
    expect(occurrences(html, "Tranche 2 de septembre")).toBe(2);
    expect(html).not.toMatch(/<span>Caissier<\/span>/);
    expect(occurrences(html, 'class="info-box receipt-description"')).toBe(2);
    expect(html).not.toContain("receipt-description receipt-description--wide");
  });

  it("affiche un tiret quand la description est vide", () => {
    const html = receiptHtml({ ...basePayment, note: "   " });
    expect(html.match(/receipt-description"[^]*?<strong>([^<]*)<\/strong>/)?.[1]).toBe("—");
    expect(occurrences(html, "Description du paiement")).toBe(2);
  });

  it("donne toute la largeur à une description longue, sans la couper", () => {
    const note = "Versement de la deuxième tranche par l'oncle de l'élève, ".repeat(18).trim();
    expect(note.length).toBeGreaterThan(RECEIPT_DESCRIPTION_WIDE_THRESHOLD);
    const html = receiptHtml({ ...basePayment, note });
    expect(occurrences(html, "receipt-description receipt-description--wide")).toBe(2);
    expect(occurrences(html, note.replace(/'/g, "&#039;"))).toBe(2);
    expect(html).toContain(".pdf-copy .receipt-description--wide { grid-column: 1 / -1; }");
  });

  it("met le nom du caissier en gras sous la ligne de signature, puis sa fonction", () => {
    const html = receiptHtml(basePayment, "Josée NGALULA");
    const signature = html.slice(html.indexOf("Signature et cachet"));
    expect(signature.indexOf("<strong></strong>")).toBeLessThan(signature.indexOf("Josée NGALULA"));
    expect(signature.indexOf("Josée NGALULA")).toBeLessThan(signature.indexOf(">Caissier<"));
    expect(occurrences(html, '<p class="receipt-signatory-name">Josée NGALULA</p>')).toBe(2);
    expect(html).toMatch(/\.receipt-signatory-name \{[^}]*font-weight: 800/);
  });

  it("écrit Caissière seulement quand le profil indique une femme", () => {
    expect(receiptCashierFunction("F")).toBe("Caissière");
    expect(receiptCashierFunction("M")).toBe("Caissier");
    expect(receiptCashierFunction(undefined)).toBe("Caissier");
    expect(occurrences(receiptHtml(basePayment, "Josée NGALULA", "F"), ">Caissière<")).toBe(2);
  });

  it("garde le logo de secours d'un sigle long accentué sur une seule ligne, dans le carré", () => {
    const html = buildTwoCopyPdfHtml({
      title: "Reçu de paiement", school: { ...school, name: "G.S AGAPÉ", acronym: "GSAGAPÉ" }, generatedAt: new Date(),
      logoDataUrl: "", showDocumentTitle: true, centerDocumentTitle: false, sections: ["<p>x</p>"],
      pdfSettings: DEFAULT_PDF_SETTINGS, renderWidth: 900, renderHeight: 1348, copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],
    });
    expect(occurrences(html, '<span class="brand-mark-letters" style="font-size:0.44em">GSAGAPÉ</span>')).toBe(2);
    expect(html).toMatch(/\.brand-mark-letters \{[^}]*white-space: nowrap !important;[^}]*word-break: keep-all !important;/);
    expect(html).toContain(".brand-mark { overflow: hidden; }");
  });

  it("réduit la taille selon le nombre de lettres et limite le logo de secours à 8 lettres", () => {
    expect(pdfFallbackBrandMark({ name: "Institut", acronym: "IÉ" })).toContain('style="font-size:1em">IÉ<');
    expect(pdfFallbackBrandMark({ name: "Complexe scolaire", acronym: "CSÉLITEPLUS" })).toContain(">CSÉLITEP<");
    expect(pdfFallbackBrandMark({ name: "Groupe scolaire Agapé" })).toContain('style="font-size:1em">GSA<');
    expect(pdfFallbackBrandMark({ name: "G.S AGAPÉ", acronym: "" })).toContain(">GSA<");
  });

  it("écrit un tiret quand le caissier est inconnu", () => {
    expect(occurrences(receiptHtml(basePayment, "-"), '<p class="receipt-signatory-name">—</p>')).toBe(2);
  });
});
