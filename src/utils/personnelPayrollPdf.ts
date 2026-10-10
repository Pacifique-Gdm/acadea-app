import type { PersonnelPayment, School } from "../types";
import { formatCurrencyMoney } from "./currency";
import { escapePdfHtml, pdfInfoGrid, pdfSection, renderAcadPdfPreview } from "./pdf";

const dateFr = (iso: string) => {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
};
const amount = (value: number, currency: PersonnelPayment["currency"]) => formatCurrencyMoney(value, currency);

export function personnelPaymentPdfSections(payment: PersonnelPayment) {
  const common = pdfInfoGrid([
    { label: "Bénéficiaire", value: payment.beneficiaryName },
    { label: "Fonction", value: payment.beneficiaryJobTitle },
    { label: "Référence", value: payment.reference },
    { label: "Date réelle du paiement", value: dateFr(payment.paidAt) },
    { label: "Devise", value: payment.currency === "CDF" ? "FC" : "USD" },
  ]);
  if (payment.kind === "advance") return [pdfSection("VERSEMENT D'UNE AVANCE", `${common}${pdfInfoGrid([
    { label: "Montant versé", value: amount(payment.amount, payment.currency) },
    { label: "Solde récupérable actuel", value: amount(Math.max(0, payment.amount - payment.recoveredAmount), payment.currency) },
    ...(payment.description ? [{ label: "Description", value: payment.description }] : []),
  ])}`)];
  const recoveryRows = payment.recoveries.map((line) => `<tr><td>${escapePdfHtml(line.reference)}</td><td>${escapePdfHtml(dateFr(line.paidAt))}</td><td style="text-align:right">−${escapePdfHtml(amount(line.amount, payment.currency))}</td></tr>`).join("");
  return [
    pdfSection("PAIEMENT", `${common}${pdfInfoGrid([
      { label: "Nature", value: payment.kind === "salary" ? "Salaire" : "Prime" },
      { label: "Période concernée", value: `${String(payment.periodMonth).padStart(2, "0")}/${payment.periodYear}` },
      { label: "Montant brut", value: amount(payment.amount, payment.currency) },
    ])}`),
    pdfSection("AVANCES RÉCUPÉRÉES", `<table class="pdf-table"><thead><tr><th>Référence</th><th>Date du versement</th><th>Montant récupéré</th></tr></thead><tbody>${recoveryRows || '<tr><td colspan="3">Aucune avance récupérée</td></tr>'}</tbody></table>${pdfInfoGrid([{ label: "Total des avances récupérées", value: `−${amount(payment.recoveredAmount, payment.currency)}` }])}`),
    pdfSection("RETENUES ET NET", pdfInfoGrid([
      { label: "Autres retenues", value: `−${amount(payment.deduction, payment.currency)}` },
      { label: "Motif de retenue", value: payment.deductionReason || "—" },
      { label: "CNSS", value: `−${amount(payment.cnss, payment.currency)}` },
      { label: "Impôt", value: `−${amount(payment.tax, payment.currency)}` },
      { label: "Net effectivement payé", value: amount(payment.netPaid, payment.currency) },
      ...(payment.description ? [{ label: "Description", value: payment.description }] : []),
    ])),
  ];
}

export function printPersonnelPaymentPdf(payment: PersonnelPayment, school: School) {
  return renderAcadPdfPreview({
    filename: `${payment.kind === "advance" ? "justificatif-avance" : "bulletin-paie"}-${payment.reference}.pdf`,
    title: payment.kind === "advance" ? "JUSTIFICATIF D'AVANCE SUR SALAIRE" : "BULLETIN DE PAIE",
    school, generatedAt: new Date(payment.createdAt), sections: personnelPaymentPdfSections(payment),
  });
}
