import type { CashInflow, Expense, Payment, School, SchoolClassRecord, SchoolYear, Student } from "../types";
import { escapePdfHtml, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "./pdf";
import { formatCurrencyMoney, resolveSchoolYearCurrency } from "./currency";
import { formatRecordedTotals, totalsByRecordedCurrency } from "./operationCurrency";
import { sumMoney } from "./money";
import { expenseCategoryLabel } from "./expenseCategory";
import { cashInflowNatureLabel } from "./cashInflowCategory";
import { formatOperationalStudentClassName } from "../services/schoolSubclasses";
import { schoolOptionDisplayName } from "./schoolOptions";

/** Données pour la colonne « Classe » : classes (sous-classes) des années concernées
 * et fiches des anciens élèves qui ne sont pas dans la liste de l'année. */
export type ReportClassContext = {
  classes?: readonly SchoolClassRecord[];
  extraStudents?: readonly Student[];
};

export async function exportReportPdf(
  school: School,
  year: SchoolYear,
  startDate: string,
  endDate: string,
  sectionLabel: string,
  showGlobalExpenseNote: boolean,
  paid: ReturnType<typeof totalsByRecordedCurrency>,
  spent: ReturnType<typeof totalsByRecordedCurrency>,
  recovery: number | null,
  payments: Payment[],
  expenses: Expense[],
  students: Student[],
  arrearsPayments: Payment[] = [],
  cashInflows: CashInflow[] = [],
  /** Lot 27c-2 : paiements d'anciens élèves, déjà inclus dans `paid` (et dans le prévu) ; le solde reste hors arriérés. */
  former: { CDF: number; USD: number } = { CDF: 0, USD: 0 },
  classContext: ReportClassContext = {},
) {
  if (paid.unknownCount || spent.unknownCount || cashInflows.some((inflow) => inflow.currency !== "CDF" && inflow.currency !== "USD") || arrearsPayments.some((payment) => payment.currency !== "CDF" && payment.currency !== "USD")) {
    throw new Error("Export bloqué : devise historique inconnue.");
  }
  const defaultCurrency = resolveSchoolYearCurrency(year, school);
  const studentById = new Map([...(classContext.extraStudents ?? []), ...students].map((student) => [student.id, student]));
  const classes = classContext.classes ?? [];
  const fallback = "—";
  const timestampForSort = (value?: string) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? Number.POSITIVE_INFINITY : date.getTime();
  };
  const compareByPrimaryThenCreatedAt = (
    first: { id: string; createdAt?: string },
    second: { id: string; createdAt?: string },
    firstPrimary?: string,
    secondPrimary?: string,
  ) => {
    const primaryDiff = timestampForSort(firstPrimary) - timestampForSort(secondPrimary);
    if (primaryDiff !== 0) return primaryDiff;
    const createdDiff = timestampForSort(first.createdAt) - timestampForSort(second.createdAt);
    if (createdDiff !== 0) return createdDiff;
    return first.id.localeCompare(second.id, "fr");
  };
  const sortedPayments = [...payments].sort((first, second) => compareByPrimaryThenCreatedAt(first, second, first.paidAt, second.paidAt));
  const sortedExpenses = [...expenses].sort((first, second) => compareByPrimaryThenCreatedAt(first, second, first.spentAt, second.spentAt));
  const sortedCashInflows = [...cashInflows].sort((first, second) => compareByPrimaryThenCreatedAt(first, second, first.entryDate, second.entryDate));
  const inflowTotals = totalsByRecordedCurrency(cashInflows);
  // Le tableau liste toutes les lignes : son total doit être exactement celui de la synthèse.
  const paymentRowTotals = totalsByRecordedCurrency(sortedPayments);
  const expenseRowTotals = totalsByRecordedCurrency(sortedExpenses);
  if (paymentRowTotals.CDF !== paid.CDF || paymentRowTotals.USD !== paid.USD || expenseRowTotals.CDF !== spent.CDF || expenseRowTotals.USD !== spent.USD) {
    throw new Error("Export bloqué : les lignes du rapport ne correspondent pas aux totaux de la synthèse.");
  }
  const studentForPayment = (payment: Payment) => studentById.get(payment.currentStudentId ?? payment.studentId)
    ?? studentById.get(payment.studentId) ?? (payment.formerStudentId ? studentById.get(payment.formerStudentId) : undefined);
  const studentNameForPayment = (payment: Payment) => {
    const student = studentForPayment(payment);
    if (!student) return fallback;
    return `${student.nom} ${student.postnom} ${student.prenom}`.trim() || fallback;
  };
  // Classe opérationnelle, même libellé que la liste des élèves : classe + option ou sous-classe
  // au secondaire, classe seule au primaire. Pour un ancien élève, la fiche de l'année du paiement
  // (`studentId`) passe avant sa dernière fiche archivée (`formerStudentId`).
  const classForPayment = (payment: Payment) => {
    const student = (payment.formerStudent ? studentById.get(payment.studentId) : undefined) ?? studentForPayment(payment);
    if (!student?.className) return fallback;
    const option = student.option ? schoolOptionDisplayName(school, student.option) : student.option;
    return formatOperationalStudentClassName({ ...student, option }, classes).trim() || fallback;
  };
  const totalFooter = (label: string, columnsBefore: number, columnsAfter: number, totals: ReturnType<typeof totalsByRecordedCurrency>) =>
    `<tr><td colspan="${columnsBefore}"><strong>${escapePdfHtml(label)}</strong></td><td class="align-right"><strong>${escapePdfHtml(formatRecordedTotals(totals, defaultCurrency))}</strong></td>${columnsAfter ? `<td colspan="${columnsAfter}"></td>` : ""}</tr>`;
  const timeFromDate = (value?: string) => {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  };

  await renderAcadPdfPreview({
    filename: `rapport-${startDate}-${endDate}.pdf`,
    title: "Rapport Financier",
    school,
    year,
    subtitle: `Période : ${startDate} au ${endDate}`,
    sections: [
      pdfSection(
        "Synthèse",
        pdfInfoGrid([
          { label: "Section", value: sectionLabel },
          { label: "Paiements", value: `${formatRecordedTotals(paid, defaultCurrency)}${former.CDF || former.USD ? ` (dont anciens élèves : ${formatRecordedTotals({ ...former, unknownCount: 0 }, defaultCurrency)})` : ""}` },
          { label: "Autres entrées de caisse", value: formatRecordedTotals(inflowTotals, defaultCurrency) },
          { label: "Dépenses", value: formatRecordedTotals(spent, defaultCurrency) },
          { label: "Solde", value: formatRecordedTotals({ CDF: sumMoney([paid.CDF, -former.CDF, inflowTotals.CDF, -spent.CDF]), USD: sumMoney([paid.USD, -former.USD, inflowTotals.USD, -spent.USD]), unknownCount: 0 }, defaultCurrency) },
          { label: "Recouvrement", value: recovery === null ? "Non calculable" : `${recovery}%` },
          ...(showGlobalExpenseNote
            ? [{ label: "Note caisse", value: "Les dépenses et autres entrées de caisse sont globales pour l'école, car elles ne sont pas rattachées à une section." }]
            : []),
        ]),
      ),
      pdfSection("Autres entrées de caisse", pdfTable([
        { header: "Date", render: (inflow: CashInflow) => inflow.entryDate },
        { header: "Nature", render: (inflow: CashInflow) => escapePdfHtml(cashInflowNatureLabel(inflow)) },
        { header: "Provenance", render: (inflow: CashInflow) => inflow.source },
        { header: "Description", render: (inflow: CashInflow) => inflow.description },
        { header: "Caissier", render: (inflow: CashInflow) => inflow.cashierName },
        { header: "Montant", render: (inflow: CashInflow) => formatCurrencyMoney(inflow.amount, inflow.currency), align: "right" },
      ], sortedCashInflows, "Aucune autre entrée de caisse pour cette période.")),
      pdfSection(
        "Paiements",
        pdfTable(
          [
            { header: "Date", render: (payment) => payment.paidAt },
            { header: "Nom de l'élève", render: studentNameForPayment },
            { header: "Classe", render: classForPayment },
            { header: "Caissier", render: (payment) => payment.cashierName },
            { header: "Montant", render: (payment) => formatCurrencyMoney(payment.amount, payment.currency!), align: "right" },
            { header: "Reçu", render: (payment) => payment.receiptNumber ?? payment.id },
          ],
          sortedPayments,
          "Aucun paiement pour cette période.",
          sortedPayments.length ? { footerHtml: totalFooter(`Total des ${sortedPayments.length} paiements`, 4, 1, totalsByRecordedCurrency(sortedPayments)) } : {},
        ),
      ),
      ...(arrearsPayments.length ? [pdfSection(
        "Arriérés encaissés pendant la période — hors recouvrement courant",
        pdfTable(
          [
            { header: "Date", render: (payment: Payment) => payment.paidAt },
            { header: "Élève", render: studentNameForPayment },
            { header: "Frais d'origine", render: (payment: Payment) => payment.feeName ?? fallback },
            { header: "Année d'origine", render: (payment: Payment) => payment.debtSchoolYearName ?? payment.schoolYearId },
            { header: "Montant", render: (payment: Payment) => formatCurrencyMoney(payment.amount, payment.currency!), align: "right" },
            { header: "Reçu", render: (payment: Payment) => payment.receiptNumber ?? payment.id },
          ],
          arrearsPayments,
          "Aucun règlement d'arriéré.",
        ),
      )] : []),
      pdfSection(
        "Dépenses",
        pdfTable(
          [
            { header: "Date", render: (expense) => expense.spentAt },
            { header: "Heure", render: (expense) => timeFromDate(expense.spentAt), align: "center" },
            { header: "Catégorie", render: (expense) => expenseCategoryLabel(expense.category, expense.categoryDetail) },
            { header: "Caissier", render: (expense) => expense.cashierName || fallback },
            { header: "Montant", render: (expense) => formatCurrencyMoney(expense.amount, expense.currency!), align: "right" },
            { header: "Description", render: (expense) => expense.description },
          ],
          sortedExpenses,
          "Aucune dépense pour cette période.",
          sortedExpenses.length ? { footerHtml: totalFooter(`Total des ${sortedExpenses.length} dépenses`, 4, 1, totalsByRecordedCurrency(sortedExpenses)) } : {},
        ),
        { pageBreakBefore: true },
      ),
    ],
  });
}
