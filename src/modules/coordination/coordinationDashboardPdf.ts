import type { Coordination, School } from "../../types";
import type { CoordinationDashboardStats, DashboardCurrency } from "../../utils/coordinationDashboardStats";
import { formatCurrencyMoney } from "../../utils/currency";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";

type DashboardPdfTransaction = { id: string; type: string; label: string; amount: number; currency: DashboardCurrency; date: string };

function amount(value: number, currency: DashboardCurrency) {
  return formatCurrencyMoney(value, currency);
}

export async function exportCoordinationDashboardPdf({
  coordination,
  schools,
  selectedSchoolId,
  stats,
  sectionLabel,
  dateLabel,
  transactions,
}: {
  coordination: Coordination;
  schools: School[];
  selectedSchoolId: string;
  stats: CoordinationDashboardStats;
  sectionLabel: string;
  dateLabel: string;
  transactions: DashboardPdfTransaction[];
}) {
  const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
  if (!contextSchool) return;
  const context = selectedSchoolId ? contextSchool.name : "Toutes les écoles";
  await renderAcadPdfPreview({
    filename: `coordination-dashboard-${selectedSchoolId || "toutes"}.pdf`,
    title: "Dashboard — Coordination",
    school: coordinationPdfInstitution(coordination, contextSchool),
    subtitle: `Périmètre : ${context} | Section : ${sectionLabel} | Tranche de date : ${dateLabel}`,
    sections: [
      pdfSection("Indicateurs", pdfInfoGrid([
        { label: "Nombre total d'élèves", value: stats.totalStudents },
        { label: "Nombre de classes", value: stats.totalClasses },
        { label: "Nombre total de parents", value: stats.totalParents },
        { label: "Administrateurs", value: stats.administrators },
        { label: "Caissiers", value: stats.cashiers },
        { label: "Directeurs de Discipline", value: stats.disciplineDirectors },
      ], { columns: 3 })),
      ...stats.financialGroups.flatMap((group) => [
        pdfSection(`Synthèse financière — ${group.currency}`, pdfInfoGrid([
          { label: "Recouvrement", value: `${group.recoveryRate}%` },
          { label: "Attendu", value: amount(group.expected, group.currency) },
          { label: "Encaissé", value: amount(group.paid, group.currency) },
          { label: "Dépenses", value: amount(group.expenses, group.currency) },
          { label: "Reste", value: amount(group.remaining, group.currency) },
        ])),
        pdfSection(`Types de frais — ${group.currency}`, pdfTable([
          { header: "Type", render: (row) => row.name },
          { header: "Attendu", render: (row) => amount(row.expected, group.currency), align: "right" },
          { header: "Payé", render: (row) => amount(row.paid, group.currency), align: "right" },
          { header: "Solde", render: (row) => amount(row.remaining, group.currency), align: "right" },
          { header: "%", render: (row) => `${row.rate}%`, align: "right" },
        ], group.feeProgressRows, "Aucun frais applicable.")),
        pdfSection(`Répartition des montants — ${group.currency}`, pdfTable([
          { header: "Catégorie", render: (row) => row.name },
          { header: "Montant", render: (row) => amount(row.amount, group.currency), align: "right" },
          { header: "Pourcentage", render: (row) => `${row.percentage.toFixed(1)}%`, align: "right" },
        ], group.feeShares, "Aucune répartition disponible.")),
      ]),
      pdfSection("Transactions du jour", pdfTable([
        { header: "Date", render: (transaction) => transaction.date.slice(0, 10) },
        { header: "Type", render: (transaction) => transaction.type },
        { header: "École / libellé", render: (transaction) => transaction.label },
        { header: "Montant", render: (transaction) => `${transaction.amount >= 0 ? "+" : "-"}${amount(Math.abs(transaction.amount), transaction.currency)}`, align: "right" },
      ], transactions, "Aucune transaction pour cette période.")),
      pdfSection("Élèves par classe", pdfTable([
        ...(schools.length > 1 ? [{ header: "École", render: (row: CoordinationDashboardStats["classRows"][number]) => row.schoolName }] : []),
        { header: "Classe", render: (row) => row.className },
        { header: "Filles", render: (row) => row.girls, align: "center" as const },
        { header: "Garçons", render: (row) => row.boys, align: "center" as const },
        { header: "Total", render: (row) => row.total, align: "center" as const },
      ], stats.classRows, "Aucune classe à afficher.")),
    ],
  });
}
