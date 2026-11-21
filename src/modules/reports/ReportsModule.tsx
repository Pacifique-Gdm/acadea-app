import { useAdSuppression } from "../../services/adSuppression";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useResolvedExpenseCurrencies } from "../../hooks/useResolvedExpenseCurrencies";
import { Field, FormPanel, Metric } from "../../components/ui";
import { exportReportPdf } from "../../utils/reportPdf";
import { loadReportClassContext } from "../../services/reportClassContext";
import { isFormerStudentPaymentOfYear } from "../../utils/dashboardStats";

const usesSectionFilterEarly = (section: string) => section !== "all";
import { expenseCategoryLabel } from "../../utils/expenseCategory";
import { cashInflowNatureLabel } from "../../utils/cashInflowCategory";
import { formatCurrencyMoney, resolveSchoolYearCurrency } from "../../utils/currency";
import { formatRecordedOperation, formatRecordedTotals, totalsByRecordedCurrency } from "../../utils/operationCurrency";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { buildStats } from "../../utils/stats";
import { sumMoney } from "../../utils/money";
import { getClassSection } from "../../utils/studentClasses";
import type { CashInflow, Expense, FeeType, ParentProfile, Payment, School, SchoolSection, SchoolYear, Student } from "../../types";
import { userFacingError } from "../../utils/userFacingError";
import { ErrorNotice } from "../../components/ui/ErrorNotice";

type ReportsYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  cashInflows?: CashInflow[];
};

type ReportsModuleProps = {
  yearData: ReportsYearData;
  school: School;
  year: SchoolYear;
  refreshing?: boolean;
  refreshError?: string;
};

