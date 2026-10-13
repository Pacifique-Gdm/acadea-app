import type { School } from "../types";
import { listPayrollHistoryPage, type PayrollHistoryCursor, type PayrollHistoryEntry } from "../services/personnelPayroll";
import { formatCurrencyMoney } from "./currency";
import { pdfSection, pdfTable } from "./pdf";

export const MAX_PAYROLL_EXPORT_ROWS = 500;

export async function collectPayrollHistoryForExport(schoolId: string, startDate: string, endDate: string,
  load = listPayrollHistoryPage): Promise<PayrollHistoryEntry[]> {
  const entries: PayrollHistoryEntry[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: PayrollHistoryCursor | undefined;
  do {
    const page = await load(schoolId, cursor, { startDate, endDate });
    for (const payment of page.payments) {
      if (seen.has(payment.id)) continue;
      seen.add(payment.id);
      entries.push(payment);
    }
    if (entries.length > MAX_PAYROLL_EXPORT_ROWS || entries.length === MAX_PAYROLL_EXPORT_ROWS && page.nextCursor) {
      throw new Error("L'export dépasse 500 opérations. Réduisez la période ou choisissez une école.");
    }
    if (!page.nextCursor) break;
    const key = page.nextCursor.paidAt + ":" + page.nextCursor.id;
    if (cursors.has(key)) throw new Error("Pagination de l'historique incohérente. Réessayez avec une période plus courte.");
    cursors.add(key);
    cursor = page.nextCursor;
  } while (cursor);
  return entries;
}

export function personnelPayrollHistoryPdfSections(payments: PayrollHistoryEntry[], schools: School[]) {
  const allowed = new Map(schools.map((school) => [school.id, school.name]));
  if (payments.some((payment) => !allowed.has(payment.schoolId))) throw new Error("Historique hors périmètre : export refusé.");
  const totals = new Map<string, { count: number; gross: number; net: number }>();
  for (const payment of payments) {
    const item = totals.get(payment.currency) ?? { count: 0, gross: 0, net: 0 };
    item.count++; item.gross += payment.amount; item.net += payment.netPaid;
    totals.set(payment.currency, item);
  }
  return [pdfSection("HISTORIQUE SALAIRE/PRIME", pdfTable([
    { header: "École", render: (payment: PayrollHistoryEntry) => allowed.get(payment.schoolId) ?? "" },
    { header: "Date", render: (payment) => payment.paidAt },
    { header: "Nature", render: (payment) => payment.kind === "salary" ? "Salaire" : "Prime" },
    { header: "Bénéficiaire", render: (payment) => payment.beneficiaryName },
    { header: "Référence", render: (payment) => payment.reference },
    { header: "Brut", render: (payment) => formatCurrencyMoney(payment.amount, payment.currency), align: "right" },
    { header: "Net payé", render: (payment) => formatCurrencyMoney(payment.netPaid, payment.currency), align: "right" },
  ], payments, "Aucun salaire ou prime pour ces filtres.")),
  pdfSection("TOTAUX PAR DEVISE", pdfTable([
    { header: "Devise", render: (item: [string, { count: number; gross: number; net: number }]) => item[0] },
    { header: "Opérations", render: (item) => item[1].count },
    { header: "Brut", render: (item) => formatCurrencyMoney(item[1].gross, item[0] as PayrollHistoryEntry["currency"]), align: "right" },
    { header: "Net payé", render: (item) => formatCurrencyMoney(item[1].net, item[0] as PayrollHistoryEntry["currency"]), align: "right" },
  ], [...totals], "Aucune opération."))];
}
