import type { School, SchoolYear } from "../types";
import type { DashboardFeeProgressRow, DashboardFeeShare } from "./dashboardStats";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";
import { formatCurrencyMoney, resolveSchoolYearCurrency, type SchoolCurrency } from "./currency";

type DashboardTransaction = { id: string; type: string; label: string; amount: number; currency: SchoolCurrency; date: string };
export type DashboardPdfChartRow = { date: string; label: string; payments: number; expenses: number };
type DashboardClassRow = { className: string; girls: number; boys: number; total: number };
const chartColors = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#84cc16", "#f97316"];

/** The PDF uses the same chart values as the screen and prints every amount. */
export function dashboardPdfFeeShareChart(rows: DashboardFeeShare[], currency: SchoolCurrency) {
  if (!rows.length) return "<p>Aucun montant encaissé pour cette sélection.</p>";
  return `<div aria-label="Répartition des montants">${rows.map((row, index) => {
    const width = Math.max(0, Math.min(100, row.percentage));
    const color = row.color && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : chartColors[index % chartColors.length];
    return `<div class="info-box" style="margin-bottom:5px;min-height:0;display:block">
      <div style="display:flex;justify-content:space-between;gap:8px;font-size:9px">
        <strong>${escapePdfHtml(row.name)}</strong><span>${escapePdfHtml(formatCurrencyMoney(row.amount, currency))} · ${escapePdfHtml(row.percentage.toFixed(1))}%</span>
      </div>
      <div style="height:9px;background:#e2e8f0;border-radius:4px;margin-top:5px"><div style="width:${width}%;height:9px;background:${color};border-radius:4px"></div></div>
    </div>`;
  }).join("")}</div>`;
}

export function dashboardPdfTransactionChart(rows: DashboardPdfChartRow[], currency: SchoolCurrency, periodLabel: string) {
  if (!rows.length) return "<p>Aucune donnée pour cette période.</p>";
  const maximum = Math.max(1, ...rows.flatMap((row) => [row.payments, row.expenses]));
  return `<p>Période : ${escapePdfHtml(periodLabel)}. Encaissements en vert ; dépenses en rouge.</p>
    <div aria-label="Graphique des transactions">${rows.map((row) => `<div class="info-box" style="margin-bottom:5px;min-height:0;display:block">
      <strong style="font-size:9px">${escapePdfHtml(row.label || row.date)}</strong>
      ${([
        { label: "Paiements", value: row.payments, color: "#10b981" },
        { label: "Dépenses", value: row.expenses, color: "#ef4444" },
      ] as const).map((item) => `<div style="display:flex;align-items:center;gap:5px;font-size:8px;margin-top:4px">
        <span style="width:54px">${item.label}</span><span style="flex:1;height:8px;background:#e2e8f0;border-radius:4px"><span style="display:block;width:${Math.max(0, Math.min(100, item.value / maximum * 100))}%;height:8px;background:${item.color};border-radius:4px"></span></span>
        <span style="width:90px;text-align:right">${escapePdfHtml(formatCurrencyMoney(item.value, currency))}</span>
      </div>`).join("")}
    </div>`).join("")}</div>`;
}

