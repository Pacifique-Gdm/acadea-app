import type { School, SchoolYear } from "../../types";
import { escapePdfHtml, renderAcadPdfPreview } from "../../utils/pdf";
import type { Correspondence } from "./secretaryTypes";
import { normalizeCorrespondenceSignatories } from "./reportSignatories";

const text = (value?: string) => value?.trim() ?? "";
const paragraph = (value?: string) => text(value) ? `<p class="secretary-pdf-main-text outgoing-correspondence-paragraph" style="text-align:justify;text-justify:inter-word;margin:0 0 8pt;text-indent:50%">${escapePdfHtml(text(value)).replaceAll("\n", "<br />")}</p>` : "";
export const OUTGOING_INSTITUTIONAL_UNDERLINE_STYLE = "padding:0 0 6px;line-height:1.45;border-bottom:1px solid #14213d";
const underlinedValue = (value: string) => `<span class="outgoing-institutional-underline" style="display:inline-block;${OUTGOING_INSTITUTIONAL_UNDERLINE_STYLE}">${escapePdfHtml(value)}</span>`;

export function outgoingRecipientLines(item: Correspondence) {
  const recipient = item.outgoing?.recipient;
  if (!recipient) return [];
  const civilities = { mr: "Monsieur", mrs: "Madame", ladies_gentlemen: "Mesdames et Messieurs", other: recipient.customSalutation ?? "" };
  return ["À", [civilities[recipient.salutation], recipient.functionTitle].filter(Boolean).join(" "), recipient.fullName, recipient.institution, recipient.address, recipient.city ? `À ${recipient.city}` : "", recipient.country].map(text).filter(Boolean);
}

export function outgoingCorrespondencePdfSections(item: Correspondence) {
  const outgoing = item.outgoing;
  if (!outgoing) return [];
  const announced = outgoing.announcedAttachments.filter((entry) => entry.includeInPdf && text(entry.title));
  const copies = outgoing.copies.filter((entry) => entry.includeInPdf && text(entry.nameOrFunction));
  const mention = [outgoing.specialMention === "other" ? outgoing.customSpecialMention : outgoing.specialMention, outgoing.priority !== "normal" ? outgoing.priority.replaceAll("_", " ") : "", outgoing.confidentiality !== "public" ? outgoing.confidentiality.replaceAll("_", " ") : ""].map(text).filter(Boolean).join(" · ");
  const signatories = normalizeCorrespondenceSignatories(outgoing.signatories, outgoing.signer);
  const signatureHeight = { small: 36, medium: 55, large: 75 }[outgoing.signer.signatureSpace];
  const reference = text(item.referenceNumber);
  return [
    `<section style="display:flex;justify-content:space-between;margin-bottom:12px">${reference ? `<strong>Réf. : ${underlinedValue(reference)}</strong>` : "<span></span>"}<span>${escapePdfHtml(outgoing.issuePlace)}, le ${escapePdfHtml(item.date)}</span></section>`,
    mention ? `<p style="font-weight:700;text-transform:uppercase;border:1px solid #334155;padding:5px;display:inline-block">${escapePdfHtml(mention)}</p>` : "",
    `<section class="outgoing-correspondence-content" style="width:50%;margin:10px 0 16px 50%;${OUTGOING_INSTITUTIONAL_UNDERLINE_STYLE};text-align:left">${outgoingRecipientLines(item).map((line) => `<div>${escapePdfHtml(line)}</div>`).join("")}</section>`,
    `<p class="secretary-pdf-main-text outgoing-correspondence-paragraph" style="margin:8px 0;text-indent:0"><strong>Objet :</strong> ${underlinedValue(item.subject)}</p>`,
    text(outgoing.previousReference) ? `<p><strong>Réf. antérieure :</strong> ${escapePdfHtml(text(outgoing.previousReference))}</p>` : "",
    announced.length ? `<p><strong>Pièces jointes annoncées :</strong> ${announced.map((entry) => `${escapePdfHtml(entry.title)} (${entry.copies} ex.)`).join(" ; ")}</p>` : "",
    `<p class="secretary-pdf-main-text outgoing-correspondence-salutation" style="margin:18px 0 8pt 50%;break-after:avoid">${escapePdfHtml(outgoing.salutation)}</p>`,
    paragraph(outgoing.introduction), paragraph(outgoing.mainMessage), paragraph(outgoing.details), paragraph(outgoing.justification), paragraph(outgoing.expectedFollowUp), paragraph(outgoing.conclusion),
    paragraph(outgoing.closingFormula),
    `<section class="outgoing-signature-row">
      ${outgoing.visa?.required ? `<div class="outgoing-visa-note"><strong>${escapePdfHtml(outgoing.visa.mention || "Visa")}</strong>${text(outgoing.visa.functionTitle) ? ` — ${escapePdfHtml(text(outgoing.visa.functionTitle))}` : ""}${text(outgoing.visa.personName) ? ` — ${escapePdfHtml(text(outgoing.visa.personName))}` : ""}</div>` : ""}
      ${signatories.map((signatory) => `<div class="outgoing-signature-block">
        <span class="outgoing-signature-space" style="height:${signatureHeight}px"></span>
        <strong class="outgoing-signatory-name">${escapePdfHtml(signatory.name)}</strong>
        <span class="outgoing-signatory-function">${escapePdfHtml(signatory.functionTitle)}</span>
        ${outgoing.signer.stampRequired ? '<span class="outgoing-signatory-stamp">Cachet</span>' : ""}
      </div>`).join("")}
    </section>`,
    copies.length ? `<section class="secretary-pdf-main-text" style="margin-top:18px;break-inside:avoid"><strong>Copies pour information :</strong><ul>${copies.map((entry) => `<li>${escapePdfHtml([entry.nameOrFunction, entry.institution].filter(Boolean).join(" — "))}</li>`).join("")}</ul></section>` : "",
  ].filter(Boolean);
}

export async function previewOutgoingCorrespondence(item: Correspondence, school: School, year: SchoolYear) {
  if (!item.outgoing) throw new Error("Les données du courrier sortant sont incomplètes.");
  const letterContent = outgoingCorrespondencePdfSections(item).join("");
  await renderAcadPdfPreview({ filename: `${item.referenceNumber || "courrier-sortant"}.pdf`, title: item.referenceNumber || school.name, school, year, showDocumentTitle: false, pdfSettings: item.pdfSettings, sections: [`<div style="margin:12px 18px 0">${letterContent}</div>`] });
}
