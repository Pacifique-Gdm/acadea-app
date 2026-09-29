import type { School, SchoolClass, SchoolYear } from "../types";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";
import { formatCurrencyMoney, formatSchoolMoney, type SchoolCurrency } from "./currency";

type DashboardTransaction = { id: string; type: string; label: string; amount: number; date: string };

export async function exportDashboardReportPdf({
  school,
  year,
  sectionLabel,
  dateLabel,
  recoveryRate,
  totalPayments,
  arrearsCollections,
  totalExpenses,
  expected,
  remaining,
  transactions,
  classRows,
  totalGirls,
  totalBoys,
  totalStudents,
}: {
  school: School;
  year: SchoolYear;
  sectionLabel: string;
  dateLabel: string;
  recoveryRate: number;
  totalPayments: number;
  arrearsCollections: { currency: SchoolCurrency; amount: number }[];
  totalExpenses: number;
  expected: number;
  remaining: number;
  transactions: DashboardTransaction[];
  classRows: { className: SchoolClass; girls: number; boys: number; total: number }[];
  totalGirls: number;
  totalBoys: number;
  totalStudents: number;
}) {
  await renderAcadPdfPreview({
    filename: `dashboard-${year.name}.pdf`,
    title: "Dashboard",
    school,
    year,
    subtitle: `Section : ${sectionLabel} | Tranche de date : ${dateLabel}`,
    sections: [
      pdfSection(
        "KPI financier",
        pdfInfoGrid([
          { label: "Recouvrement", value: `${recoveryRate}%` },
          { label: "Frais de l'année encaissés", value: formatSchoolMoney(totalPayments, school) },
          ...arrearsCollections.map((group) => ({ label: `Arriérés encaissés (${group.currency})`, value: formatCurrencyMoney(group.amount, group.currency) })),
          { label: "Dépenses", value: formatSchoolMoney(totalExpenses, school) },
          { label: "Attendu", value: formatSchoolMoney(expected, school) },
          { label: "Reste", value: formatSchoolMoney(remaining, school) },
        ]),
      ),
      pdfSection(
        "Transactions du jour",
        pdfTable(
          [
            { header: "Date", render: (transaction) => transaction.date.slice(0, 10) },
            { header: "Type", render: (transaction) => transaction.type },
            { header: "Libellé", render: (transaction) => transaction.label },
            { header: "Montant", render: (transaction) => formatSchoolMoney(transaction.amount, school), align: "right" },
          ],
          transactions,
          "Aucune transaction pour cette période.",
        ),
      ),
      pdfSection(
        "Élèves par classe",
        pdfTable(
          [
            { header: "Classe", render: (row) => row.className },
            { header: "Filles", render: (row) => row.girls, align: "center" },
            { header: "Garçons", render: (row) => row.boys, align: "center" },
            { header: "Total", render: (row) => row.total, align: "center" },
          ],
          classRows,
          "Aucune classe à afficher.",
          {
            footerHtml: `
              <tr>
                <td>Totaux</td>
                <td class="align-center">${totalGirls}</td>
                <td class="align-center">${totalBoys}</td>
                <td class="align-center">${totalStudents}</td>
              </tr>
            `,
          },
        ),
      ),
    ],
  });
}