export function ReportsModule({ yearData, school, year, refreshing = false, refreshError = "" }: ReportsModuleProps) {
  // Écran financier : jamais de publicité dans l'en-tête.
  useAdSuppression();
  const resolvedExpenses = useResolvedExpenseCurrencies(yearData.expenses);
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
  const [exportError, setExportError] = useState("");
  const sectionLabels: Record<"all" | SchoolSection, string> = {
    all: "Toutes les sections",
    ...schoolSectionLabels,
  };
  const reportSectionChoices = useMemo(() => getSchoolSections(school), [school]);
  useEffect(() => {
    if (sectionFilter !== "all" && !reportSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [reportSectionChoices, sectionFilter]);
  const filteredStudents = yearData.students.filter((student) => sectionFilter === "all" || getClassSection(student.className) === sectionFilter);
  const filteredStudentIds = new Set(filteredStudents.map((student) => student.id));
  const payments = yearData.payments.filter((payment) => payment.paidAt >= startDate && payment.paidAt <= endDate && filteredStudentIds.has(payment.studentId));
  const arrearsPayments = yearData.payments.filter((payment) => payment.collectionSchoolYearId === year.id && payment.paidAt >= startDate && payment.paidAt <= endDate && filteredStudentIds.has(payment.currentStudentId ?? ""));
  // Lot 21 : paiements des anciens élèves (archivés), ligne séparée. Ils ne sont
  // rattachés à aucune section de l'année actuelle, comme les dépenses.
  const formerPayments = yearData.payments.filter((payment) => isFormerStudentPaymentOfYear(payment, year.id) && payment.paidAt >= startDate && payment.paidAt <= endDate);
  // Lot 27c-2 : sans filtre de section, chaque paiement d'ancien élève (pas déjà compté avec un élève de l'année)
  // est ajouté à la fois au prévu et aux paiements ; le solde net reste hors arriérés.
  const formerCounted = usesSectionFilterEarly(sectionFilter) ? [] : formerPayments.filter((payment) => !payments.some((item) => item.id === payment.id));
  const formerTotals = { CDF: sumMoney(formerCounted.filter((payment) => payment.currency === "CDF").map((payment) => payment.amount)), USD: sumMoney(formerCounted.filter((payment) => payment.currency !== "CDF").map((payment) => payment.amount)) };
  const formerByCurrency = (["USD", "CDF"] as const).map((currency) => ({ currency, amount: sumMoney(formerPayments.filter((payment) => payment.currency === currency).map((payment) => payment.amount)) })).filter((group) => group.amount > 0);
  const arrearsByCurrency = (["USD", "CDF"] as const).map((currency) => ({ currency, amount: sumMoney(arrearsPayments.filter((payment) => payment.currency === currency).map((payment) => payment.amount)) })).filter((group) => group.amount > 0);
  const expenses = resolvedExpenses.filter((expense) => expense.spentAt >= startDate && expense.spentAt <= endDate);
  const cashInflows = (yearData.cashInflows ?? []).filter((inflow) => inflow.entryDate >= startDate && inflow.entryDate <= endDate);
  const paidTotals = totalsByRecordedCurrency([...payments, ...formerCounted]);
  const inflowTotals = totalsByRecordedCurrency(cashInflows);
  const spentTotals = totalsByRecordedCurrency(expenses);
  const hasUnknownCurrency = paidTotals.unknownCount + inflowTotals.unknownCount + spentTotals.unknownCount
    + arrearsPayments.filter((payment) => payment.currency !== "CDF" && payment.currency !== "USD").length > 0;
  const yearCurrency = resolveSchoolYearCurrency(year, school);
  const yearFormer = formerTotals[resolveSchoolYearCurrency(year, school)];
  const expected = sumMoney([buildStats(filteredStudents, yearData.parents, yearData.feeTypes, payments).expected, yearFormer]);
  const recovery = !hasUnknownCurrency && paidTotals[yearCurrency === "CDF" ? "USD" : "CDF"] === 0 && expected > 0
    ? Math.round((paidTotals[yearCurrency] / expected) * 100) : null;
  const usesSectionFilter = sectionFilter !== "all";
  // Toutes les lignes comptées dans la synthèse, y compris les paiements d'anciens élèves.
  const reportPayments = [...payments, ...formerCounted];
  async function exportPdf() {
    setExportError("");
    try {
      const classContext = await loadReportClassContext({ schoolId: school.id, schoolYearId: year.id, students: yearData.students, payments: reportPayments });
      await exportReportPdf(school, year, startDate, endDate, sectionLabels[sectionFilter], usesSectionFilter, paidTotals, spentTotals, recovery, reportPayments, expenses, yearData.students, arrearsPayments, cashInflows, formerTotals, classContext);
    } catch (error) {
      setExportError(userFacingError(error, "La génération du PDF a échoué."));
    }
  }
  const netTotals = { CDF: sumMoney([paidTotals.CDF, -formerTotals.CDF, inflowTotals.CDF, -spentTotals.CDF]),
    USD: sumMoney([paidTotals.USD, -formerTotals.USD, inflowTotals.USD, -spentTotals.USD]), unknownCount: 0 };

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Date début" value={startDate} onChange={setStartDate} type="date" />
          <Field label="Date fin" value={endDate} onChange={setEndDate} type="date" />
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Section
            <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as "all" | SchoolSection)} className="input">
              <option value="all">Toutes</option>
              {reportSectionChoices.map((section) => (
                <option key={section} value={section}>{sectionLabels[section]}</option>
              ))}
            </select>
          </label>
          <button disabled={hasUnknownCurrency || refreshing || Boolean(refreshError)} onClick={() => { if (!refreshing && !refreshError) void exportPdf(); }} className="primary-button self-end">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
        <ErrorNotice error={exportError} onRetry={() => void exportPdf()} />
        {hasUnknownCurrency && <p className="mt-3 rounded bg-red-50 p-3 text-sm font-semibold text-red-700">Rapport et export bloqués : des opérations historiques sans devise exigent une réconciliation.</p>}
        {(refreshing || refreshError) && <p role="status" className="mt-3 rounded bg-amber-50 p-3 text-sm">{refreshing ? "Vérification des données financières auprès du serveur…" : refreshError} Les chiffres affichés sont conservés ; export suspendu jusqu’à confirmation.</p>}
        {usesSectionFilter && (
          <p className="mt-3 rounded bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            Les dépenses et autres entrées de caisse présentées sont globales pour l'école, car elles ne sont pas rattachées à une section.
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Paiements des frais de l'année" value={hasUnknownCurrency ? "Indéterminé" : `${formatRecordedTotals(paidTotals, yearCurrency)}${formerTotals.CDF || formerTotals.USD ? ` (dont anciens élèves : ${formatRecordedTotals({ ...formerTotals, unknownCount: 0 }, yearCurrency)})` : ""}`} />
        <Metric label="Autres entrées de caisse" value={hasUnknownCurrency ? "Indéterminé" : formatRecordedTotals(inflowTotals, yearCurrency)} />
        <Metric label="Dépenses" value={hasUnknownCurrency ? "Indéterminé" : formatRecordedTotals(spentTotals, yearCurrency)} />
        <Metric label="Solde net hors arriérés" value={hasUnknownCurrency ? "Indéterminé" : formatRecordedTotals(netTotals, yearCurrency)} />
        <Metric label="Recouvrement période" value={recovery === null ? "Non calculable" : `${recovery}%`} />
      </div>
      {arrearsByCurrency.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">
        <h2 className="font-bold">Arriérés encaissés pendant la période</h2>
        <p className="text-slate-600">Ces encaissements sont distincts du recouvrement des frais de l'année actuelle.</p>
        {arrearsByCurrency.map((group) => <p key={group.currency} className="font-semibold">{formatCurrencyMoney(group.amount, group.currency)}</p>)}
      </div>}
      {formerByCurrency.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm" data-testid="former-student-payments">
        <h2 className="font-bold">Paiements anciens élèves</h2>
        <p className="text-slate-600">Dettes réglées par des élèves qui ont quitté l'école, encaissées en {year.name}.{usesSectionFilterEarly(sectionFilter) ? " Rattachées à aucune section : hors de ce filtre." : " Comptées à la fois dans le prévu et dans les paiements des frais de l'année."}</p>
        {formerByCurrency.map((group) => <p key={group.currency} className="font-semibold">{formatCurrencyMoney(group.amount, group.currency)}</p>)}
        {formerPayments.map((payment) => <p key={payment.id} className="break-words text-slate-600">{payment.paidAt} · {payment.feeName ?? "Frais"} · {payment.debtSchoolYearName ?? payment.schoolYearId} · {payment.receiptNumber} · {formatCurrencyMoney(payment.amount, payment.currency === "CDF" ? "CDF" : "USD")}</p>)}
      </div>}
      <div className="grid min-w-0 grid-cols-1 gap-4">
        <FormPanel title="Paiements">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {payments.map((payment) => {
              const student = filteredStudents.find((item) => item.id === payment.studentId);
              return (
                <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                  <p className="break-words font-semibold text-ink">{student ? `${student.nom} ${student.prenom}` : "Élève"}</p>
                  <p className="break-words text-slate-500">{formatRecordedOperation(payment)} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
            {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement sur cette période.</p>}
          </div>
        </FormPanel>
        <FormPanel title="Dépenses">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {expenses.map((expense) => (
              <div key={expense.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                <p className="break-words font-semibold text-ink">{expenseCategoryLabel(expense.category, expense.categoryDetail)}</p>
                <p className="break-words text-slate-500">{formatRecordedOperation(expense)} | {expense.spentAt} | {expense.cashierName}</p>
                <p className="break-words text-slate-500">{expense.description}</p>
              </div>
            ))}
            {expenses.length === 0 && <p className="text-sm text-slate-500">Aucune dépense sur cette période.</p>}
          </div>
        </FormPanel>
        <FormPanel title="Autres entrées de caisses">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {cashInflows.map((inflow) => <div key={inflow.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
              <p className="break-words font-semibold text-ink">{cashInflowNatureLabel(inflow)} · {formatRecordedOperation(inflow)}</p>
              <p className="break-words text-slate-500">{inflow.entryDate} · {inflow.source} · {inflow.cashierName}</p>
              <p className="break-words text-slate-500">{inflow.description}</p>
            </div>)}
            {cashInflows.length === 0 && <p className="text-sm text-slate-500">Aucune autre entrée de caisse sur cette période.</p>}
          </div>
        </FormPanel>
        {arrearsPayments.length > 0 && <FormPanel title="Règlements de dettes antérieures">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {arrearsPayments.map((payment) => {
              const student = filteredStudents.find((item) => item.id === payment.currentStudentId);
              return <div key={payment.id} className="min-w-0 rounded bg-amber-50 p-3 text-sm">
                <p className="break-words font-semibold">{student ? `${student.nom} ${student.prenom}` : "Élève"} · {payment.feeName ?? "Frais"} · {payment.debtSchoolYearName ?? payment.schoolYearId}</p>
                <p className="break-words text-slate-600">{payment.paidAt} · {formatRecordedOperation(payment)} · {payment.receiptNumber ?? payment.id}</p>
              </div>;
            })}
          </div>
        </FormPanel>}
      </div>
    </section>
  );
}
