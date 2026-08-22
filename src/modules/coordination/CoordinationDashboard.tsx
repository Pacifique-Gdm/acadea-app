import { useEffect, useMemo, useState } from "react";
import { Banknote, BarChart3, BookOpen, Download, GraduationCap, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { FormPanel, Metric } from "../../components/ui";
import { loadCoordinationDashboardReadModel, type CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import type { AppUser, Coordination, School, SchoolSection } from "../../types";
import { buildDashboardTransactionDayRows } from "../../utils/dashboardStats";
import { formatChartDate, getTransactionPeriodDates } from "../../utils/dashboardDates";
import { buildCoordinationDashboardStats, type DashboardCurrency } from "../../utils/coordinationDashboardStats";
import { getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import {
  FinancialFeeShareChart,
  TransactionComboChart,
  type TransactionChartItem,
  type TransactionPeriod,
} from "../dashboard/Dashboard";
import { exportCoordinationDashboardPdf } from "./coordinationDashboardPdf";

const emptyModel: CoordinationDashboardReadModel = { students: [], feeTypes: [], payments: [], expenses: [], personnel: [], schoolYears: [] };

function dateKey(date: Date) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

function formatCurrency(value: number, currency: DashboardCurrency) {
  return `${value.toFixed(2)} ${currency}`;
}

function progressTone(rate: number) {
  if (rate >= 100) return "bg-emerald-700";
  if (rate >= 80) return "bg-emerald-400";
  if (rate >= 50) return "bg-orange-400";
  return "bg-red-500";
}

export function CoordinationDashboard({
  coordination,
  schools,
  selectedSchoolId,
  onSchoolChange,
  user,
}: {
  coordination: Coordination;
  schools: School[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
  user: AppUser;
}) {
  const today = dateKey(new Date());
  const [model, setModel] = useState<CoordinationDashboardReadModel>(emptyModel);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sectionFilter, setSectionFilter] = useState<"all" | SchoolSection>("all");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [dateFilterActive, setDateFilterActive] = useState(false);
  const [dateFilterError, setDateFilterError] = useState("");
  const [transactionPeriod, setTransactionPeriod] = useState<TransactionPeriod>("last5");
  const scopedSchools = useMemo(() => selectedSchoolId ? schools.filter((school) => school.id === selectedSchoolId) : schools, [schools, selectedSchoolId]);
  const schoolIds = useMemo(() => schools.map((school) => school.id), [schools]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    loadCoordinationDashboardReadModel(schoolIds)
      .then((result) => { if (!cancelled) setModel(result); })
      .catch(() => { if (!cancelled) setError("Impossible de charger le Dashboard de la Coordination."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolIds]);

  const sectionChoices = useMemo(() => [...new Set(scopedSchools.flatMap((school) => getSchoolSections(school)))], [scopedSchools]);
  useEffect(() => {
    if (sectionFilter !== "all" && !sectionChoices.includes(sectionFilter)) setSectionFilter("all");
  }, [sectionChoices, sectionFilter]);

  const stats = useMemo(() => buildCoordinationDashboardStats(scopedSchools, model, {
    referenceSchoolYear: coordination.referenceSchoolYear,
    section: sectionFilter,
    dateFilterActive,
    startDate,
    endDate,
  }), [coordination.referenceSchoolYear, dateFilterActive, endDate, model, scopedSchools, sectionFilter, startDate]);
  const transactionScope = useMemo(() => buildCoordinationDashboardStats(scopedSchools, model, {
    referenceSchoolYear: coordination.referenceSchoolYear,
    section: sectionFilter,
  }), [coordination.referenceSchoolYear, model, scopedSchools, sectionFilter]);
  const schoolById = useMemo(() => new Map(scopedSchools.map((school) => [school.id, school])), [scopedSchools]);
  const studentsByKey = useMemo(() => new Map(transactionScope.students.map((student) => [`${student.schoolId}:${student.id}`, student])), [transactionScope.students]);
  const feesByKey = useMemo(() => new Map(transactionScope.feeTypes.map((fee) => [`${fee.schoolId}:${fee.id}`, fee])), [transactionScope.feeTypes]);
  const chartDates = useMemo(() => getTransactionPeriodDates(transactionPeriod), [transactionPeriod]);
  const transactionStartDate = dateFilterActive ? startDate : today;
  const transactionEndDate = dateFilterActive ? endDate : today;
  const visiblePayments = stats.payments.filter((payment) => (!transactionStartDate || payment.paidAt.slice(0, 10) >= transactionStartDate) && (!transactionEndDate || payment.paidAt.slice(0, 10) <= transactionEndDate));
  const visibleExpenses = stats.expenses.filter((expense) => (!transactionStartDate || expense.spentAt.slice(0, 10) >= transactionStartDate) && (!transactionEndDate || expense.spentAt.slice(0, 10) <= transactionEndDate));
  const transactions = [
    ...visiblePayments.map((payment) => ({ id: `${payment.schoolId}:${payment.id}`, type: "Paiement", label: `${schoolById.get(payment.schoolId)?.name ?? payment.schoolId} · ${payment.cashierName}`, amount: payment.amount, currency: schoolById.get(payment.schoolId)?.currency ?? "USD", date: payment.paidAt, occurredAt: payment.createdAt ?? payment.paidAt })),
    ...visibleExpenses.map((expense) => ({ id: `${expense.schoolId}:${expense.id}`, type: "Dépense", label: `${schoolById.get(expense.schoolId)?.name ?? expense.schoolId} · ${expense.category}`, amount: -expense.amount, currency: schoolById.get(expense.schoolId)?.currency ?? "USD", date: expense.spentAt, occurredAt: expense.createdAt ?? expense.spentAt })),
  ].sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));

  const chartGroups = stats.financialGroups.map((financial) => {
    const currencySchoolIds = new Set(scopedSchools.filter((school) => (school.currency ?? "USD") === financial.currency).map((school) => school.id));
    const currencyStudents = transactionScope.students.filter((student) => currencySchoolIds.has(student.schoolId));
    const rows = buildDashboardTransactionDayRows({
      dates: chartDates,
      payments: transactionScope.payments.filter((payment) => currencySchoolIds.has(payment.schoolId)),
      expenses: transactionScope.expenses.filter((expense) => currencySchoolIds.has(expense.schoolId)),
      studentIds: new Set(currencyStudents.map((student) => student.id)),
      includeExpenses: sectionFilter === "all",
    }).map((row) => ({
      date: row.date,
      label: formatChartDate(row.date),
      payments: row.payments,
      expenses: row.expenses,
      transactions: [
        ...row.paymentsForDate.map((payment): TransactionChartItem => {
          const student = studentsByKey.get(`${payment.schoolId}:${payment.studentId}`);
          const fee = feesByKey.get(`${payment.schoolId}:${payment.feeTypeId}`);
          return { id: `${payment.schoolId}:${payment.id}`, kind: "payment", type: "Paiement", label: schoolById.get(payment.schoolId)?.name ?? payment.schoolId, amount: payment.amount, date: payment.paidAt, occurredAt: payment.createdAt ?? payment.paidAt, studentName: student ? `${student.nom} ${student.postnom} ${student.prenom}`.trim() : undefined, className: student?.className, feeName: fee?.name, agentName: payment.cashierName };
        }),
        ...row.expensesForDate.map((expense): TransactionChartItem => ({ id: `${expense.schoolId}:${expense.id}`, kind: "expense", type: "Dépense", label: `${schoolById.get(expense.schoolId)?.name ?? expense.schoolId} · ${expense.description || expense.category}`, amount: expense.amount, date: expense.spentAt, occurredAt: expense.createdAt ?? expense.spentAt, agentName: expense.cashierName })),
      ],
    }));
    return { currency: financial.currency, rows };
  });

  const financialValue = (field: "expected" | "paid" | "remaining") => stats.financialGroups.length
    ? stats.financialGroups.map((group) => formatCurrency(group[field], group.currency)).join(" · ")
    : "0.00 USD";
  const cards = [
    { label: "Nombre total d'élèves", value: stats.totalStudents, icon: GraduationCap, tone: "bg-mint/10 text-mint" },
    { label: "Nombre de classes", value: stats.totalClasses, icon: BookOpen, tone: "bg-indigo-100 text-indigo-700" },
    { label: "Nombre total de parents", value: stats.totalParents, icon: UsersRound, tone: "bg-coral/10 text-coral" },
    { label: "Administrateurs", value: stats.administrators, icon: ShieldCheck, tone: "bg-blue-100 text-blue-700" },
    { label: "Caissiers", value: stats.cashiers, icon: UserRound, tone: "bg-pink-100 text-pink-700" },
    { label: "Directeurs de Discipline", value: stats.disciplineDirectors, icon: ShieldCheck, tone: "bg-violet-100 text-violet-700" },
    { label: "Montant attendu", value: financialValue("expected"), icon: BarChart3, tone: "bg-sky-100 text-sky-700" },
    { label: "Montant total encaissé", value: financialValue("paid"), icon: Banknote, tone: "bg-emerald-100 text-emerald-700" },
    { label: "Montant restant à payer", value: financialValue("remaining"), icon: BarChart3, tone: "bg-amber-100 text-amber-700" },
  ];

  function resetFilters() {
    onSchoolChange("");
    setSectionFilter("all");
    setStartDate(today);
    setEndDate(today);
    setDateFilterActive(false);
    setDateFilterError("");
    setTransactionPeriod("last5");
  }

  function updateDate(boundary: "start" | "end", value: string) {
    if (value && value > today) { setDateFilterError("Une date future n'est pas autorisée."); return; }
    setDateFilterError("");
    if (boundary === "start") setStartDate(value); else setEndDate(value);
    setDateFilterActive(true);
  }

  async function exportPdf() {
    await exportCoordinationDashboardPdf({ coordination, schools: scopedSchools, selectedSchoolId, stats, sectionLabel: sectionFilter === "all" ? "Toutes les sections" : schoolSectionLabels[sectionFilter], dateLabel: dateFilterActive ? `${startDate || "Début"} au ${endDate || "Fin"}` : "Année scolaire active", transactions });
  }

  return <section className="grid min-w-0 gap-4">
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0"><h1 className="text-2xl font-bold text-ink">Dashboard</h1><p className="text-sm text-slate-500">Statistiques limitées aux années actives alignées de la Coordination.</p></div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[190px_180px_150px_150px_auto_auto]">
        <select className="input" aria-label="Filtrer par école" value={selectedSchoolId} onChange={(event) => onSchoolChange(event.target.value)}><option value="">{user.role === "sub_coordination_admin" ? "Toutes mes écoles" : "Toutes les écoles"} ({schools.length})</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select>
        <select value={sectionFilter} onChange={(event) => setSectionFilter(event.target.value as typeof sectionFilter)} className="input" aria-label="Filtrer par section"><option value="all">Toutes les sections</option>{sectionChoices.map((section) => <option key={section} value={section}>{schoolSectionLabels[section]}</option>)}</select>
        <input value={startDate} onChange={(event) => updateDate("start", event.target.value)} type="date" max={today} className="input" aria-label="Date de début" />
        <input value={endDate} onChange={(event) => updateDate("end", event.target.value)} type="date" max={today} className="input" aria-label="Date de fin" />
        <button onClick={resetFilters} type="button" className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-mint hover:text-mint">Réinitialiser</button>
        <button onClick={() => void exportPdf()} type="button" disabled={loading || !scopedSchools.length} className="pdf-export-button w-full sm:w-auto"><Download className="h-4 w-4" /> Exporter PDF</button>
        {dateFilterError && <p className="text-xs font-semibold text-red-600 sm:col-span-2 lg:col-span-6">{dateFilterError}</p>}
      </div>
    </div>
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading && <p className="rounded border bg-white p-4 text-sm text-slate-500">Chargement du Dashboard…</p>}
    {stats.excludedSchoolIds.length > 0 && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{stats.excludedSchoolIds.length} école(s) non alignée(s) sur l’année de référence sont exclues des statistiques.</p>}

    <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map((card) => { const Icon = card.icon; return <article key={card.label} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded ${card.tone}`}><Icon className="h-5 w-5" /></div><p className="text-sm text-slate-500">{card.label}</p><p className="mt-1 break-words text-2xl font-bold text-ink">{card.value}</p></article>; })}</div>

    {stats.financialGroups.map((financial) => {
      const recoveryTone = financial.recoveryRate >= 80 ? "text-mint bg-mint/10" : financial.recoveryRate >= 50 ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-50";
      const amount = (value: number) => formatCurrency(value, financial.currency);
      return <div key={financial.currency} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-ink">KPI financier{stats.financialGroups.length > 1 ? ` · ${financial.currency}` : ""}</h2><p className="text-sm text-slate-500">Recouvrement selon les filtres sélectionnés.</p></div><span className={`rounded px-3 py-2 text-sm font-bold ${recoveryTone}`}>{financial.recoveryRate}% recouvré</span></div>
        <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100"><div className={`h-full rounded ${progressTone(financial.recoveryRate)}`} style={{ width: `${Math.min(100, financial.recoveryRate)}%` }} /></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4"><Metric label="Attendu" value={amount(financial.expected)} /><Metric label="Encaissé" value={amount(financial.paid)} /><Metric label="Dépenses" value={amount(financial.expenses)} /><Metric label="Reste" value={amount(financial.remaining)} /></div>
        <div className="mt-5 grid gap-3">{financial.feeProgressRows.map((row) => <div key={row.name} className="rounded border border-slate-100 bg-slate-50 p-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="break-words text-sm font-bold text-ink">{row.name}</p><p className="break-words text-xs text-slate-500">Toutes les classes confondues</p></div><span className="shrink-0 rounded bg-white px-2.5 py-1 text-xs font-bold text-mint">{row.rate}%</span></div><div className="mt-3 h-2.5 overflow-hidden rounded bg-white"><div className={`h-full rounded ${progressTone(row.rate)}`} style={{ width: `${Math.min(100, row.rate)}%` }} /></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-3"><span className="rounded bg-white px-2 py-1 text-slate-600">Attendu : <strong className="text-ink">{amount(row.expected)}</strong></span><span className="rounded bg-white px-2 py-1 text-slate-600">Payé : <strong className="text-ink">{amount(row.paid)}</strong></span><span className="rounded bg-white px-2 py-1 text-slate-600">Solde : <strong className="text-ink">{amount(row.remaining)}</strong></span></div></div>)}{financial.feeProgressRows.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun frais applicable pour les filtres sélectionnés.</p>}</div>
        <FinancialFeeShareChart rows={financial.feeShares} formatAmount={amount} totalAriaLabel={`Répartition des montants attendus en ${financial.currency}`} />
      </div>;
    })}
    {!stats.financialGroups.length && <div className="rounded border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-bold text-ink">KPI financier</h2><p className="mt-3 text-sm text-slate-500">Aucune donnée financière pour le périmètre sélectionné.</p></div>}

    <FormPanel title="Transactions du jour"><div className="max-h-80 space-y-2 overflow-y-auto pr-1 scrollbar-thin">{transactions.map((transaction) => <div key={transaction.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-slate-50 p-3 text-sm"><div className="min-w-0"><p className="font-semibold text-ink">{transaction.type}</p><p className="break-words text-xs text-slate-500">{transaction.label} | {transaction.date.slice(0, 10)}</p></div><span className={transaction.amount >= 0 ? "shrink-0 font-bold text-mint" : "shrink-0 font-bold text-red-600"}>{transaction.amount >= 0 ? "+" : "-"}{formatCurrency(Math.abs(transaction.amount), transaction.currency)}</span></div>)}{transactions.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucune transaction pour cette période.</p>}</div><div className="mt-4 grid gap-4 border-t border-slate-100 pt-4">{chartGroups.map((group) => <div key={group.currency} className="grid gap-2">{chartGroups.length > 1 && <p className="text-sm font-bold text-slate-600">Devise : {group.currency}</p>}<TransactionComboChart rows={group.rows} period={transactionPeriod} onPeriodChange={setTransactionPeriod} formatAmount={(value) => formatCurrency(value, group.currency)} /></div>)}</div></FormPanel>

    <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm"><h2 className="font-bold text-ink">Élèves par classe</h2><div className="mt-3 overflow-x-auto"><table className={`w-full ${scopedSchools.length > 1 ? "min-w-[680px]" : "min-w-[520px]"} text-left text-sm`}><thead className="text-xs uppercase text-slate-500"><tr>{scopedSchools.length > 1 && <th className="py-2">École</th>}<th className="py-2">Classe</th><th className="py-2">Filles</th><th className="py-2">Garçons</th><th className="py-2">Total</th></tr></thead><tbody>{stats.classRows.map((row) => <tr key={`${row.schoolId}:${row.className}`} className="border-t border-slate-100">{scopedSchools.length > 1 && <td className="py-2 pr-3">{row.schoolName}</td>}<td className="py-2 font-semibold text-ink">{row.className}</td><td className="py-2">{row.girls}</td><td className="py-2">{row.boys}</td><td className="py-2">{row.total}</td></tr>)}<tr className="border-t border-slate-200 bg-slate-50 font-bold text-ink">{scopedSchools.length > 1 && <td className="py-2" />}<td className="py-2">Totaux</td><td className="py-2">{stats.totalGirls}</td><td className="py-2">{stats.totalBoys}</td><td className="py-2">{stats.totalStudents}</td></tr></tbody></table></div></div>
  </section>;
}
