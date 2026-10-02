import type { HistoricalDebt } from "../../services/financialTransactions";
import { formatCurrencyMoney } from "../../utils/currency";
import { pdfSection, pdfTable } from "../../utils/pdf";

export function historicalArrearsPdfSection(arrears: HistoricalDebt[]) {
  return pdfSection("Arriérés des années antérieures", pdfTable([
    { header: "Année d'origine", render: (debt: HistoricalDebt) => debt.yearName },
    { header: "Type de frais", render: (debt: HistoricalDebt) => debt.feeName },
    { header: "Attendu", render: (debt: HistoricalDebt) => formatCurrencyMoney(debt.expected, debt.currency), align: "right" },
    { header: "Payé", render: (debt: HistoricalDebt) => formatCurrencyMoney(debt.paid, debt.currency), align: "right" },
    { header: "Restant", render: (debt: HistoricalDebt) => formatCurrencyMoney(debt.remaining, debt.currency), align: "right" },
  ], arrears, "Aucun arriéré pour cet élève."));
}