export async function exportDashboardReportPdf({
  school, year, sectionLabel, dateLabel, recoveryRate, totalPayments, arrearsCollections,
  historicalArrears, totalExpenses, official, reduction, expected, remaining, transactions,
  classRows, totalGirls, totalBoys, totalStudents, totalClasses, totalParents, administrators,
  cashiers, disciplineDirectors, feeProgressRows, feeShares, transactionChartRows, transactionPeriodLabel,
}: {
  school: School;
  year: SchoolYear;
  sectionLabel: string;
  dateLabel: string;
  recoveryRate: number;
  totalPayments: number;
  arrearsCollections: { currency: SchoolCurrency; amount: number }[];
  historicalArrears: { USD: number; CDF: number };
  totalExpenses: number;
  official: number;
  reduction: number;
  expected: number;
  remaining: number;
  transactions: DashboardTransaction[];
  classRows: DashboardClassRow[];
  totalGirls: number;
  totalBoys: number;
  totalStudents: number;
  totalClasses: number;
  totalParents: number;
  administrators: number;
  cashiers: number;
  disciplineDirectors: number;
  feeProgressRows: DashboardFeeProgressRow[];
  feeShares: DashboardFeeShare[];
  transactionChartRows: DashboardPdfChartRow[];
  transactionPeriodLabel: string;
}) {
  const yearCurrency = resolveSchoolYearCurrency(year, school);
  if (transactions.some((transaction) => transaction.currency !== yearCurrency)) {
    throw new Error("Export bloqué : une transaction porte une devise différente de l'année scolaire.");
  }
  await renderAcadPdfPreview({
    filename: `dashboard-${year.name}.pdf`, title: "Dashboard", school, year,
    subtitle: `Section : ${sectionLabel} | Tranche de date : ${dateLabel}`,
    throwOnError: true,
    sections: [
      pdfSection("Indicateurs", pdfInfoGrid([
        { label: "Nombre total d'élèves", value: totalStudents },
        { label: "Nombre de classes", value: totalClasses },
        { label: "Nombre total de parents", value: totalParents },
        { label: "Administrateurs", value: administrators },
        { label: "Caissiers", value: cashiers },
        { label: "Directeurs de Discipline", value: disciplineDirectors },
      ], { columns: 3 })),
      pdfSection("KPI financier", pdfInfoGrid([
        { label: "Recouvrement", value: `${recoveryRate}%` },
        { label: "Montant officiel", value: formatCurrencyMoney(official, yearCurrency) },
        { label: "Réductions et exonérations", value: formatCurrencyMoney(reduction, yearCurrency) },
        { label: "Montant net exigible", value: formatCurrencyMoney(expected, yearCurrency) },
        { label: "Frais de l'année encaissés", value: formatCurrencyMoney(totalPayments, yearCurrency) },
        { label: "Dépenses", value: formatCurrencyMoney(totalExpenses, yearCurrency) },
        { label: "Montant restant à payer", value: formatCurrencyMoney(remaining, yearCurrency) },
      ])),
      pdfSection("Arriérés des années antérieures", pdfInfoGrid(([
        { currency: yearCurrency, amount: historicalArrears[yearCurrency] },
        ...(["USD", "CDF"] as const).filter((currency) => currency !== yearCurrency && historicalArrears[currency] > 0).map((currency) => ({ currency, amount: historicalArrears[currency] })),
      ]).map((group) => ({ label: `Dettes historiques (${group.currency})`, value: formatCurrencyMoney(group.amount, group.currency) })))),
      ...(arrearsCollections.length ? [pdfSection("Arriérés encaissés pendant la période, hors recouvrement de l'année", pdfInfoGrid(
        arrearsCollections.map((group) => ({ label: `Arriérés encaissés (${group.currency})`, value: formatCurrencyMoney(group.amount, group.currency) })),
      ))] : []),
      pdfSection("Types de frais", pdfTable([
        { header: "Type", render: (row) => row.name },
        { header: "Officiel", render: (row) => formatCurrencyMoney(row.official ?? row.expected, yearCurrency), align: "right" },
        { header: "Réductions", render: (row) => formatCurrencyMoney(row.reduction ?? 0, yearCurrency), align: "right" },
        { header: "Net exigible", render: (row) => formatCurrencyMoney(row.expected, yearCurrency), align: "right" },
        { header: "Payé", render: (row) => formatCurrencyMoney(row.paid, yearCurrency), align: "right" },
        { header: "Solde", render: (row) => formatCurrencyMoney(row.remaining, yearCurrency), align: "right" },
        { header: "%", render: (row) => `${row.rate}%`, align: "right" },
      ], feeProgressRows, "Aucun frais applicable.")),
      pdfSection("Répartition des montants", dashboardPdfFeeShareChart(feeShares, yearCurrency)),
      pdfSection("Transactions du jour", pdfTable([
        { header: "Date", render: (transaction) => transaction.date.slice(0, 10) },
        { header: "Type", render: (transaction) => transaction.type },
        { header: "Libellé", render: (transaction) => transaction.label },
        { header: "Montant", render: (transaction) => `${transaction.amount >= 0 ? "+" : "-"}${formatCurrencyMoney(Math.abs(transaction.amount), transaction.currency)}`, align: "right" },
      ], transactions, "Aucune transaction pour cette période.")),
      // The preceding transaction table can already flow onto the next physical
      // page. A second forced break then creates an otherwise blank page.
      pdfSection("Graphique des transactions", dashboardPdfTransactionChart(transactionChartRows, yearCurrency, transactionPeriodLabel)),
      pdfSection("Élèves par classe", pdfTable([
        { header: "Classe", render: (row) => row.className },
        { header: "Filles", render: (row) => row.girls, align: "center" },
        { header: "Garçons", render: (row) => row.boys, align: "center" },
        { header: "Total", render: (row) => row.total, align: "center" },
      ], classRows, "Aucune classe à afficher.", { footerHtml: `<tr><td>Totaux</td><td class="align-center">${totalGirls}</td><td class="align-center">${totalBoys}</td><td class="align-center">${totalStudents}</td></tr>` }), { pageBreakBefore: true }),
    ],
  });
}
