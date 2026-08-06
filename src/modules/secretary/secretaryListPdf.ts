import type { School, SchoolYear } from "../../types";
import { pdfInfoGrid, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { Correspondence, SecretaryReport, SecretaryReportType } from "./secretaryTypes";

export async function exportCorrespondenceListPdf({ rows, school, year, filters, typeLabel }: { rows: Correspondence[]; school: School; year: SchoolYear; filters: string; typeLabel: (item: Correspondence) => string }) {
  if (rows.length === 0) throw new Error("Aucun courrier ne correspond aux filtres actifs.");
  await renderAcadPdfPreview({
    filename: `liste-courriers-${new Date().toISOString().slice(0, 10)}.pdf`, title: "LISTE DES COURRIERS", school, year,
    sections: [
      pdfInfoGrid([{ label: "FILTRES APPLIQUÉS", value: filters || "Aucun" }, { label: "NOMBRE DE RÉSULTATS", value: String(rows.length) }, { label: "DATE D’EXPORT", value: new Date().toLocaleDateString("fr-FR") }]),
      pdfTable([
        { header: "ORDRE", render: (_item, index) => index + 1, align: "center" },
        { header: "RÉFÉRENCE", render: (item) => item.referenceNumber },
        { header: "DATE", render: (item) => item.date },
        { header: "TYPE", render: typeLabel },
        { header: "DESTINATAIRE", render: (item) => item.recipient },
        { header: "OBJET", render: (item) => item.subject },
        { header: "LIEU", render: (item) => item.outgoing?.issuePlace ?? "-" },
      ], rows, "Aucun courrier."),
    ],
  });
}

export async function exportSecretaryReportListPdf({ rows, school, year, filters, typeLabels }: { rows: SecretaryReport[]; school: School; year: SchoolYear; filters: string; typeLabels: Record<SecretaryReportType, string> }) {
  if (rows.length === 0) throw new Error("Aucun rapport ne correspond aux filtres actifs.");
  await renderAcadPdfPreview({
    filename: `liste-rapports-${new Date().toISOString().slice(0, 10)}.pdf`, title: "LISTE DES RAPPORTS", school, year,
    sections: [
      pdfInfoGrid([{ label: "FILTRES APPLIQUÉS", value: filters || "Aucun" }, { label: "NOMBRE DE RÉSULTATS", value: String(rows.length) }, { label: "DATE D’EXPORT", value: new Date().toLocaleDateString("fr-FR") }]),
      pdfTable([
        { header: "ORDRE", render: (_item, index) => index + 1, align: "center" },
        { header: "RÉFÉRENCE", render: (item) => item.reportNumber },
        { header: "DATE", render: (item) => item.documentDate },
        { header: "TYPE", render: (item) => typeLabels[item.type] },
        { header: "OBJET", render: (item) => item.title },
        { header: "LIEU", render: (item) => item.structuredContent?.lieu ?? item.structuredContent?.location ?? "-" },
        { header: "AUTEUR", render: (item) => item.authorName },
      ], rows, "Aucun rapport."),
    ],
  });
}
