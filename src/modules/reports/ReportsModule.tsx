import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Field, FormPanel, Metric } from "../../components/ui";
import { exportReportPdf } from "../../utils/reportPdf";
import { formatCurrencyMoney, formatSchoolMoney, resolveSchoolYearCurrency } from "../../utils/currency";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { buildStats } from "../../utils/stats";
import { getClassSection } from "../../utils/studentClasses";
import type { Expense, FeeType, ParentProfile, Payment, School, SchoolSection, SchoolYear, Student } from "../../types";

type ReportsYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
};

type ReportsModuleProps = {
  yearData: ReportsYearData;
  school: School;
  year: SchoolYear;
};

export function ReportsModule({ yearData, school, year }: ReportsModuleProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
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
  const arrearsByCurrency = (["USD", "CDF"] as const).map((currency) => ({ currency, amount: arrearsPayments.filter((payment) => payment.currency === currency).reduce((total, payment) => total + payment.amount, 0) })).filter((group) => group.amount > 0);
  const expenses = yearData.expenses.filter((expense) => expense.spentAt >= startDate && expense.spentAt <= endDate);
  const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const spent = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const expected = buildStats(filteredStudents, yearData.parents, yearData.feeTypes, payments).expected;
  const recovery = expected > 0 ? Math.round((paid / expected) * 100) : 0;
  const usesSectionFilter = sectionFilter !== "all";

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
          <button onClick={() => exportReportPdf(school, year, startDate, endDate, sectionLabels[sectionFilter], usesSectionFilter, paid, spent, recovery, payments, expenses, filteredStudents, arrearsPayments)} className="primary-button self-end">
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
        {usesSectionFilter && (
          <p className="mt-3 rounded bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            Les dépenses présentées sont globales pour l'école, car elles ne sont pas rattachées à une section.
          </p>
        )}
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Paiements des frais de l'année" value={formatSchoolMoney(paid, { currency: resolveSchoolYearCurrency(year, school) })} />
        <Metric label="Dépenses" value={formatSchoolMoney(spent, { currency: resolveSchoolYearCurrency(year, school) })} />
        <Metric label="Solde net hors arriérés" value={formatSchoolMoney(paid - spent, { currency: resolveSchoolYearCurrency(year, school) })} />
        <Metric label="Recouvrement période" value={`${recovery}%`} />
      </div>
      {arrearsByCurrency.length > 0 && <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm">
        <h2 className="font-bold">Arriérés encaissés pendant la période</h2>
        <p className="text-slate-600">Ces encaissements sont distincts du recouvrement des frais de l'année actuelle.</p>
        {arrearsByCurrency.map((group) => <p key={group.currency} className="font-semibold">{formatCurrencyMoney(group.amount, group.currency)}</p>)}
      </div>}
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <FormPanel title="Paiements">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {payments.map((payment) => {
              const student = filteredStudents.find((item) => item.id === payment.studentId);
              return (
                <div key={payment.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                  <p className="break-words font-semibold text-ink">{student ? `${student.nom} ${student.prenom}` : "Élève"}</p>
                  <p className="break-words text-slate-500">${payment.amount} | {payment.paidAt} | {payment.cashierName}</p>
                </div>
              );
            })}
            {payments.length === 0 && <p className="text-sm text-slate-500">Aucun paiement sur cette période.</p>}
          </div>
        </FormPanel>
        {arrearsPayments.length > 0 && <FormPanel title="Règlements de dettes antérieures">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {arrearsPayments.map((payment) => {
              const student = filteredStudents.find((item) => item.id === payment.currentStudentId);
              return <div key={payment.id} className="min-w-0 rounded bg-amber-50 p-3 text-sm">
                <p className="break-words font-semibold">{student ? `${student.nom} ${student.prenom}` : "Élève"} · {payment.feeName ?? "Frais"} · {payment.debtSchoolYearName ?? payment.schoolYearId}</p>
                <p className="break-words text-slate-600">{payment.paidAt} · {formatCurrencyMoney(payment.amount, payment.currency ?? "USD")} · {payment.receiptNumber ?? payment.id}</p>
              </div>;
            })}
          </div>
        </FormPanel>}
        <FormPanel title="Dépenses">
          <div className="max-h-96 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {expenses.map((expense) => (
              <div key={expense.id} className="min-w-0 rounded bg-slate-50 p-3 text-sm">
                <p className="break-words font-semibold text-ink">{expense.category}</p>
                <p className="break-words text-slate-500">${expense.amount} | {expense.spentAt} | {expense.cashierName}</p>
                <p className="break-words text-slate-500">{expense.description}</p>
              </div>
            ))}
            {expenses.length === 0 && <p className="text-sm text-slate-500">Aucune dépense sur cette période.</p>}
          </div>
        </FormPanel>
      </div>
    </section>
  );
}
