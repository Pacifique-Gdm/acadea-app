import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Banknote, BarChart3, BookOpen, Download, GraduationCap, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";
import { FormPanel, Metric } from "../../components/ui";
import { buildDashboardFinancialAggregates, buildDashboardTransactionDayRows } from "../../utils/dashboardStats";
import { buildSchoolYearDataIndexes } from "../../utils/dataIndexes";
import { exportDashboardReportPdf } from "../../utils/dashboardPdf";
import { money } from "../../utils/pdf";
import { getSchoolClassChoices, getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { buildStats } from "../../utils/stats";
import { formatStudentClassName, getClassSection } from "../../utils/studentClasses";
import type { AppUser, Expense, FeeType, ParentProfile, Payment, School, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";

type DashboardData = {
  students: Student[];
  parents: ParentProfile[];
  users: AppUser[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
};

type DashboardProps = {
  data: DashboardData;
  school: School;
  year: SchoolYear;
};

type TransactionPeriod = "today" | "last5" | "week";
type TransactionChartItem = {
  id: string;
  kind: "payment" | "expense";
  type: string;
  label: string;
  amount: number;
  date: string;
  occurredAt?: string;
  status?: string;
  studentName?: string;
  className?: string;
  feeName?: string;
  agentName?: string;
};
type TransactionChartRow = { date: string; label: string; payments: number; expenses: number; transactions: TransactionChartItem[] };
const transactionAxisStep = 1500;

const transactionPeriodLabels: Record<TransactionPeriod, string> = {
  today: "Aujourd'hui",
  last5: "5 derniers jours",
  week: "Semaine en cours",
};

function toDateKey(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function getTransactionPeriodDates(period: TransactionPeriod, now = new Date()) {
  if (period === "today") return [toDateKey(now)];
  if (period === "last5") {
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (4 - index));
      return toDateKey(date);
    });
  }
  const monday = new Date(now);
  const day = monday.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  monday.setDate(now.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toDateKey(date);
  });
}

function formatChartDate(dateKey: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "2-digit" }).format(new Date(`${dateKey}T12:00:00`));
}

