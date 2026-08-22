import type { Coordination, School } from "../../types";
import type { CoordinationDashboardStats, DashboardCurrency } from "../../utils/coordinationDashboardStats";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";

type DashboardPdfTransaction = { id: string; type: string; label: string; amount: number; currency: DashboardCurrency; date: string };

function amount(value: number, currency: DashboardCurrency) {
  return `${value.toFixed(2)} ${currency}`;
}

function financialValue(stats: CoordinationDashboardStats, field: "expected" | "paid" | "remaining") {
  return stats.financialGroups.length ? stats.financialGroups.map((group) => amount(group[field], group.currency)).join(" · ") : "0.00 USD";
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
  const feeRows = stats.financialGroups.flatMap((group) => group.feeProgressRows.map((row) => ({ ...row, currency: group.currency })));
  const shareRows = stats.financialGroups.flatMap((group) => group.feeShares.map((row) => ({ ...row, currency: group.currency })));

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
        { label: "Montant attendu", value: financialValue(stats, "expected") },
        { label: "Montant total encaissé", value: financialValue(stats, "paid") },
        { label: "Montant restant à payer", value: financialValue(stats, "remaining") },
      ], { columns: 3 })),
      ...stats.financialGroups.map((group) => pdfSection(`KPI financier — ${group.currency}`, pdfInfoGrid([
        { label: "Recouvrement", value: `${group.recoveryRate}%` },
        { label: "Attendu", value: amount(group.expected, group.currency) },
        { label: "Encaissé", value: amount(group.paid, group.currency) },
        { label: "Dépenses", value: amount(group.expenses, group.currency) },
        { label: "Reste", value: amount(group.remaining, group.currency) },
      ]))),
      pdfSection("Types de frais", pdfTable([
        { header: "Type", render: (row) => row.name },
        { header: "Devise", render: (row) => row.currency },
        { header: "Attendu", render: (row) => amount(row.expected, row.currency), align: "right" },
        { header: "Payé", render: (row) => amount(row.paid, row.currency), align: "right" },
        { header: "Solde", render: (row) => amount(row.remaining, row.currency), align: "right" },
        { header: "%", render: (row) => `${row.rate}%`, align: "right" },
      ], feeRows, "Aucun frais applicable.")),
      pdfSection("Répartition des montants", pdfTable([
        { header: "Catégorie", render: (row) => row.name },
        { header: "Devise", render: (row) => row.currency },
        { header: "Montant", render: (row) => amount(row.amount, row.currency), align: "right" },
        { header: "Pourcentage", render: (row) => `${row.percentage.toFixed(1)}%`, align: "right" },
      ], shareRows, "Aucune répartition disponible.")),
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
