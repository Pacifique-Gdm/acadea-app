import { describe, expect, it } from "vitest";
import type { Correspondence } from "./secretaryTypes";
import { outgoingCorrespondencePdfSections } from "./outgoingCorrespondencePdf";

const occurrences = (source: string, value: string) => source.split(value).length - 1;

function correspondence(overrides: Partial<NonNullable<Correspondence["outgoing"]>> = {}): Correspondence {
  return {
    id: "correspondence-1",
    referenceNumber: "CS/SEC/0045/2026",
    direction: "outgoing",
    date: "2026-08-03",
    subject: "Objet administratif de test",
    sender: "Acadéa",
    recipient: "Direction provinciale",
    content: "Contenu du courrier",
    status: "draft",
    createdBy: "secretary-1",
    createdAt: "2026-08-03T10:00:00.000Z",
    updatedAt: "2026-08-03T10:00:00.000Z",
    schoolId: "school-1",
    schoolYearId: "year-1",
    outgoing: {
      correspondenceType: "administrative_letter",
      issuePlace: "Kinshasa",
      academicYearName: "2025-2026",
      authorName: "Secrétaire test",
      priority: "normal",
      confidentiality: "public",
      deliveryMode: "hand_delivery",
      recipient: { salutation: "mr", fullName: "Destinataire test" },
      salutation: "Monsieur,",
      introduction: "Introduction courte.",
      mainMessage: "Message principal.",
      conclusion: "Conclusion du courrier.",
      closingFormula: "Veuillez agréer nos salutations distinguées.",
      signer: {
        userId: "signer-1",
        fullName: "Charly Signature QA",
        functionTitle: "Secrétaire principal QA",
        signatureType: "handwritten_space",
        signatureRequired: true,
        stampRequired: false,
        signatureSpace: "medium",
      },
      announcedAttachments: [],
      copies: [],
      version: 1,
      ...overrides,
    },
  };
}

describe("PDF du courrier sortant — bloc de signature", () => {
  it("souligne Objet, la référence et le lieu sans ajouter de ligne décorative", () => {
    const html = outgoingCorrespondencePdfSections(correspondence()).join("");
    expect(html).toContain("<u>Réf. : CS/SEC/0045/2026</u>");
    expect(html).toContain("<u>Kinshasa</u>");
    expect(html).toContain("<u>Objet :</u>");
    expect(html).not.toContain("border-bottom");
  });

  it("supprime le retrait de première ligne et partage la limite utile du destinataire", () => {
    const html = outgoingCorrespondencePdfSections(correspondence()).join("");
    expect(html).toContain('class="outgoing-correspondence-content" style="width:100%');
    expect(html).toContain('class="secretary-pdf-main-text outgoing-correspondence-paragraph"');
    expect(html).toContain("text-indent:0");
  });

  it("génère un seul espace manuscrit suivi du nom puis de la fonction", () => {
    const html = outgoingCorrespondencePdfSections(correspondence()).join("");

    expect(occurrences(html, 'class="outgoing-signature-block"')).toBe(1);
    expect(occurrences(html, 'class="outgoing-signature-space"')).toBe(1);
    expect(occurrences(html, "Charly Signature QA")).toBe(1);
    expect(occurrences(html, "Secrétaire principal QA")).toBe(1);
    expect(html).toContain(
      '<strong class="outgoing-signatory-name">Charly Signature QA</strong>\n        <span class="outgoing-signatory-function">Secrétaire principal QA</span>',
    );
    expect(html).not.toContain('class="signature-row"');
  });

  it("conserve un nom et une fonction longs sans créer un second bloc", () => {
    const fullName = "Charly Nom du signataire particulièrement long pour vérification";
    const functionTitle = "Secrétaire général chargé de l’administration scolaire et des relations institutionnelles";
    const html = outgoingCorrespondencePdfSections(correspondence({ signer: {
      userId: "signer-1", fullName, functionTitle, signatureType: "handwritten_space",
      signatureRequired: true, stampRequired: false, signatureSpace: "large",
    } })).join("");

    expect(occurrences(html, fullName)).toBe(1);
    expect(occurrences(html, functionTitle)).toBe(1);
    expect(occurrences(html, 'class="outgoing-signature-space"')).toBe(1);
  });

  it("ne transforme pas un ancien visa en deuxième zone de signature", () => {
    const html = outgoingCorrespondencePdfSections(correspondence({
      visa: { required: true, mention: "Vu et approuvé", personName: "Ancien responsable", functionTitle: "Direction" },
    })).join("");

    expect(html).toContain('class="outgoing-visa-note"');
    expect(html).toContain("Ancien responsable");
    expect(occurrences(html, 'class="outgoing-signature-block"')).toBe(1);
    expect(occurrences(html, 'class="outgoing-signature-space"')).toBe(1);
  });

  it("conserve un seul bloc avec un courrier de plusieurs paragraphes", () => {
    const longText = Array.from({ length: 30 }, (_, index) => `Paragraphe administratif ${index + 1}.`).join("\n");
    const html = outgoingCorrespondencePdfSections(correspondence({ mainMessage: longText })).join("");

    expect(html).toContain("Paragraphe administratif 30.");
    expect(occurrences(html, 'class="outgoing-signature-block"')).toBe(1);
    expect(occurrences(html, 'class="outgoing-signature-space"')).toBe(1);
  });
});