function formatChartTooltipDate(dateKey: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${dateKey}T12:00:00`));
}

function formatAxisAmount(value: number) {
  return new Intl.NumberFormat("fr-FR").format(value);
}

function getChartMaxAmount(rows: TransactionChartRow[]) {
  const maxAmount = Math.max(1, ...rows.map((row) => Math.max(row.payments, row.expenses)));
  return Math.max(transactionAxisStep, Math.ceil(maxAmount / transactionAxisStep) * transactionAxisStep);
}

function TransactionComboChart({
  rows,
  period,
  onPeriodChange,
}: {
  rows: TransactionChartRow[];
  period: TransactionPeriod;
  onPeriodChange: (period: TransactionPeriod) => void;
}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const chartWidth = Math.max(560, rows.length * 96);
  const chartHeight = 180;
  const margin = { top: 16, right: 24, bottom: 34, left: 54 };
  const plotWidth = chartWidth - margin.left - margin.right;
  const plotHeight = chartHeight - margin.top - margin.bottom;
  const chartMax = getChartMaxAmount(rows);
  const baseline = margin.top + plotHeight;
  const groupWidth = rows.length > 0 ? plotWidth / rows.length : plotWidth;
  const barWidth = Math.min(18, groupWidth * 0.22);
  const barGap = 6;
  const yFor = (value: number) => baseline - (value / chartMax) * plotHeight;
  const paymentPoints = rows.map((row, index) => {
    const centerX = margin.left + groupWidth * index + groupWidth / 2;
    return { x: centerX - barWidth / 2 - barGap / 2, y: yFor(row.payments) };
  });
  const expensePoints = rows.map((row, index) => {
    const centerX = margin.left + groupWidth * index + groupWidth / 2;
    return { x: centerX + barWidth / 2 + barGap / 2, y: yFor(row.expenses) };
  });
  const pathFromPoints = (points: { x: number; y: number }[]) => points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const ticks = Array.from({ length: chartMax / transactionAxisStep + 1 }, (_, index) => index * transactionAxisStep);
  const selectedRow = selectedDate ? rows.find((row) => row.date === selectedDate) : null;
  const selectedTransactions = selectedRow ? [...selectedRow.transactions].sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date)) : [];

  function formatTransactionDateTime(value?: string) {
    if (!value) return "-";
    const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  return (
    <section className="min-w-0 max-w-full rounded border border-slate-200 bg-slate-50/70 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-ink">Mouvement des transactions par jour</h3>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-mint" /> Paiements</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Dépenses</span>
          </div>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded border border-slate-200 bg-white text-xs font-semibold text-slate-600">
          {(Object.keys(transactionPeriodLabels) as TransactionPeriod[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setSelectedDate(null);
                onPeriodChange(item);
              }}
              className={`px-2 py-2 transition ${period === item ? "bg-ink text-white" : "hover:bg-slate-50"}`}
            >
              {transactionPeriodLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 max-w-full overflow-hidden pb-1 sm:overflow-x-auto">
        <svg
          className="block h-auto w-full max-w-full sm:min-w-[var(--transaction-chart-width)]"
          style={{ "--transaction-chart-width": `${chartWidth}px` } as CSSProperties}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label="Mouvement des paiements et dépenses par jour"
        >
          <rect x="0" y="0" width={chartWidth} height={chartHeight} rx="10" fill="white" />
          {ticks.map((tick) => {
            const y = yFor(tick);
            return (
              <g key={tick}>
                <line x1={margin.left} x2={chartWidth - margin.right} y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={margin.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold">
                  {formatAxisAmount(tick)}
                </text>
              </g>
            );
          })}
          <line x1={margin.left} x2={margin.left} y1={margin.top} y2={baseline} stroke="#cbd5e1" strokeWidth="1" />
          <line x1={margin.left} x2={chartWidth - margin.right} y1={baseline} y2={baseline} stroke="#cbd5e1" strokeWidth="1" />
          {rows.map((row, index) => {
            const centerX = margin.left + groupWidth * index + groupWidth / 2;
            const paymentX = centerX - barWidth - barGap / 2;
            const expenseX = centerX + barGap / 2;
            const paymentY = yFor(row.payments);
            const expenseY = yFor(row.expenses);
            const paymentHeight = Math.max(0, baseline - paymentY);
            const expenseHeight = Math.max(0, baseline - expenseY);
            return (
              <g
                key={row.date}
                role="button"
                tabIndex={0}
                className="cursor-pointer outline-none"
                onClick={() => setSelectedDate(row.date)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedDate(row.date);
                  }
                }}
                aria-label={`Afficher les transactions du ${formatChartTooltipDate(row.date)}`}
              >
                <title>{`${formatChartTooltipDate(row.date)}\nPaiements : ${money(row.payments)}\nDépenses : ${money(row.expenses)}\nTotal : ${money(row.payments + row.expenses)}`}</title>
                <rect x={paymentX} y={paymentY} width={barWidth} height={paymentHeight} rx="5" fill="#2a9d8f" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.45s" begin={`${index * 0.04}s`} fill="freeze" />
                </rect>
                <rect x={expenseX} y={expenseY} width={barWidth} height={expenseHeight} rx="5" fill="#dc2626" opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.45s" begin={`${index * 0.04 + 0.04}s`} fill="freeze" />
                </rect>
                <text x={centerX} y={chartHeight - 13} textAnchor="middle" className="fill-slate-600 text-[11px] font-semibold">
                  {row.label}
                </text>
              </g>
            );
          })}
          <path d={pathFromPoints(paymentPoints)} fill="none" stroke="#2a9d8f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.35s" begin="0.2s" fill="freeze" />
          </path>
          <path d={pathFromPoints(expensePoints)} fill="none" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.35s" begin="0.25s" fill="freeze" />
          </path>
          {paymentPoints.map((point, index) => (
            <circle key={`payment-${rows[index].date}`} cx={point.x} cy={point.y} r="4.5" fill="white" stroke="#2a9d8f" strokeWidth="3">
              <title>{`${formatChartTooltipDate(rows[index].date)}\nPaiements : ${money(rows[index].payments)}`}</title>
            </circle>
          ))}
          {expensePoints.map((point, index) => (
            <circle key={`expense-${rows[index].date}`} cx={point.x} cy={point.y} r="4.5" fill="white" stroke="#dc2626" strokeWidth="3">
              <title>{`${formatChartTooltipDate(rows[index].date)}\nDépenses : ${money(rows[index].expenses)}`}</title>
            </circle>
          ))}
          {rows.map((row, index) => {
            const centerX = margin.left + groupWidth * index + groupWidth / 2;
            const hitWidth = Math.max(barWidth * 2 + barGap + 16, Math.min(groupWidth - 4, 54));
            const hitX = centerX - hitWidth / 2;
            return (
              <rect
                key={`hit-${row.date}`}
                x={hitX}
                y={margin.top}
                width={hitWidth}
                height={plotHeight}
                fill="transparent"
                className="cursor-pointer"
                onClick={() => setSelectedDate(row.date)}
                onTouchStart={() => setSelectedDate(row.date)}
                aria-label={`Afficher les transactions du ${formatChartTooltipDate(row.date)}`}
              >
                <title>{`${formatChartTooltipDate(row.date)}\nPaiements : ${money(row.payments)}\nDépenses : ${money(row.expenses)}\nTotal : ${money(row.payments + row.expenses)}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      {selectedRow && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/30 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="grid max-h-[min(520px,calc(100vh-3rem))] w-full max-w-xl min-w-0 animate-[fadeIn_0.18s_ease-out] grid-rows-[auto_auto_minmax(0,1fr)] rounded border border-slate-200 bg-white p-4 text-sm shadow-2xl">
            <div className="flex min-w-0 items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="break-words font-bold text-ink">{formatChartTooltipDate(selectedRow.date)}</p>
                <p className="text-xs text-slate-500">{selectedTransactions.length} transaction(s)</p>
              </div>
              <button onClick={() => setSelectedDate(null)} type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink" aria-label="Fermer le détail des transactions">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="my-3 grid gap-2 text-xs font-semibold text-slate-600 sm:grid-cols-2">
              <span className="rounded bg-mint/10 px-3 py-2">Encaissé : <strong className="text-mint">{money(selectedRow.payments)}</strong></span>
              <span className="rounded bg-red-50 px-3 py-2">Dépenses : <strong className="text-red-600">{money(selectedRow.expenses)}</strong></span>
            </div>
            <div className="min-h-0 max-h-56 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              {selectedTransactions.length > 0 ? (
                selectedTransactions.map((transaction) => (
                  <div key={transaction.id} className="grid min-w-0 gap-2 rounded bg-slate-50 px-3 py-2">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className={`font-semibold ${transaction.kind === "payment" ? "text-mint" : "text-red-600"}`}>{transaction.type}</p>
                        <p className="break-words text-xs text-slate-700">{transaction.label || "Sans libellé"}</p>
                      </div>
                      <span className={transaction.kind === "payment" ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>
                        {(transaction.kind === "payment" ? "+" : "-") + "$" + Math.abs(transaction.amount).toFixed(2)}
                      </span>
                    </div>
                    <div className="grid gap-1 text-[11px] font-semibold text-slate-500">
                      {transaction.kind === "payment" ? (
                        <>
                          <span>Élève : {transaction.studentName ?? "Élève non renseigné"}</span>
                          <span>Classe : {transaction.className ?? "—"} · Frais : {transaction.feeName ?? "—"}</span>
                        </>
                      ) : (
                        <>
                          <span>Dépense : {transaction.label || "Sans motif"}</span>
                          <span>Agent : {transaction.agentName ?? "—"}</span>
                        </>
                      )}
                      <span>Date et heure : {formatTransactionDateTime(transaction.occurredAt ?? transaction.date)}</span>
                      {transaction.status && <span>Statut : {transaction.status}</span>}
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded bg-slate-50 p-3 text-xs text-slate-500">Aucune transaction enregistrée pour ce jour.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function Dashboard({ data, school, year }: DashboardProps) {
  const today = toDateKey(new Date());
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [dateFilterActive, setDateFilterActive] = useState(false);
  const [dateFilterError, setDateFilterError] = useState("");
  const [transactionPeriod, setTransactionPeriod] = useState<TransactionPeriod>("last5");
  const dashboardClassChoices = useMemo(() => getSchoolClassChoices(school), [school]);
  const dashboardSectionChoices = useMemo(() => getSchoolSections(school), [school]);
  useEffect(() => {
    if (sectionFilter !== "all" && !dashboardSectionChoices.includes(sectionFilter)) {
      setSectionFilter("all");
    }
  }, [dashboardSectionChoices, sectionFilter]);
  const yearIndexes = useMemo(() => buildSchoolYearDataIndexes(data.students, data.feeTypes, data.payments), [data.students, data.feeTypes, data.payments]);
  const activeStudents = useMemo(() => data.students.filter((student) => (student.status ?? "ACTIVE") === "ACTIVE"), [data.students]);
  const filteredStudents = useMemo(() => activeStudents.filter((student) => sectionFilter === "all" || getClassSection(student.className) === sectionFilter), [activeStudents, sectionFilter]);
  const filteredStudentIds = useMemo(() => new Set(filteredStudents.map((student) => student.id)), [filteredStudents]);
  const filteredParents = useMemo(() => {
    const filteredParentIds = new Set(filteredStudents.map((student) => student.parentId).filter(Boolean));
    return data.parents.filter((parent) => filteredParentIds.has(parent.id) || parent.studentIds.some((studentId) => filteredStudentIds.has(studentId)));
  }, [data.parents, filteredStudentIds, filteredStudents]);
  const filteredPayments = useMemo(
    () =>
      data.payments.filter((payment) => {
        const normalized = payment.paidAt.slice(0, 10);
        return filteredStudentIds.has(payment.studentId) && (!dateFilterActive || ((!startDate || normalized >= startDate) && (!endDate || normalized <= endDate)));
      }),
    [data.payments, dateFilterActive, endDate, filteredStudentIds, startDate],
  );
  const filteredExpenses = useMemo(
    () =>
      data.expenses.filter((expense) => {
        const normalized = expense.spentAt.slice(0, 10);
        return sectionFilter === "all" && (!dateFilterActive || ((!startDate || normalized >= startDate) && (!endDate || normalized <= endDate)));
      }),
    [data.expenses, dateFilterActive, endDate, sectionFilter, startDate],
  );
  const filteredPaymentIndexes = useMemo(() => buildSchoolYearDataIndexes(filteredStudents, data.feeTypes, filteredPayments), [filteredStudents, data.feeTypes, filteredPayments]);
  const stats = useMemo(() => buildStats(filteredStudents, filteredParents, data.feeTypes, filteredPayments), [data.feeTypes, filteredParents, filteredPayments, filteredStudents]);
  const dashboardFinancialAggregates = useMemo(
    () => buildDashboardFinancialAggregates(filteredStudents, data.feeTypes, filteredPayments, filteredPaymentIndexes),
    [data.feeTypes, filteredPaymentIndexes, filteredPayments, filteredStudents],
  );
  const fullYearFinancialAggregates = useMemo(
    () => buildDashboardFinancialAggregates(activeStudents, data.feeTypes, data.payments, yearIndexes),
    [activeStudents, data.feeTypes, data.payments, yearIndexes],
  );
  const hasDashboardFinancialFilter = sectionFilter !== "all" || dateFilterActive;
  const activeFinancialAggregates = hasDashboardFinancialFilter ? dashboardFinancialAggregates : fullYearFinancialAggregates;
  const dashboardFinancialStats = activeFinancialAggregates.financialStats;
  const totalPayments = dashboardFinancialStats.paid;
  const fullYearExpenses = useMemo(() => data.expenses.reduce((sum, expense) => sum + expense.amount, 0), [data.expenses]);
  const filteredExpensesTotal = useMemo(() => filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0), [filteredExpenses]);
  const totalExpenses = hasDashboardFinancialFilter ? filteredExpensesTotal : fullYearExpenses;
  const remaining = dashboardFinancialStats.remaining;
  const recoveryRate = dashboardFinancialStats.expected > 0 ? Math.round((totalPayments / dashboardFinancialStats.expected) * 100) : 0;
  const recoveryTone = recoveryRate >= 80 ? "text-mint bg-mint/10" : recoveryRate >= 50 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-50";
  const feeProgressRows = activeFinancialAggregates.feeProgressRows;
  const totalActiveStudents = filteredStudents.length;
  const totalUniqueParents = filteredParents.length;
  const admins = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "school_admin").length, [data.users, school.id]);
  const cashiers = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "cashier").length, [data.users, school.id]);
  const disciplineDirectors = useMemo(() => data.users.filter((item) => item.schoolId === school.id && item.role === "discipline_director").length, [data.users, school.id]);
  const classRows = useMemo(
    () =>
      dashboardClassChoices.map((className) => {
        const students = filteredStudents.filter((student) => student.className === className);
        return {
          className,
          girls: students.filter((student) => student.sexe === "F").length,
          boys: students.filter((student) => student.sexe === "M").length,
          total: students.length,
        };
      }).filter((row) => row.total > 0),
    [dashboardClassChoices, filteredStudents],
  );
  const classDisplayRows = useMemo(
    () =>
      Array.from(
        filteredStudents.reduce<Map<string, { className: string; classOrder: number; optionLabel: string; girls: number; boys: number; total: number }>>((items, student) => {
          const isSecondary = getClassSection(student.className) === "secondaire";
          const className = isSecondary ? formatStudentClassName(student) : student.className;
          const current = items.get(className) ?? {
            className,
            classOrder: CLASSES.indexOf(student.className),
            optionLabel: isSecondary ? student.option?.trim() ?? "" : "",
            girls: 0,
            boys: 0,
            total: 0,
          };
          items.set(className, {
            ...current,
            girls: current.girls + (student.sexe === "F" ? 1 : 0),
            boys: current.boys + (student.sexe === "M" ? 1 : 0),
            total: current.total + 1,
          });
          return items;
        }, new Map()).values(),
      ).sort((a, b) => {
        const classOrder = a.classOrder - b.classOrder;
        if (classOrder !== 0) return classOrder;
        return a.optionLabel.localeCompare(b.optionLabel, "fr");
      }),
    [filteredStudents],
  );
  const totalGirls = useMemo(() => classRows.reduce((sum, row) => sum + row.girls, 0), [classRows]);
  const totalBoys = useMemo(() => classRows.reduce((sum, row) => sum + row.boys, 0), [classRows]);
  const totalStudents = totalGirls + totalBoys;
  const studentsById = yearIndexes.studentsById;
  const feeTypesById = yearIndexes.feeTypesById;
  const transactionStartDate = dateFilterActive ? startDate : today;
  const transactionEndDate = dateFilterActive ? endDate : today;
  const transactionPayments = useMemo(
    () =>
      data.payments.filter((payment) => {
        const normalized = payment.paidAt.slice(0, 10);
        return filteredStudentIds.has(payment.studentId) && (!transactionStartDate || normalized >= transactionStartDate) && (!transactionEndDate || normalized <= transactionEndDate);
      }),
    [data.payments, filteredStudentIds, transactionEndDate, transactionStartDate],
  );
  const transactionExpenses = useMemo(
    () =>
      data.expenses.filter((expense) => {
        const normalized = expense.spentAt.slice(0, 10);
        return sectionFilter === "all" && (!transactionStartDate || normalized >= transactionStartDate) && (!transactionEndDate || normalized <= transactionEndDate);
      }),
    [data.expenses, sectionFilter, transactionEndDate, transactionStartDate],
  );
  const transactions = useMemo(
    () =>
      [
        ...transactionPayments.map((payment) => ({ id: payment.id, type: "Paiement", label: payment.cashierName, amount: payment.amount, date: payment.paidAt, occurredAt: payment.createdAt ?? payment.paidAt })),
        ...transactionExpenses.map((expense) => ({ id: expense.id, type: "D\u00e9pense", label: expense.category, amount: -expense.amount, date: expense.spentAt, occurredAt: expense.createdAt ?? expense.spentAt })),
      ].sort((a, b) => (b.occurredAt ?? b.date).localeCompare(a.occurredAt ?? a.date)),
    [transactionExpenses, transactionPayments],
  );
  const chartDates = useMemo(() => getTransactionPeriodDates(transactionPeriod), [transactionPeriod]);
  const transactionDayRows = useMemo(
    () =>
      buildDashboardTransactionDayRows({
        dates: chartDates,
        payments: data.payments,
        expenses: data.expenses,
        studentIds: filteredStudentIds,
        includeExpenses: sectionFilter === "all",
      }),
    [chartDates, data.expenses, data.payments, filteredStudentIds, sectionFilter],
  );
  const transactionChartRows = useMemo(
    () =>
      transactionDayRows.map((row) => ({
        date: row.date,
        label: formatChartDate(row.date),
        payments: row.payments,
        expenses: row.expenses,
        transactions: [
          ...row.paymentsForDate.map((payment): TransactionChartItem => {
            const student = studentsById.get(payment.studentId);
            const fee = feeTypesById.get(payment.feeTypeId);
            return {
              id: payment.id,
              kind: "payment",
              type: "Paiement",
              label: student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : "Élève non renseigné",
              amount: payment.amount,
              date: payment.paidAt,
              occurredAt: payment.createdAt ?? payment.paidAt,
              status: payment.receiptNumber ? `Reçu ${payment.receiptNumber}` : undefined,
              studentName: student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : undefined,
              className: student ? formatStudentClassName(student) : undefined,
              feeName: fee?.name,
              agentName: payment.cashierName,
            };
          }),
          ...row.expensesForDate.map((expense): TransactionChartItem => ({
            id: expense.id,
            kind: "expense",
            type: "Dépense",
            label: expense.description || expense.category,
            amount: expense.amount,
            date: expense.spentAt,
            occurredAt: expense.createdAt ?? expense.spentAt,
            agentName: expense.cashierName,
          })),
        ],
      })),
    [feeTypesById, studentsById, transactionDayRows],
  );
  const sectionLabel = sectionFilter === "all" ? "Toutes les sections" : schoolSectionLabels[sectionFilter];
  const dateLabel = dateFilterActive ? (startDate || "D\u00e9but") + " au " + (endDate || "Fin") : "Année scolaire complète";
  const cards = [
    { label: "Nombre total d'\u00e9l\u00e8ves", value: totalActiveStudents, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre de classes", value: stats.classes, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
    { label: "Nombre total de parents", value: totalUniqueParents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Administrateurs", value: admins, icon: ShieldCheck, tone: "bg-blue-100 text-blue-700" },
    { label: "Caissiers", value: cashiers, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Directeurs de Discipline", value: disciplineDirectors, icon: ShieldCheck, tone: "bg-violet-100 text-violet-700" },
    { label: "Montant attendu", value: "$" + dashboardFinancialStats.expected.toFixed(2), icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
    { label: "Montant total encaiss\u00e9", value: "$" + totalPayments.toFixed(2), icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant restant \u00e0 payer", value: "$" + remaining.toFixed(2), icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
  ];

  function progressBarTone(rate: number) {
    if (rate >= 100) return "bg-emerald-700";
    if (rate >= 80) return "bg-emerald-400";
    if (rate >= 50) return "bg-orange-400";
    return "bg-red-500";
  }

  function exportDashboardPdf() {
    exportDashboardReportPdf({
      school,
      year,
      sectionLabel,
      dateLabel,
      recoveryRate,
      totalPayments,
      totalExpenses,
      expected: dashboardFinancialStats.expected,
      remaining,
      transactions,
      classRows,
      totalGirls,
      totalBoys,
      totalStudents,
    });
  }

  function resetDashboardDateFilter() {
    const currentToday = toDateKey(new Date());
    setStartDate(currentToday);
    setEndDate(currentToday);
    setDateFilterActive(false);
    setDateFilterError("");
  }

  function updateDashboardDateFilter(boundary: "start" | "end", value: string) {
    const currentToday = toDateKey(new Date());
    if (value && value > currentToday) {
      setDateFilterError("Une date future n'est pas autorisée.");
      return;
    }

    setDateFilterError("");
    if (boundary === "start") {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
    setDateFilterActive(true);
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-slate-500">{"Statistiques limit\u00e9es \u00e0 l'ann\u00e9e scolaire s\u00e9lectionn\u00e9e."}</p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[180px_150px_150px_auto_auto]">
          <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as typeof sectionFilter)} className="input">
            <option value="all">Toutes les sections</option>
            {dashboardSectionChoices.map((section) => (
              <option key={section} value={section}>{schoolSectionLabels[section]}</option>
            ))}
          </select>
          <input
            value={startDate}
            onChange={(event) => updateDashboardDateFilter("start", event.target.value)}
            type="date"
            max={today}
            className="input"
          />
          <input
            value={endDate}
            onChange={(event) => updateDashboardDateFilter("end", event.target.value)}
            type="date"
            max={today}
            className="input"
          />
          <button onClick={resetDashboardDateFilter} type="button" className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-mint hover:text-mint">
            Réinitialiser
          </button>
          <button onClick={exportDashboardPdf} type="button" className="primary-button w-full justify-center sm:w-auto">
            <Download className="h-4 w-4" /> Exporter PDF
          </button>
          {dateFilterError && <p className="text-xs font-semibold text-red-600 sm:col-span-2 lg:col-span-5">{dateFilterError}</p>}
        </div>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-sm text-slate-500">{card.label}</p>
              <p className="mt-1 break-words text-2xl font-bold text-ink">{card.value}</p>
            </article>
          );
        })}
      </div>

      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-ink">KPI financier</h2>
            <p className="text-sm text-slate-500">Recouvrement selon les filtres sélectionnés.</p>
          </div>
          <span className={"rounded px-3 py-2 text-sm font-bold " + recoveryTone}>{recoveryRate}{"% recouvr\u00e9"}</span>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
          <div className={`h-full rounded ${progressBarTone(recoveryRate)}`} style={{ width: Math.min(100, recoveryRate) + "%" }} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <Metric label="Attendu" value={"$" + dashboardFinancialStats.expected.toFixed(2)} />
          <Metric label={"Encaiss\u00e9"} value={"$" + totalPayments.toFixed(2)} />
          <Metric label={"D\u00e9penses"} value={"$" + totalExpenses.toFixed(2)} />
          <Metric label="Reste" value={"$" + remaining.toFixed(2)} />
        </div>
        <div className="mt-5 grid gap-3">
          {feeProgressRows.map((row) => (
            <div key={row.name} className="rounded border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-bold text-ink">{row.name}</p>
                  <p className="break-words text-xs text-slate-500">Toutes les classes confondues</p>
                </div>
                <span className="shrink-0 rounded bg-white px-2.5 py-1 text-xs font-bold text-mint">{row.rate}%</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded bg-white">
                <div className={`h-full rounded ${progressBarTone(row.rate)}`} style={{ width: Math.min(100, row.rate) + "%" }} />
              </div>
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <span className="rounded bg-white px-2 py-1 text-slate-600">Attendu : <strong className="text-ink">${row.expected.toFixed(2)}</strong></span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">Payé : <strong className="text-ink">${row.paid.toFixed(2)}</strong></span>
                <span className="rounded bg-white px-2 py-1 text-slate-600">Solde : <strong className="text-ink">${row.remaining.toFixed(2)}</strong></span>
              </div>
            </div>
          ))}
          {feeProgressRows.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun frais applicable pour les filtres sélectionnés.</p>}
        </div>
      </div>

      <FormPanel title="Transactions du jour">
        <div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
          {transactions.map((transaction) => (
            <div key={transaction.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-slate-50 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{transaction.type}</p>
                <p className="break-words text-xs text-slate-500">{transaction.label} | {transaction.date.slice(0, 10)}</p>
              </div>
              <span className={transaction.amount >= 0 ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>
                {(transaction.amount >= 0 ? "+" : "-") + "$" + Math.abs(transaction.amount).toFixed(2)}
              </span>
            </div>
          ))}
          {transactions.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{"Aucune transaction pour cette p\u00e9riode."}</p>}
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <TransactionComboChart rows={transactionChartRows} period={transactionPeriod} onPeriodChange={setTransactionPeriod} />
        </div>
      </FormPanel>

      <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="font-bold text-ink">{"\u00c9l\u00e8ves par classe"}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Classe</th>
                <th className="py-2">Filles</th>
                <th className="py-2">{"Gar\u00e7ons"}</th>
                <th className="py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {classDisplayRows.map((row) => (
                <tr key={row.className} className="border-t border-slate-100">
                  <td className="py-2 font-semibold text-ink">{row.className}</td>
                  <td className="py-2">{row.girls}</td>
                  <td className="py-2">{row.boys}</td>
                  <td className="py-2">{row.total}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 bg-slate-50 font-bold text-ink">
                <td className="py-2">Totaux</td>
                <td className="py-2">{totalGirls}</td>
                <td className="py-2">{totalBoys}</td>
                <td className="py-2">{totalStudents}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
