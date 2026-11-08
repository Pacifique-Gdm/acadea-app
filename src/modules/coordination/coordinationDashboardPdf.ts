import type { Coordination, School } from "../../types";
import type { CoordinationDashboardStats, DashboardCurrency } from "../../utils/coordinationDashboardStats";
import { formatCurrencyMoney } from "../../utils/currency";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { dashboardPdfFeeShareChart, dashboardPdfTransactionChart, type DashboardPdfChartRow } from "../../utils/dashboardPdf";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";

type DashboardPdfTransaction = { id: string; type: string; label: string; amount: number; currency?: DashboardCurrency; date: string };

function amount(value: number, currency: DashboardCurrency) {
  return formatCurrencyMoney(value, currency);
}

export async function exportCoordinationDashboardPdf({
  coordination,
  schools,
  selectedSchoolId,
  stats,
  arrearsCollections = [],
  historicalArrears,
  arrearsCurrencies,
  sectionLabel,
  dateLabel,
  transactions,
  chartGroups,
  transactionPeriodLabel,
  showTransactionCharts,
}: {
  coordination: Coordination;
  schools: School[];
  selectedSchoolId: string;
  stats: CoordinationDashboardStats;
  arrearsCollections?: { currency: DashboardCurrency; amount: number }[];
  historicalArrears: { USD: number; CDF: number };
  arrearsCurrencies: readonly DashboardCurrency[];
  sectionLabel: string;
  dateLabel: string;
  transactions: DashboardPdfTransaction[];
  chartGroups: { currency: DashboardCurrency; rows: DashboardPdfChartRow[] }[];
  transactionPeriodLabel: string;
  showTransactionCharts: boolean;
}) {
  const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
  if (!contextSchool) return;
  if (transactions.some((transaction) => !transaction.currency) || stats.financialGroups.some((group) => (group.unknownCurrencyCount ?? 0) > 0)) {
    throw new Error("Export bloqué : devise historique inconnue.");
  }
  const context = selectedSchoolId ? contextSchool.name : "Toutes les écoles";
  await renderAcadPdfPreview({
    filename: `coordination-dashboard-${selectedSchoolId || "toutes"}.pdf`,
    title: "Dashboard — Coordination",
    school: coordinationPdfInstitution(coordination, contextSchool),
    subtitle: `Périmètre : ${context} | Année de référence : ${coordination.referenceSchoolYear ?? "Non définie"} | Section : ${sectionLabel} | Tranche de date : ${dateLabel}`,
    throwOnError: true,
    sections: [
      ...(stats.excludedSchoolIds.length ? [pdfSection("Écoles non alignées", `<p>${stats.excludedSchoolIds.length} école(s) non alignée(s) sur l'année de référence sont exclues des statistiques.</p>`)] : []),
      pdfSection("Indicateurs", pdfInfoGrid([
        { label: "Nombre total d'élèves", value: stats.totalStudents },
        { label: "Nombre de classes", value: stats.totalClasses },
        { label: "Nombre total de parents", value: stats.totalParents },
        { label: "Administrateurs", value: stats.administrators },
        { label: "Caissiers", value: stats.cashiers },
        { label: "Directeurs de Discipline", value: stats.disciplineDirectors },
      ], { columns: 3 })),
      pdfSection("Arriérés des années antérieures", arrearsCurrencies.length ? pdfInfoGrid(arrearsCurrencies.map((currency) => ({
        label: `Dettes historiques (${currency})`, value: amount(historicalArrears[currency], currency),
      }))) : "<p>Aucune devise financière applicable.</p>"),
      ...stats.financialGroups.flatMap((group) => [
        pdfSection(`Synthèse financière — ${group.currency}`, pdfInfoGrid([
          { label: "Recouvrement", value: `${group.recoveryRate}%` },
          { label: "Montant officiel", value: amount(group.official, group.currency) },
          { label: "Réductions et exonérations", value: amount(group.reduction, group.currency) },
          { label: "Net exigible", value: amount(group.expected, group.currency) },
          { label: "Frais de l'année encaissés", value: amount(group.paid, group.currency) },
          { label: "Autres entrées de caisse", value: amount(group.cashInflows, group.currency) },
          ...arrearsCollections.filter((item) => item.currency === group.currency).map((item) => ({ label: "Arriérés encaissés (hors recouvrement)", value: amount(item.amount, item.currency) })),
          { label: "Dépenses", value: amount(group.expenses, group.currency) },
          { label: "Reste", value: amount(group.remaining, group.currency) },
        ])),
        pdfSection(`Types de frais — ${group.currency}`, pdfTable([
          { header: "Type", render: (row) => row.name },
          { header: "Officiel", render: (row) => amount(row.official ?? row.expected, group.currency), align: "right" },
          { header: "Réductions", render: (row) => amount(row.reduction ?? 0, group.currency), align: "right" },
          { header: "Net exigible", render: (row) => amount(row.expected, group.currency), align: "right" },
          { header: "Payé", render: (row) => amount(row.paid, group.currency), align: "right" },
          { header: "Solde", render: (row) => amount(row.remaining, group.currency), align: "right" },
          { header: "%", render: (row) => `${row.rate}%`, align: "right" },
        ], group.feeProgressRows, "Aucun frais applicable."), { pageBreakBefore: true }),
        pdfSection(`Répartition des montants — ${group.currency}`, dashboardPdfFeeShareChart(group.feeShares, group.currency)),
        ...(showTransactionCharts ? [pdfSection(`Graphique des transactions — ${group.currency}`,
          dashboardPdfTransactionChart(chartGroups.find((chart) => chart.currency === group.currency)?.rows ?? [], group.currency, transactionPeriodLabel), { pageBreakBefore: true })] : []),
      ]),
      ...(!showTransactionCharts ? [pdfSection("Graphique des transactions indisponible",
        "<p>Les graphiques par école sont masqués car des opérations historiques portent une autre devise que la devise actuelle de leur école.</p>")] : []),
      pdfSection("Transactions du jour", pdfTable([
        { header: "Date", render: (transaction) => transaction.date.slice(0, 10) },
        { header: "Type", render: (transaction) => transaction.type },
        { header: "École / libellé", render: (transaction) => transaction.label },
        { header: "Montant", render: (transaction) => `${transaction.amount >= 0 ? "+" : "-"}${amount(Math.abs(transaction.amount), transaction.currency!)}`, align: "right" },
      ], transactions, "Aucune transaction pour cette période.")),
      pdfSection("Élèves par classe", pdfTable([
        ...(schools.length > 1 ? [{ header: "École", render: (row: CoordinationDashboardStats["classRows"][number]) => row.schoolName }] : []),
        { header: "Classe", render: (row) => row.className },
        { header: "Filles", render: (row) => row.girls, align: "center" as const },
        { header: "Garçons", render: (row) => row.boys, align: "center" as const },
        { header: "Total", render: (row) => row.total, align: "center" as const },
      ], stats.classRows, "Aucune classe à afficher.", { footerHtml: `<tr>${schools.length > 1 ? "<td></td>" : ""}<td>Totaux</td><td class="align-center">${stats.totalGirls}</td><td class="align-center">${stats.totalBoys}</td><td class="align-center">${stats.totalStudents}</td></tr>` }), { pageBreakBefore: true }),
    ],
  });
}
