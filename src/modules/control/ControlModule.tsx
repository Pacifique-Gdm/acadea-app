import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, Download, Edit3, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { AdminDrawer, Field, FormPanel, Metric, MoneyInput, SectionTitle } from "../../components/ui";
import { PersonnelPaymentForm } from "../../components/personnel/PersonnelPaymentForm";
import { OtherCashInflowForm } from "../../components/finance/OtherCashInflowForm";
import { loadExpenseCashBalance, type PayrollCashBalance } from "../../services/personnelPayroll";
import { PersonnelPayrollHistory } from "../../components/personnel/PersonnelPayrollHistory";
import { printPersonnelPaymentPdf } from "../../utils/personnelPayrollPdf";
import { usePaginatedControlHistory } from "../../hooks/usePaginatedControlHistory";
import { createExpenseTransaction, createPaymentTransaction, deleteFinancialTransaction, loadStudentArrears, updateExpenseTransaction, updatePaymentTransaction } from "../../services/financialTransactions";
import type { HistoricalDebt } from "../../services/financialTransactions";
import { loadStudentArrearsBatch, loadStudentArrearsDetailsBatch } from "../../services/financialTransactions";
import { PaidAmountDropdown } from "../../components/PaidAmountDropdown";
import { arrearsFilterActive, arrearsFilterForCriterion, matchesArrearsFilter, type ArrearsTotals } from "../../utils/arrearsFilter";
import { createAuditLog } from "../../utils/audit";
import { expenseCategoryLabel } from "../../utils/expenseCategory";
import { buildSchoolYearDataIndexes, sumPaymentsForStudentFee } from "../../utils/dataIndexes";
import { resolveExpenseCashierName, resolvePaymentCashierName } from "../../utils/finance";
import { escapePdfHtml, generateExpensePdf, generateReceiptPdf, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { PdfTableColumn } from "../../utils/pdf";
import { getStudentBalance } from "../../utils/stats";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { feeAppliesToStudent } from "../../utils/feeTargets";
import { buildControlClassChoices, buildControlFeeGroups, feeNamesForWarningClass, getControlClassKey, selectPaymentWarningRecipients } from "../../utils/controlFilters";
import { formatStudentClassName } from "../../utils/studentClasses";
import { formatCurrencyMoney, formatSchoolMoney, resolveSchoolYearCurrency } from "../../utils/currency";
import { resolveSchoolCurrency } from "../../utils/currency";
import { remainingMoney, sumMoney, toMoneyMinor } from "../../utils/money";
import { formatCount } from "../../utils/numberFormat";
import { controlArrearsPdfSections } from "../../utils/controlArrearsPdf";
import { compareStudentsForPdfByClass, formatStudentPdfClassName } from "../../utils/studentPdf";
import { filterControlStudentRows } from "../../utils/controlStudentSearch";
import { historicalArrearsPdfSection } from "./historicalArrearsPdf";
import type { AppData, AppUser, AuditLog, CashInflow, Expense, FeeType, ParentProfile, Payment, PersonnelPayment, School, SchoolYear, Student } from "../../types";

type ControlYearData = {
  students: Student[];
  parents: ParentProfile[];
  feeTypes: FeeType[];
  payments: Payment[];
  expenses: Expense[];
  auditLogs: AuditLog[];
};

type ControlModuleProps = {
  user: AppUser;
  data: AppData;
  yearData: ControlYearData;
  school: School;
  year: SchoolYear;
  updateData: (next: Partial<AppData>, options?: { persist?: boolean }) => void;
  createId: (prefix: string) => string;
};

const CONTROL_PAGE_SIZE = 50;

export function ControlModule({
  user,
  data,
  yearData,
  school,
  year,
  updateData,
  createId,
}: ControlModuleProps) {
  const [studentId, setStudentId] = useState("");
  const [paymentStudentQuery, setPaymentStudentQuery] = useState("");
  const [feeTypeId, setFeeTypeId] = useState(yearData.feeTypes[0]?.id ?? "");
  const [amount, setAmount] = useState("100");
  const [paymentNote, setPaymentNote] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Fournitures");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseBeneficiary, setExpenseBeneficiary] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [expenseCashBalance, setExpenseCashBalance] = useState<PayrollCashBalance>();
  const [expenseCashLoading, setExpenseCashLoading] = useState(true);
  const [expenseCashError, setExpenseCashError] = useState("");
  const [amountComparator, setAmountComparator] = useState("");
  const [amountThreshold, setAmountThreshold] = useState("");
  const deferredAmountComparator = useDeferredValue(amountComparator);
  const deferredAmountThreshold = useDeferredValue(amountThreshold);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfExportError, setPdfExportError] = useState("");
  const pdfExportingRef = useRef(false);
  const [controlClassKey, setControlClassKey] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyKind, setHistoryKind] = useState<"expenses" | "payments" | "cashInflows" | "payroll">("payments");
  const [expenseEditTarget, setExpenseEditTarget] = useState<Expense | null>(null);
  const [expenseEditAmount, setExpenseEditAmount] = useState("");
  const [expenseEditCategory, setExpenseEditCategory] = useState("Fournitures");
  const [expenseEditDescription, setExpenseEditDescription] = useState("");
  const [expenseEditError, setExpenseEditError] = useState("");
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState<Expense | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [cashierControlDrawer, setCashierControlDrawer] = useState<"payment" | "expense" | "personnel" | "inflow" | null>(null);
  const [recordedPersonnelPayment, setRecordedPersonnelPayment] = useState<PersonnelPayment>();
  const [cashierControlFeedback, setCashierControlFeedback] = useState("");
  const [cashierControlFeedbackDrawer, setCashierControlFeedbackDrawer] = useState<"payment" | "expense" | "inflow" | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [financialMutationId, setFinancialMutationId] = useState("");
  const [paymentEditTarget, setPaymentEditTarget] = useState<Payment | null>(null);
  const [paymentEditAmount, setPaymentEditAmount] = useState("");
  const [paymentEditReason, setPaymentEditReason] = useState("");
  const [paymentEditConfirmation, setPaymentEditConfirmation] = useState("");
  const [paymentEditError, setPaymentEditError] = useState("");
  const [paymentEditFeedback, setPaymentEditFeedback] = useState("");
  const paymentAttemptRef = useRef<{ signature: string; requestId: string } | null>(null);
  const paymentCorrectionAttemptRef = useRef<{ signature: string; requestId: string } | null>(null);
  const paymentStudentRequestRef = useRef(0);
  const paymentStudentSearchRef = useRef<HTMLInputElement>(null);
  const expenseAttemptRef = useRef<{ signature: string; requestId: string } | null>(null);
  const paymentSubmittingRef = useRef(false);
  const expenseSubmittingRef = useRef(false);
  const financialMutationRef = useRef("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [expenseHistoryQuery, setExpenseHistoryQuery] = useState("");
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState("");
  const [paymentArrears, setPaymentArrears] = useState<HistoricalDebt[]>([]);
  const [historyArrears, setHistoryArrears] = useState<HistoricalDebt[]>([]);
  const [historyPdfLoading, setHistoryPdfLoading] = useState(false);
  const [historyPdfError, setHistoryPdfError] = useState("");
  const [arrearsError, setArrearsError] = useState("");
  const [arrearsLoading, setArrearsLoading] = useState(false);
  const [controlStudentSearch, setControlStudentSearch] = useState("");
  const [controlPage, setControlPage] = useState(1);
  const arrearsFilter = useMemo(() => arrearsFilterForCriterion(deferredAmountComparator, deferredAmountThreshold), [deferredAmountComparator, deferredAmountThreshold]);
  const [filterArrears, setFilterArrears] = useState<ArrearsTotals>({});
  const [filterArrearsLoading, setFilterArrearsLoading] = useState(false);
  const [filterArrearsError, setFilterArrearsError] = useState("");
  const amountSearching = deferredAmountComparator !== amountComparator || deferredAmountThreshold !== amountThreshold || filterArrearsLoading;
  const needsArrears = arrearsFilterActive(arrearsFilter);
  useEffect(() => {
    let cancelled = false;
    setFilterArrears({}); setFilterArrearsError(""); setFilterArrearsLoading(needsArrears);
    if (!needsArrears) return;
    // Process every source batch before display pagination. Never a per-student API.
    void (async () => {
      const totals: ArrearsTotals = {};
      for (let offset = 0; offset < yearData.students.length && !cancelled; offset += 50) {
        Object.assign(totals, await loadStudentArrearsBatch(year.id, yearData.students.slice(offset, offset + 50).map((student) => student.id)));
      }
      if (!cancelled) setFilterArrears(totals);
    })().catch(() => { if (!cancelled) setFilterArrearsError("Impossible de calculer les arriérés du contrôle."); })
      .finally(() => { if (!cancelled) setFilterArrearsLoading(false); });
    return () => { cancelled = true; };
  }, [needsArrears, school.id, year.id, yearData.students, data.payments, data.feeTypes]);
  const controlIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const paymentHistory = usePaginatedControlHistory<Payment>({
    kind: "payments",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: historyOpen && historyKind === "payments",
  });
  const expenseHistory = usePaginatedControlHistory<Expense>({
    kind: "expenses",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: historyOpen && historyKind === "expenses",
  });
  const cashInflowHistory = usePaginatedControlHistory<CashInflow>({
    kind: "cashInflows", schoolId: school.id, schoolYearId: year.id,
    enabled: historyOpen && historyKind === "cashInflows",
  });
  const classChoices = useMemo(() => buildControlClassChoices(yearData.students), [yearData.students]);
  const selectedControlClassStudent = classChoices.find((choice) => choice.key === controlClassKey)?.student;
  const amountFeeGroups = useMemo(
    () => buildControlFeeGroups(yearData.feeTypes, controlClassKey, selectedControlClassStudent),
    [controlClassKey, selectedControlClassStudent, yearData.feeTypes],
  );
  const amountFeeOptions = amountFeeGroups.flatMap((fee) => [
    { value: `fee:${fee.key}:gte`, label: `${fee.name} ≥` },
    { value: `fee:${fee.key}:lt`, label: `${fee.name} <` },
  ]);
  const amountOptions = [
    { value: "all-fees-gte", label: "Tous les frais ≥" },
    { value: "all-fees-lt", label: "Tous les frais <" },
    ...amountFeeOptions,
    { value: "arrears-gte", label: "Arriérés ≥" },
    { value: "arrears-lt", label: "Arriérés <" },
  ];
  const [warningClassKey, setWarningClassKey] = useState("");
  const [warningFeeName, setWarningFeeName] = useState("");
  const [warningRequiredAmount, setWarningRequiredAmount] = useState("");
  const [warningDeadline, setWarningDeadline] = useState("");
  const [warningFeedback, setWarningFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const warningClassStudent = classChoices.find((choice) => choice.key === warningClassKey)?.student;
  const warningFeeNameChoices = useMemo(
    () => feeNamesForWarningClass(yearData.feeTypes, warningClassKey, warningClassStudent),
    [warningClassKey, warningClassStudent, yearData.feeTypes],
  );
  useEffect(() => {
    if (warningFeeName && !warningFeeNameChoices.includes(warningFeeName)) setWarningFeeName("");
  }, [warningFeeName, warningFeeNameChoices]);
  useEffect(() => {
    if (warningFeedback?.type !== "success") return undefined;
    const timer = window.setTimeout(() => setWarningFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [warningFeedback]);
  useEffect(() => {
    const match = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    if (match && !amountFeeGroups.some((fee) => fee.key === match[1])) {
      setAmountComparator("");
    }
  }, [amountComparator, amountFeeGroups]);
  useEffect(() => {
    if (!cashierControlFeedback || !cashierControlFeedbackDrawer) return;
    const feedbackDrawer = cashierControlFeedbackDrawer;
    const timer = window.setTimeout(() => {
      setCashierControlFeedback("");
      setCashierControlFeedbackDrawer(null);
      setCashierControlDrawer((current) => (current === feedbackDrawer ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [cashierControlFeedback, cashierControlFeedbackDrawer]);
  const isArchivedContext = year.status === "archived";
  const canPay = user.role === "cashier" && !isArchivedContext;
  const canCorrectPayments = user.role === "school_admin" && !isArchivedContext;
  const canManageExpenses = user.role === "school_admin" && !isArchivedContext;
  const expenseCurrency = resolveSchoolYearCurrency(year, school);
  useEffect(() => {
    if (isArchivedContext || user.role === "cashier" && cashierControlDrawer !== "expense"
      || user.role === "school_admin" && !expenseEditTarget || !["school_admin", "cashier"].includes(user.role)) return;
    let active = true;
    setExpenseCashBalance(undefined); setExpenseCashLoading(true); setExpenseCashError("");
    void loadExpenseCashBalance(year.id).then((balance) => {
      if (!active) return;
      if (balance.schoolId !== school.id || balance.schoolYearId !== year.id || balance.currency !== expenseCurrency) throw new Error("La caisse ne correspond pas à cet établissement ou à cette devise.");
      setExpenseCashBalance(balance);
    }).catch((cause) => { if (active) setExpenseCashError(cause instanceof Error ? cause.message : "Solde de caisse indisponible."); })
      .finally(() => { if (active) setExpenseCashLoading(false); });
    return () => { active = false; };
  }, [cashierControlDrawer, expenseCurrency, expenseEditTarget, isArchivedContext, school.id, user.role, year.id]);
  const selectedPaymentStudent = controlIndexes.studentsById.get(studentId);
  const payableFeeTypes = selectedPaymentStudent ? controlIndexes.applicableFeeTypesByStudentId.get(selectedPaymentStudent.id) ?? [] : [];
  const selectedFeeTypeValue = payableFeeTypes.some((fee) => fee.id === feeTypeId) || paymentArrears.some((debt) => debt.feeTypeId === feeTypeId)
    ? feeTypeId : payableFeeTypes[0]?.id ?? paymentArrears[0]?.feeTypeId ?? "";
  const selectedPaymentFee = payableFeeTypes.find((fee) => fee.id === selectedFeeTypeValue);
  const selectedPaymentDebt = paymentArrears.find((debt) => debt.feeTypeId === selectedFeeTypeValue);
  const selectedPaymentFeePaid = selectedPaymentStudent && selectedPaymentFee
    ? sumPaymentsForStudentFee(controlIndexes, selectedPaymentStudent.id, selectedPaymentFee.id)
    : selectedPaymentDebt?.paid ?? 0;
  const selectedPaymentFeeRemaining = selectedPaymentFee ? remainingMoney(selectedPaymentFee.amount, selectedPaymentFeePaid) : selectedPaymentDebt?.remaining ?? 0;
  const selectedPaymentFeeBalance = {
    expected: selectedPaymentFee?.amount ?? selectedPaymentDebt?.expected ?? 0,
    paid: selectedPaymentFeePaid,
    remaining: selectedPaymentFeeRemaining,
  };
  const isPaymentEntryDisabled = (!selectedPaymentFee && !selectedPaymentDebt) || selectedPaymentFeeRemaining <= 0;
  useEffect(() => {
    const requestId = ++paymentStudentRequestRef.current;
    if (!studentId || year.status !== "active") { setPaymentArrears([]); setArrearsError(""); return; }
    let cancelled = false;
    setPaymentArrears([]);
    setArrearsLoading(true);
    setArrearsError("");
    void loadStudentArrears({ schoolYearId: year.id, studentId }).then((result) => {
      if (!cancelled && requestId === paymentStudentRequestRef.current) setPaymentArrears(result.debts);
    }).catch((error) => {
      if (!cancelled && requestId === paymentStudentRequestRef.current) setArrearsError(error instanceof Error ? error.message : "Chargement des arriérés impossible.");
    }).finally(() => { if (!cancelled && requestId === paymentStudentRequestRef.current) setArrearsLoading(false); });
    return () => { cancelled = true; };
  }, [studentId, year.id, year.status]);
  useEffect(() => {
    if (!selectedHistoryStudentId || year.status !== "active") { setHistoryArrears([]); return; }
    let cancelled = false;
    setHistoryArrears([]);
    void loadStudentArrears({ schoolYearId: year.id, studentId: selectedHistoryStudentId }).then((result) => {
      if (!cancelled) setHistoryArrears([...result.debts, ...result.settled]);
    }).catch(() => { if (!cancelled) setHistoryArrears([]); });
    return () => { cancelled = true; };
  }, [selectedHistoryStudentId, year.id, year.status]);
  const expenseAmountValue = Number(expenseAmount);
  const expenseDebitCents = (() => { try { return toMoneyMinor(expenseAmountValue); } catch { return 0; } })();
  const expenseCashInsufficient = expenseCashBalance !== undefined && Number.isFinite(expenseDebitCents)
    && expenseDebitCents > 0 && (expenseCashBalance.availableCents < 0 || expenseDebitCents > expenseCashBalance.availableCents);
  const expenseEditDeltaCents = (() => { try { return expenseEditTarget ? toMoneyMinor(Number(expenseEditAmount)) - toMoneyMinor(expenseEditTarget.amount) : 0; } catch { return 0; } })();
  const expenseEditCashInsufficient = expenseCashBalance !== undefined && expenseEditDeltaCents > 0
    && (expenseCashBalance.availableCents < 0 || expenseEditDeltaCents > expenseCashBalance.availableCents);
  const isExpenseEntryIncomplete = !expenseCategory.trim()
    || !expenseAmount.trim()
    || !Number.isFinite(expenseAmountValue)
    || expenseDebitCents <= 0
    || !expenseDescription.trim()
    || !expenseBeneficiary.trim()
    || !expensePaymentMethod.trim();
  const selectedHistoryStudent = controlIndexes.studentsById.get(selectedHistoryStudentId);
  const paymentStudentSearch = paymentStudentQuery.trim().toLowerCase();
  const paymentStudentResults = paymentStudentSearch
    ? yearData.students.filter((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`.toLowerCase().includes(paymentStudentSearch)).slice(0, 8)
    : [];

  const rows = useMemo(() => yearData.students
    .map((student) => {
      const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, controlIndexes);
      const balance = feeSummaries.reduce(
        (totals, summary) => ({
          expected: sumMoney([totals.expected, summary.expected]),
          paid: sumMoney([totals.paid, summary.paid]),
          remaining: sumMoney([totals.remaining, summary.remaining]),
        }),
        { expected: 0, paid: 0, remaining: 0 },
      );
      const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
      return { student, balance, progress, feeSummaries, hasApplicableFees: feeSummaries.length > 0 };
    })
    .filter((row) => {
      if (!matchesArrearsFilter(filterArrears[row.student.id], arrearsFilter, school)) return false;
      if (controlClassKey && controlClassKey !== "all" && getControlClassKey(row.student) !== controlClassKey) return false;
      if (!deferredAmountComparator || deferredAmountComparator === "all" || !deferredAmountThreshold || deferredAmountComparator.startsWith("arrears-")) return true;
      const threshold = Number(deferredAmountThreshold);
      let thresholdMinor: number;
      try { thresholdMinor = toMoneyMinor(threshold); } catch { return false; }
      if (thresholdMinor < 0) return false;
      if (deferredAmountComparator === "all-fees-gte") {
        return row.feeSummaries.length > 0 && row.feeSummaries.every((summary) => toMoneyMinor(summary.paid) >= thresholdMinor);
      }
      if (deferredAmountComparator === "all-fees-lt") {
        return row.feeSummaries.some((summary) => toMoneyMinor(summary.paid) < thresholdMinor);
      }
      const feeFilter = deferredAmountComparator.match(/^fee:(.+):(gte|lt)$/);
      const feeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
      const applicableFeeIds = feeFilter
        ? (feeGroup?.ids ?? []).filter((feeId) => {
          const fee = controlIndexes.feeTypesById.get(feeId);
          return fee ? feeAppliesToStudent(fee, row.student) : false;
        })
        : [];
      if (feeFilter && applicableFeeIds.length === 0) return false;
      const paidAmount = feeFilter
        ? sumMoney(applicableFeeIds.map((feeId) => sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId)))
        : row.balance.paid;
      const isGreaterOrEqual = feeFilter ? feeFilter[2] === "gte" : deferredAmountComparator === ">=";
      return isGreaterOrEqual ? toMoneyMinor(paidAmount) >= thresholdMinor : toMoneyMinor(paidAmount) < thresholdMinor;
    }), [deferredAmountComparator, amountFeeGroups, deferredAmountThreshold, controlClassKey, controlIndexes, yearData.feeTypes, yearData.payments, yearData.students, filterArrears, arrearsFilter, school]);
  const visibleRows = useMemo(() => filterControlStudentRows(rows, controlStudentSearch), [controlStudentSearch, rows]);
  const controlPageCount = Math.max(1, Math.ceil(visibleRows.length / CONTROL_PAGE_SIZE));
  const paginatedControlRows = visibleRows.slice((controlPage - 1) * CONTROL_PAGE_SIZE, controlPage * CONTROL_PAGE_SIZE);
  useEffect(() => { setControlPage(1); }, [amountComparator, amountThreshold, controlClassKey, controlStudentSearch, year.id]);
  useEffect(() => { if (controlPage > controlPageCount) setControlPage(controlPageCount); }, [controlPage, controlPageCount]);
  const historyPayments = [...new Map([...paymentHistory.items, ...yearData.payments.filter((payment) => payment.collectionSchoolYearId === year.id)].map((payment) => [payment.id, payment])).values()]
    .map((payment) => {
      const student = controlIndexes.studentsById.get(payment.currentStudentId ?? payment.studentId);
      const fee = controlIndexes.feeTypesById.get(payment.feeTypeId) ?? (payment.feeName ? { name: payment.feeName } : undefined);
      return student && fee ? { payment, student, fee } : null;
    })
    .filter((item): item is { payment: Payment; student: Student; fee: { name: string } } => Boolean(item));
  function historyTimestamp(dateValue?: string, fallbackDateValue?: string) {
    const primaryDate = dateValue ? new Date(dateValue) : null;
    if (primaryDate && !Number.isNaN(primaryDate.getTime())) return primaryDate.getTime();
    const fallbackDate = fallbackDateValue ? new Date(fallbackDateValue) : null;
    if (fallbackDate && !Number.isNaN(fallbackDate.getTime())) return fallbackDate.getTime();
    return 0;
  }

  const filteredHistoryPayments = historyPayments
    .filter(({ payment, student, fee }) => {
      const query = historyQuery.trim().toLowerCase();
      if (!query) return true;
      const searchableText = [
        student.nom,
        student.postnom,
        student.prenom,
        student.matricule,
        formatStudentClassName(student),
        fee.name,
        String(payment.amount),
        payment.paidAt,
        payment.createdAt ?? "",
        payment.receiptNumber ?? "",
        payment.note ?? "",
      ].join(" ");
      return searchableText.toLowerCase().includes(query);
    })
    .sort((first, second) => historyTimestamp(second.payment.createdAt, second.payment.paidAt) - historyTimestamp(first.payment.createdAt, first.payment.paidAt));
  const selectedHistoryBalance = selectedHistoryStudent
    ? getStudentBalance(selectedHistoryStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const selectedHistoryFeeSummaries = selectedHistoryStudent
    ? getStudentFeeSummaries(selectedHistoryStudent, yearData.feeTypes, yearData.payments, controlIndexes)
    : [];
  const selectedHistoryFeeTotals = selectedHistoryFeeSummaries.reduce(
    (totals, summary) => ({
      expected: sumMoney([totals.expected, summary.expected]),
      paid: sumMoney([totals.paid, summary.paid]),
      remaining: sumMoney([totals.remaining, summary.remaining]),
    }),
    { expected: 0, paid: 0, remaining: 0 },
  );
  const selectedHistoryPayments = selectedHistoryStudent
    ? (controlIndexes.paymentsByStudentId.get(selectedHistoryStudent.id) ?? [])
        .map((payment) => ({
          payment,
          fee: controlIndexes.feeTypesById.get(payment.feeTypeId),
        }))
        .sort((a, b) => `${a.payment.paidAt}${a.payment.createdAt ?? ""}`.localeCompare(`${b.payment.paidAt}${b.payment.createdAt ?? ""}`))
    : [];
  let selectedHistoryRunningPaid = 0;
  const selectedHistoryRows = selectedHistoryPayments.map(({ payment, fee }) => {
    selectedHistoryRunningPaid = sumMoney([selectedHistoryRunningPaid, payment.amount]);
    return {
      payment,
      feeName: fee?.name ?? "Frais",
      remaining: remainingMoney(selectedHistoryBalance.expected, selectedHistoryRunningPaid),
    };
  });
  const selectedHistoryArrearPayments = selectedHistoryStudent
    ? yearData.payments.filter((payment) => payment.collectionSchoolYearId === year.id && payment.currentStudentId === selectedHistoryStudent.id)
    : [];
  const normalizedExpenseQuery = expenseHistoryQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");
  const sortedExpenses = expenseHistory.items.filter((expense) => {
    if (!normalizedExpenseQuery) return true;
    const searchable = [expense.description, expense.category, expense.cashierName, getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]), getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"])].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
    return searchable.includes(normalizedExpenseQuery);
  }).sort((first, second) => historyTimestamp(second.createdAt, second.spentAt) - historyTimestamp(first.createdAt, first.spentAt));
  const isOtherExpenseEditCategory = expenseEditCategory === "Autre" || expenseEditCategory === "Autres";
  const cashierDrawerTitle = "Enregistrer";

  function studentFullName(student: Student) {
    return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
  }

  function formatMoney(value: number) {
    return formatSchoolMoney(value, school);
  }

  function renderExpenseCashBalance(debitCents: number, label = "Montant à décaisser") {
    const balance = expenseCashBalance;
    const format = (cents: number) => formatCurrencyMoney(cents / 100, balance?.currency ?? "CDF");
    return <section aria-label="Solde de caisse" className="grid min-w-0 gap-1 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      {expenseCashLoading ? <p role="status">Chargement du solde disponible…</p> : expenseCashError ? <p role="alert" className="text-red-700">{expenseCashError}</p> : balance ? <>
        <p>Solde disponible : <strong>{format(balance.availableCents)}</strong></p>
        <p>{label} : <strong>{format(Math.max(0, debitCents))}</strong></p>
        <p>Solde après opération : <strong>{format(balance.availableCents - Math.max(0, debitCents))}</strong></p>
        {debitCents > 0 && (balance.availableCents < 0 || debitCents > balance.availableCents) && <p role="alert" className="rounded bg-red-50 p-2 text-red-700">Opération impossible : solde de caisse insuffisant. Solde disponible : {format(balance.availableCents)}. Montant demandé : {format(debitCents)}. Montant manquant : {format(Math.max(0, debitCents - balance.availableCents))}.</p>}
      </> : <p role="alert" className="text-red-700">Solde de caisse indisponible : dépense bloquée.</p>}
      <button type="button" className="secondary-button justify-center" disabled={expenseCashLoading} onClick={() => void refreshExpenseCashBalance().catch(() => {})}>Actualiser le solde</button>
    </section>;
  }

  async function refreshExpenseCashBalance() {
    setExpenseCashLoading(true);
    try {
      const balance = await loadExpenseCashBalance(year.id);
      if (balance.schoolId !== school.id || balance.schoolYearId !== year.id || balance.currency !== expenseCurrency) throw new Error("La caisse ne correspond pas à cet établissement ou à cette devise.");
      setExpenseCashBalance(balance); setExpenseCashError("");
      return balance;
    } catch (cause) {
      setExpenseCashBalance(undefined);
      setExpenseCashError(cause instanceof Error ? cause.message : "Solde de caisse indisponible.");
      throw cause;
    } finally { setExpenseCashLoading(false); }
  }

  function formatPaymentDate(value: string) {
    return new Date(value).toLocaleDateString("fr-FR");
  }

  function formatExpenseDateTime(expense: Expense) {
    const value = expense.createdAt || expense.spentAt;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return expense.spentAt;
    return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  }

  function getExpenseField(expense: Expense, keys: string[]) {
    const record = expense as Expense & Record<string, unknown>;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function progressBarTone(percent: number) {
    if (percent >= 100) return "bg-mint";
    if (percent >= 75) return "bg-lime-400";
    if (percent >= 50) return "bg-amber-400";
    return "bg-red-500";
  }

  function isStudentPaymentComplete(balance: { expected: number; paid: number }) {
    return balance.expected > 0 && balance.paid >= balance.expected;
  }

  function resetStudentDependentPaymentState() {
    paymentStudentRequestRef.current += 1;
    setFeeTypeId("");
    setPaymentArrears([]);
    setArrearsError("");
    setArrearsLoading(false);
    setAmount("");
    setPaymentNote("");
    setPaymentError("");
    paymentAttemptRef.current = null;
  }

  function selectPaymentStudent(student: Student) {
    resetStudentDependentPaymentState();
    setStudentId(student.id);
    setPaymentStudentQuery(`${student.nom} ${student.postnom} ${student.prenom} | ${student.matricule}`.replace(/\s+/g, " ").trim());
  }

  function updatePaymentStudentQuery(value: string) {
    if (studentId) resetStudentDependentPaymentState();
    setPaymentStudentQuery(value);
    setStudentId("");
  }

  function clearPaymentStudent() {
    if (paymentSubmittingRef.current) return;
    resetStudentDependentPaymentState();
    setStudentId("");
    setPaymentStudentQuery("");
    paymentStudentSearchRef.current?.focus();
  }

  async function savePayment() {
    if (paymentSubmittingRef.current) return;
    setCashierControlFeedback("");
    setCashierControlFeedbackDrawer(null);
    if (isArchivedContext) {
      setPaymentError("Cette année scolaire est archivée en lecture seule.");
      return;
    }
    if (!studentId || !selectedFeeTypeValue) return;
    setPaymentError("");
    const paymentAmount = Number(amount);
    let paymentMinor: number;
    try { paymentMinor = toMoneyMinor(paymentAmount); } catch { paymentMinor = 0; }
    if (paymentMinor <= 0) {
      setPaymentError("Montant de paiement invalide.");
      return;
    }
    if (!selectedPaymentStudent || (!selectedPaymentFee && !selectedPaymentDebt)) {
      setPaymentError("Type de frais indisponible pour cet élève.");
      return;
    }
    const alreadyPaidForFee = selectedPaymentDebt?.paid ?? sumMoney(yearData.payments
      .filter(
        (payment) =>
          payment.schoolId === school.id &&
          payment.schoolYearId === year.id &&
          payment.studentId === selectedPaymentStudent.id &&
          payment.feeTypeId === selectedPaymentFee?.id,
      )
      .map((payment) => payment.amount));
    const remaining = remainingMoney(selectedPaymentFee?.amount ?? selectedPaymentDebt?.expected ?? 0, alreadyPaidForFee);
    if (remaining === 0) {
      setPaymentError("Ce type de frais est déjà soldé.");
      return;
    }
    if (paymentMinor > toMoneyMinor(remaining)) {
      setPaymentError("Le montant saisi dépasse le solde restant pour ce type de frais.");
      return;
    }
    const trimmedNote = paymentNote.trim();
    const signature = JSON.stringify([year.id, studentId, selectedFeeTypeValue, selectedPaymentDebt?.schoolYearId, paymentAmount, trimmedNote]);
    const requestId = paymentAttemptRef.current?.signature === signature ? paymentAttemptRef.current.requestId : crypto.randomUUID();
    paymentAttemptRef.current = { signature, requestId };
    paymentSubmittingRef.current = true;
    setPaymentSubmitting(true);
    try {
      const payment = await createPaymentTransaction({ schoolYearId: year.id, studentId, feeTypeId: selectedFeeTypeValue, ...(selectedPaymentDebt ? { debtSchoolYearId: selectedPaymentDebt.schoolYearId } : {}), amount: paymentAmount, note: trimmedNote || undefined, clientRequestId: requestId });
      paymentHistory.prependItem(payment);
      void refreshExpenseCashBalance().catch(() => {});
      if (selectedPaymentDebt) {
        try {
          const refreshed = await loadStudentArrears({ schoolYearId: year.id, studentId });
          setPaymentArrears(refreshed.debts);
          if (selectedHistoryStudentId === studentId) setHistoryArrears(refreshed.debts);
        } catch {
          setPaymentArrears([]);
          setArrearsError("Paiement enregistré. Actualisez les arriérés avant un autre règlement.");
        }
      }
      paymentAttemptRef.current = null;
      setAmount("");
      setPaymentNote("");
      if (user.role === "cashier") {
        setCashierControlFeedback("Paiement enregistré avec succès.");
        setCashierControlFeedbackDrawer("payment");
      }
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Enregistrement du paiement impossible.");
    } finally {
      paymentSubmittingRef.current = false;
      setPaymentSubmitting(false);
    }
  }

  async function saveExpense() {
    if (expenseSubmittingRef.current) return;
    setCashierControlFeedback("");
    setCashierControlFeedbackDrawer(null);
    setExpenseError("");
    if (isArchivedContext) return;
    const trimmedCategory = expenseCategory.trim();
    const trimmedDescription = expenseDescription.trim();
    const trimmedBeneficiary = expenseBeneficiary.trim();
    const trimmedPaymentMethod = expensePaymentMethod.trim();
    const trimmedReference = expenseReference.trim();
    const nextAmount = Number(expenseAmount);
    if (!trimmedCategory) {
      setExpenseError("Le type de dépense est obligatoire.");
      return;
    }
    if (!expenseAmount.trim() || expenseDebitCents <= 0) {
      setExpenseError("Le montant de la dépense est obligatoire.");
      return;
    }
    if (!trimmedDescription) {
      setExpenseError("La description de la dépense est obligatoire.");
      return;
    }
    if (!trimmedBeneficiary) {
      setExpenseError("Le bénéficiaire ou fournisseur est obligatoire.");
      return;
    }
    if (!trimmedPaymentMethod) {
      setExpenseError("Le mode de paiement est obligatoire.");
      return;
    }
    if (!expenseCashBalance || expenseCashLoading || expenseCashInsufficient) {
      setExpenseError("Opération impossible : solde de caisse insuffisant ou indisponible.");
      return;
    }
    const signature = JSON.stringify([year.id, nextAmount, trimmedCategory, trimmedDescription, trimmedBeneficiary, trimmedPaymentMethod, trimmedReference]);
    const requestId = expenseAttemptRef.current?.signature === signature ? expenseAttemptRef.current.requestId : crypto.randomUUID();
    expenseAttemptRef.current = { signature, requestId };
    expenseSubmittingRef.current = true;
    setExpenseSubmitting(true);
    try {
      const latest = await refreshExpenseCashBalance();
      if (latest.availableCents !== expenseCashBalance.availableCents) {
        setExpenseError("Le solde de caisse a changé. Vérifiez les nouveaux montants avant de confirmer à nouveau.");
        return;
      }
      const expense = await createExpenseTransaction({ schoolYearId: year.id, amount: nextAmount, category: trimmedCategory, description: trimmedDescription, beneficiary: trimmedBeneficiary, paymentMethod: trimmedPaymentMethod, reference: trimmedReference || undefined, clientRequestId: requestId });
      expenseHistory.prependItem(expense);
      expenseAttemptRef.current = null;
      setExpenseAmount("");
      setExpenseDescription("");
      setExpenseBeneficiary("");
      setExpensePaymentMethod("");
      setExpenseReference("");
      void refreshExpenseCashBalance().catch(() => {});
      if (user.role === "cashier") {
        setCashierControlFeedback("Dépense enregistrée avec succès.");
        setCashierControlFeedbackDrawer("expense");
      }
    } catch (error) {
      setExpenseError(error instanceof Error ? error.message : "Enregistrement de la dépense impossible.");
      void refreshExpenseCashBalance().catch(() => {});
    } finally {
      expenseSubmittingRef.current = false;
      setExpenseSubmitting(false);
    }
  }

  function openEditExpense(expense: Expense) {
    if (!canManageExpenses) return;
    setExpenseEditTarget(expense);
    setExpenseEditAmount(String(expense.amount));
    setExpenseEditCategory(expense.category || "Fournitures");
    setExpenseEditDescription(expense.description || "");
    setExpenseEditError("");
  }

  function closeEditExpense() {
    setExpenseEditTarget(null);
    setExpenseEditAmount("");
    setExpenseEditCategory("Fournitures");
    setExpenseEditDescription("");
    setExpenseEditError("");
  }

  async function updateExpense() {
    if (!expenseEditTarget || !canManageExpenses || financialMutationRef.current) return;
    setExpenseEditError("");
    const nextAmount = Number(expenseEditAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0 || (() => { try { return toMoneyMinor(nextAmount) <= 0; } catch { return true; } })()) {
      setExpenseEditError("Montant de dépense invalide.");
      return;
    }
    if (isOtherExpenseEditCategory && !expenseEditDescription.trim()) {
      setExpenseEditError("Veuillez préciser la nature de cette dépense.");
      return;
    }
    if (expenseEditDeltaCents > 0 && (!expenseCashBalance || expenseCashLoading || expenseEditCashInsufficient)) {
      setExpenseEditError("Opération impossible : solde de caisse insuffisant ou indisponible.");
      return;
    }
    const nextDescription = expenseEditDescription.trim() || expenseEditCategory;
    const reason = prompt("Motif obligatoire de modification de la dépense");
    if (!reason?.trim()) return;
    financialMutationRef.current = expenseEditTarget.id;
    setFinancialMutationId(expenseEditTarget.id);
    try {
      if (expenseEditDeltaCents > 0) {
        const latest = await refreshExpenseCashBalance();
        if (latest.availableCents !== expenseCashBalance?.availableCents) {
          setExpenseEditError("Le solde de caisse a changé. Vérifiez les nouveaux montants avant de confirmer à nouveau.");
          return;
        }
      }
      const updatedExpense = await updateExpenseTransaction({ transactionId: expenseEditTarget.id, amount: nextAmount, category: expenseEditCategory, description: nextDescription, reason: reason.trim(), clientRequestId: crypto.randomUUID() });
      expenseHistory.updateItem(updatedExpense);
      void refreshExpenseCashBalance().catch(() => {});
      closeEditExpense();
    } catch (error) {
      setExpenseEditError(error instanceof Error ? error.message : "Modification de la dépense impossible.");
      void refreshExpenseCashBalance().catch(() => {});
    } finally {
      financialMutationRef.current = "";
      setFinancialMutationId("");
    }
  }

  async function deleteExpense(expense: Expense) {
    if (!canManageExpenses || financialMutationRef.current) return;
    const reason = prompt("Motif obligatoire de suppression de la dépense");
    if (!reason?.trim()) return;
    financialMutationRef.current = expense.id;
    setFinancialMutationId(expense.id);
    try {
      await deleteFinancialTransaction({ kind: "expense", transactionId: expense.id, reason: reason.trim(), clientRequestId: crypto.randomUUID() });
      expenseHistory.removeItem(expense.id);
      void refreshExpenseCashBalance().catch(() => {});
      setExpenseDeleteTarget(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Suppression de la dépense impossible.");
    } finally {
      financialMutationRef.current = "";
      setFinancialMutationId("");
    }
  }

  function sendPaymentWarnings() {
    setWarningFeedback(null);
    if (isArchivedContext) {
      setWarningFeedback({ type: "error", message: "Cette année scolaire est archivée en lecture seule." });
      return;
    }
    const requiredAmount = Number(warningRequiredAmount);
    if (!warningClassKey || !warningFeeName || !Number.isFinite(requiredAmount) || requiredAmount <= 0 || !warningDeadline) {
      setWarningFeedback({ type: "error", message: "Veuillez renseigner la classe, le type de frais, le montant requis et la date limite." });
      return;
    }

    const matchingFees = yearData.feeTypes.filter(
      (fee) => fee.name === warningFeeName && (warningClassKey === "all" || (warningClassStudent && feeAppliesToStudent(fee, warningClassStudent))),
    );
    const warningFeeLabels = Array.from(new Set(matchingFees.map((fee) => String(fee.name).trim()).filter(Boolean)));
    const warningFeeSummary = warningFeeLabels.length ? warningFeeLabels.join(", ") : warningFeeName;
    const now = new Date().toISOString();
    const sentAtLabel = new Date(now).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const recipients = selectPaymentWarningRecipients({
      students: yearData.students,
      parents: yearData.parents,
      feeTypes: yearData.feeTypes,
      payments: yearData.payments,
      schoolId: school.id,
      schoolYearId: year.id,
      classKey: warningClassKey,
      feeName: warningFeeName,
      requiredAmount,
    });
    const affectedStudents = recipients.flatMap((recipient) => recipient.students);
    const warnings = recipients.map(({ parent, students: parentStudents }) => {
      const studentNames = parentStudents.map(studentFullName).join(", ");
      const childLabel = parentStudents.length > 1 ? "vos enfants" : "votre enfant";
      const body = [
        "Cher Parent,",
        "",
        `Nous vous informons que le paiement de ${warningFeeSummary} relatif à ${childLabel} ${studentNames} n'a pas encore atteint le montant requis par l'établissement.`,
        "",
        `Détails Type de frais : ${warningFeeSummary}.`,
        `Montant requis : ${formatMoney(requiredAmount)}`,
        `Date limite de régularisation : ${warningDeadline}.`,
        "",
        "Nous vous invitons à régulariser votre situation avant cette échéance afin d'éviter tout désagrément et de permettre à votre enfant de poursuivre sa scolarité dans les meilleures conditions.",
        "",
        `Cordialement, L'Administration de ${school.name}.`,
        "",
        sentAtLabel,
      ].join("\n");
      return {
        parent,
        notification: {
          id: createId("notif"),
          schoolId: school.id,
          schoolYearId: year.id,
          recipientRole: "parent" as const,
          parentId: parent.id,
          studentId: parentStudents[0].id,
          type: "payment" as const,
          title: "Avertissement de paiement",
          body,
          createdAt: now,
          read: false,
        },
      };
    });

    if (warnings.length === 0) {
      setWarningFeedback({ type: "info", message: "Aucun parent ne correspond aux critères sélectionnés." });
      return;
    }

    const campaignId = createId("warn");
    const notifiedParents = new Set(warnings.map((item) => item.parent.id));
    const status = warnings.length > 0 ? "Succès" : "Partiel";
    const auditLog = createAuditLog(
      user,
      school.id,
      year.id,
      "Avertissement paiement",
      JSON.stringify({
        kind: "payment_warning_campaign",
        campaignId,
        schoolName: school.name,
        actorRole: user.role === "cashier" ? "Caissier" : "Administrateur",
        feeName: warningFeeName,
        requiredAmount,
        deadline: warningDeadline,
        affectedStudents: affectedStudents.length,
        notifiedParents: notifiedParents.size,
        sentMessages: warnings.length,
        status,
      }),
      createId,
    );
    updateData({
      notifications: [...warnings.map((item) => item.notification), ...data.notifications],
      auditLogs: [auditLog, ...data.auditLogs],
    });
    setWarningFeedback({
      type: "success",
      message: `${affectedStudents.length} élève(s) concerné(s), ${notifiedParents.size} parent(s) notifié(s), ${warnings.length} avertissement(s) envoyé(s).`,
    });
  }

  function correctPayment(payment: Payment) {
    if (!canCorrectPayments || financialMutationRef.current) return;
    paymentCorrectionAttemptRef.current = null;
    setPaymentEditTarget(payment);
    setPaymentEditAmount(String(payment.amount));
    setPaymentEditReason("");
    setPaymentEditConfirmation("");
    setPaymentEditError("");
    setPaymentEditFeedback("");
  }

  async function savePaymentCorrection() {
    const payment = paymentEditTarget;
    if (!payment || !canCorrectPayments || financialMutationRef.current) return;
    const correctedAmount = Number(paymentEditAmount);
    let correctedMinor: number;
    try { correctedMinor = toMoneyMinor(correctedAmount); } catch { correctedMinor = 0; }
    if (correctedMinor <= 0) {
      setPaymentEditError("Montant de paiement invalide.");
      return;
    }
    const paymentStudent = controlIndexes.studentsById.get(payment.studentId);
    const paymentFee = paymentStudent
      ? (() => {
          const fee = controlIndexes.feeTypesById.get(payment.feeTypeId);
          return fee && feeAppliesToStudent(fee, paymentStudent) ? fee : undefined;
        })()
      : undefined;
    const paidForFee = paymentStudent && paymentFee
      ? remainingMoney(sumPaymentsForStudentFee(controlIndexes, paymentStudent.id, paymentFee.id), payment.amount)
      : 0;
    if (!paymentFee || toMoneyMinor(paidForFee) + correctedMinor > toMoneyMinor(paymentFee.amount)) {
      setPaymentEditError("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const reason = paymentEditReason.trim();
    if (!reason || paymentEditConfirmation !== "MODIFIER CE PAIEMENT") return;
    financialMutationRef.current = payment.id;
    setFinancialMutationId(payment.id);
    try {
      const expectedUpdatedAt = payment.updatedAt ?? payment.createdAt ?? "";
      const signature = JSON.stringify([payment.id, correctedAmount, reason, paymentEditConfirmation, expectedUpdatedAt]);
      if (paymentCorrectionAttemptRef.current?.signature !== signature) paymentCorrectionAttemptRef.current = { signature, requestId: crypto.randomUUID() };
      const correctedPayment = await updatePaymentTransaction({ transactionId: payment.id, amount: correctedAmount, reason, confirmation: paymentEditConfirmation, expectedUpdatedAt, clientRequestId: paymentCorrectionAttemptRef.current.requestId });
      paymentHistory.updateItem(correctedPayment);
      paymentCorrectionAttemptRef.current = null;
      if (studentId === correctedPayment.studentId) {
        void loadStudentArrears({ schoolYearId: year.id, studentId }).then((result) => setPaymentArrears(result.debts)).catch(() => setArrearsError("Actualisez les arriérés pour consulter le solde corrigé."));
      }
      setPaymentEditFeedback("Paiement modifié. Les totaux se synchronisent depuis Firestore.");
      setPaymentEditTarget(null);
    } catch (error) {
      setPaymentEditError(error instanceof Error ? error.message : "Correction du paiement impossible.");
    } finally {
      financialMutationRef.current = "";
      setFinancialMutationId("");
    }
  }

  async function deletePayment(payment: Payment) {
    if (!canCorrectPayments || financialMutationRef.current) return;
    const reason = prompt("Motif obligatoire de suppression du paiement");
    if (!reason) return;
    financialMutationRef.current = payment.id;
    setFinancialMutationId(payment.id);
    try {
      await deleteFinancialTransaction({ kind: "payment", transactionId: payment.id, reason, clientRequestId: crypto.randomUUID() });
      paymentHistory.removeItem(payment.id);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Suppression du paiement impossible.");
    } finally {
      financialMutationRef.current = "";
      setFinancialMutationId("");
    }
  }

  function renderPaymentWarningForm() {
    return (
      <div className="grid min-w-0 gap-4">
        {warningFeedback && (
          <p
            className={`rounded border p-3 text-sm font-semibold ${
              warningFeedback.type === "success"
                ? "border-mint/30 bg-mint/10 text-mint"
                : warningFeedback.type === "error"
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            {warningFeedback.message}
          </p>
        )}
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Classe
          <select value={warningClassKey} onChange={(event) => { setWarningClassKey(event.target.value); setWarningFeeName(""); }} className="input">
            <option value="" disabled hidden>Classe</option>
            <option value="all">Toutes</option>
            {classChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          Type de frais
          <select value={warningFeeName} onChange={(event) => setWarningFeeName(event.target.value)} disabled={!warningClassKey} className="input disabled:opacity-60">
            <option value="">Choisir un type de frais</option>
            {warningFeeNameChoices.map((feeName) => (
              <option key={feeName} value={feeName}>{feeName}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">Montant requis<MoneyInput value={warningRequiredAmount} onChange={setWarningRequiredAmount} /></label>
        <Field label="Date limite de régularisation" value={warningDeadline} onChange={setWarningDeadline} type="date" />
        <button onClick={sendPaymentWarnings} disabled={!warningFeeName} className="primary-button justify-center disabled:opacity-50" type="button">
          <Bell className="h-4 w-4" /> Envoyer
        </button>
        {warningClassKey && !warningFeeNameChoices.length && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun type de frais n'est défini pour cette classe.</p>}
      </div>
    );
  }

  function resetControlFilters() {
    setAmountComparator("");
    setAmountThreshold("");
    setControlClassKey("");
    setControlStudentSearch("");
  }

  async function printFilteredStudents() {
    if (pdfExportingRef.current) return;
    pdfExportingRef.current = true;
    setPdfExporting(true); setPdfExportError("");
    try { await generateFilteredStudentsPdf(); }
    catch { setPdfExportError("Impossible d’exporter le contrôle en PDF."); }
    finally { pdfExportingRef.current = false; setPdfExporting(false); }
  }

  async function generateFilteredStudentsPdf() {
    if (amountComparator.startsWith("arrears-")) {
      const filteredStudents = [...rows].sort((first, second) => compareStudentsForPdfByClass(first.student, second.student)).map((row) => row.student);
      const details: Record<string, HistoricalDebt[]> = {};
      for (let offset = 0; offset < filteredStudents.length; offset += 50) {
        Object.assign(details, await loadStudentArrearsDetailsBatch(year.id, filteredStudents.slice(offset, offset + 50).map((student) => student.id)));
      }
      await renderAcadPdfPreview({
        filename: `controle-arrieres-${year.name}.pdf`, title: "Rapport d'arriérés", school, year,
        subtitle: `Critère : Arriérés ${amountComparator === "arrears-gte" ? "≥" : "<"} ${amountThreshold ? formatMoney(Number(amountThreshold)) : "tous"}`,
        studentCount: filteredStudents.length,
        sections: controlArrearsPdfSections(filteredStudents, details, resolveSchoolCurrency(school)),
      });
      return;
    }
    const feeFilter = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    const selectedPdfFeeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
    const filterLabel =
      !amountComparator || amountComparator === "all" || !amountThreshold
        ? "Montant payé : tous"
        : amountComparator.startsWith("arrears-")
          ? `Arriérés ${amountComparator === "arrears-gte" ? "≥" : "<"} ${formatMoney(Number(amountThreshold))}`
        : selectedPdfFeeGroup && feeFilter
          ? `${selectedPdfFeeGroup.name} ${feeFilter[2] === "gte" ? ">=" : "<"} ${formatMoney(Number(amountThreshold))}`
          : `Montant payé ${amountComparator} ${formatMoney(Number(amountThreshold))}`;
    const pdfBalanceForRow = (row: (typeof rows)[number]) => {
      if (!selectedPdfFeeGroup) return row.balance;
      const expected = yearData.feeTypes
        .filter((fee) => selectedPdfFeeGroup.ids.includes(fee.id) && feeAppliesToStudent(fee, row.student))
        .reduce((sum, fee) => sumMoney([sum, fee.amount]), 0);
      const paid = sumMoney(selectedPdfFeeGroup.ids.map((feeId) => sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId)));
      return { expected, paid, remaining: remainingMoney(expected, paid) };
    };
    const showOptionColumn = rows.some(({ student }) => Boolean(student.option));
    const studentPaymentColumns: PdfTableColumn<(typeof rows)[number]>[] = [
      { header: "Nom de l'élève", render: ({ student }) => `${student.nom} ${student.postnom} ${student.prenom}`.trim() },
      { header: "Matricule", render: ({ student }) => student.matricule },
      { header: "Classe", render: ({ student }) => formatStudentPdfClassName(student) },
      { header: "Montant prévu", render: (row) => formatMoney(pdfBalanceForRow(row).expected), align: "right" },
      { header: "Montant payé", render: (row) => formatMoney(pdfBalanceForRow(row).paid), align: "right" },
      { header: "Solde restant", render: (row) => formatMoney(pdfBalanceForRow(row).remaining), align: "right" },
    ];
    if (showOptionColumn) {
      studentPaymentColumns.splice(3, 0, { header: "Option", render: ({ student }) => student.option || "-" });
    }
    await renderAcadPdfPreview({
      filename: `controle-paiements-${year.name}.pdf`,
      title: "Contrôle des paiements",
      school,
      year,
      subtitle: `Critère : ${filterLabel}`,
      studentCount: rows.length,
      sections: [
        pdfSection(
          "Élèves filtrés",
          pdfTable(
            studentPaymentColumns,
            [...rows].sort((first, second) => compareStudentsForPdfByClass(first.student, second.student)),
            "Aucun élève ne correspond aux filtres appliqués.",
          ),
        ),
      ],
    });
  }

  async function createStudentHistoryPdf(action: "view" | "print") {
    if (!selectedHistoryStudent) return;
    setHistoryPdfError("");
    setHistoryPdfLoading(true);
    try {
      const arrears = year.status === "active"
        ? await loadStudentArrears({ schoolYearId: year.id, studentId: selectedHistoryStudent.id })
        : null;
      await renderAcadPdfPreview({
      filename: `historique-${selectedHistoryStudent.matricule}.pdf`,
      title: action === "print" ? "Historique individuel des paiements" : "Historique individuel des paiements",
      school,
      year,
      sections: [
        pdfSection(
          "Identité de l'élève",
          pdfInfoGrid([
            { label: "Nom complet", value: studentFullName(selectedHistoryStudent) },
            { label: "Matricule", value: selectedHistoryStudent.matricule },
            { label: "Classe", value: formatStudentClassName(selectedHistoryStudent) },
            { label: "Total attendu", value: formatMoney(selectedHistoryFeeTotals.expected) },
            { label: "Total payé", value: formatMoney(selectedHistoryFeeTotals.paid) },
            { label: "Total restant", value: formatMoney(selectedHistoryFeeTotals.remaining) },
          ]),
        ),
        pdfSection(
          "Résumé par type de frais",
          pdfTable(
            [
              { header: "Type de frais", render: (row) => row.feeName },
              { header: "Total attendu", render: (row) => formatMoney(row.expected), align: "right" },
              { header: "Total payé", render: (row) => formatMoney(row.paid), align: "right" },
              { header: "Total restant", render: (row) => formatMoney(row.remaining), align: "right" },
            ],
            selectedHistoryFeeSummaries,
            "Aucun type de frais applicable pour cet élève.",
            {
              footerHtml: `
                <tr>
                  <td>Totaux généraux</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.expected))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.paid))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryFeeTotals.remaining))}</td>
                </tr>
              `,
            },
          ),
        ),
        pdfSection(
          "Paiements",
          pdfTable(
            [
              { header: "Date", render: (row) => formatPaymentDate(row.payment.paidAt) },
              { header: "Type de frais", render: (row) => row.feeName },
              { header: "Montant payé", render: (row) => formatMoney(row.payment.amount), align: "right" },
              { header: "Solde restant", render: (row) => formatMoney(row.remaining), align: "right" },
            ],
            selectedHistoryRows,
            "Aucun paiement enregistré pour cet élève.",
            {
              footerHtml: `
                <tr>
                  <td colspan="2">Totaux</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryBalance.paid))}</td>
                  <td class="align-right">${escapePdfHtml(formatMoney(selectedHistoryBalance.remaining))}</td>
                </tr>
              `,
            },
          ),
        ),
        arrears
          ? historicalArrearsPdfSection([...arrears.debts, ...arrears.settled])
          : pdfSection("Arriérés des années antérieures", "<p>Consultation disponible depuis l'année scolaire active.</p>"),
      ],
      });
    } catch (error) {
      setHistoryPdfError(error instanceof Error ? error.message : "Impossible de charger les arriérés pour le PDF.");
    } finally {
      setHistoryPdfLoading(false);
    }
  }

  function renderPaymentHistoryPagination() {
    return (
      <>
        <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
          Recherche appliquée aux paiements déjà chargés. Utilisez Charger plus pour afficher les pages suivantes.
        </p>
        {paymentHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement de l'historique...</p>}
        {paymentHistory.loadError && (
          <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">{paymentHistory.loadError}</p>
            <button onClick={() => void paymentHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
          </div>
        )}
        {paymentHistory.hasMore && (
          <button
            onClick={() => void paymentHistory.loadMore()}
            disabled={paymentHistory.isLoadingMore}
            className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            {paymentHistory.isLoadingMore ? "Chargement..." : "Charger plus"}
          </button>
        )}
      </>
    );
  }

  function renderExpenseHistoryContent() {
    return (
      <div className="space-y-2">
        <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input value={expenseHistoryQuery} onChange={(event) => setExpenseHistoryQuery(event.target.value)} className="min-w-0 flex-1 outline-none" placeholder="Rechercher une dépense" aria-label="Rechercher dans l'historique des dépenses" />
        </label>
        <p className="rounded bg-slate-50 p-3 text-xs font-semibold text-slate-500">
          Historique chargé par pages de 50 éléments, du plus récent au plus ancien.
        </p>
        {expenseHistory.isInitialLoading && <p className="rounded bg-blue-50 p-3 text-sm font-semibold text-blue-700">Chargement de l'historique...</p>}
        {expenseHistory.loadError && (
          <div className="grid gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <p className="font-semibold">{expenseHistory.loadError}</p>
            <button onClick={() => void expenseHistory.loadFirstPage()} className="secondary-button w-fit" type="button">Réessayer</button>
          </div>
        )}
        {sortedExpenses.length === 0 && !expenseHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">{normalizedExpenseQuery ? "Aucune dépense trouvée." : "Aucune dépense enregistrée."}</p>}
        {sortedExpenses.map((expense) => {
          const beneficiary = getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]);
          const paymentMethod = getExpenseField(expense, ["paymentMethod", "modePaiement", "paymentMode", "mode"]);
          const reference = getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"]);
          return (
            <div key={expense.id} className="rounded border border-slate-100 p-3 text-sm">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">{expense.description || expenseCategoryLabel(expense.category)}</p>
                  <p className="break-words text-slate-500">{formatExpenseDateTime(expense)} | {expenseCategoryLabel(expense.category)} | {formatMoney(expense.amount)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button onClick={() => void generateExpensePdf(expense, school, year, resolveExpenseCashierName(expense, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Télécharger le justificatif PDF" type="button">
                    <Download className="h-4 w-4" />
                  </button>
                  {user.role !== "cashier" && canManageExpenses && !expense.personnelPaymentId && <button onClick={() => openEditExpense(expense)} className="rounded bg-slate-100 p-2" title="Modifier" type="button">
                    <Edit3 className="h-4 w-4" />
                  </button>}
                  {user.role !== "cashier" && canManageExpenses && !expense.personnelPaymentId && <button onClick={() => setExpenseDeleteTarget(expense)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer" type="button">
                    <Trash2 className="h-4 w-4" />
                  </button>}
                </div>
              </div>
              <dl className="mt-3 grid min-w-0 gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <div><dt className="font-semibold text-slate-600">Bénéficiaire / fournisseur</dt><dd className="break-words">{beneficiary || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Enregistré par</dt><dd className="break-words">{expense.cashierName || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Mode de paiement</dt><dd className="break-words">{paymentMethod || "-"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Référence / pièce</dt><dd className="break-words">{reference || "-"}</dd></div>
              </dl>
            </div>
          );
        })}
        {expenseHistory.hasMore && (
          <button
            onClick={() => void expenseHistory.loadMore()}
            disabled={expenseHistory.isLoadingMore}
            className="secondary-button w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
          >
            {expenseHistory.isLoadingMore ? "Chargement..." : "Charger plus"}
          </button>
        )}
      </div>
    );
  }

  if (selectedHistoryStudent) {
    return (
      <section className="grid min-w-0 gap-4">
        <div className="flex min-w-0 flex-col gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <button
              onClick={() => setSelectedHistoryStudentId("")}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-700 transition hover:bg-slate-200 hover:text-ink"
              aria-label="Retour au controle"
              title="Retour"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="break-words text-2xl font-bold text-ink">{studentFullName(selectedHistoryStudent)}</h1>
              <p className="break-words text-sm text-slate-500">
                {selectedHistoryStudent.matricule} | {formatStudentClassName(selectedHistoryStudent)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:justify-start">
            <button onClick={() => void createStudentHistoryPdf("print")} className="primary-button justify-center" type="button" disabled={historyPdfLoading}>
              <Download className="h-4 w-4" /> {historyPdfLoading ? "Préparation du PDF…" : "Imprimer PDF"}
            </button>
          </div>
        </div>
        {historyPdfError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{historyPdfError}</p>}

        <div className="grid min-w-0 grid-cols-3 divide-x divide-slate-200 rounded border border-slate-200 bg-slate-50 shadow-sm">
          {([
            ["Total attendu", selectedHistoryFeeTotals.expected],
            ["Total payé", selectedHistoryFeeTotals.paid],
            ["Total restant", selectedHistoryFeeTotals.remaining],
          ] as const).map(([label, amount]) => (
            <div key={label} className="min-w-0 px-1 py-2 text-center sm:px-3 sm:py-3">
              <p className="break-words text-[10px] leading-tight text-slate-600 sm:text-xs">{label}</p>
              <p className="mt-1 min-w-0 break-words text-[11px] font-bold leading-tight text-ink sm:text-base">{formatMoney(amount)}</p>
            </div>
          ))}
        </div>

        <div className="min-w-0 rounded border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <h2 className="text-lg font-bold text-ink">Dettes des années antérieures</h2>
          {historyArrears.length === 0 && <p className="mt-2 text-sm text-slate-600">Aucune créance historique trouvée pour cet élève.</p>}
          <div className="mt-2 grid gap-2">
            {historyArrears.map((debt) => <div key={`${debt.schoolYearId}:${debt.feeTypeId}`} className="min-w-0 rounded border border-amber-200 bg-white p-3 text-sm">
              <p className="break-words font-semibold">{debt.feeName} · {debt.yearName} {debt.remaining === 0 ? "· Soldée" : "· À payer"}</p>
              <p className="break-words text-slate-600">Attendu : {formatCurrencyMoney(debt.expected, debt.currency)} · Payé : {formatCurrencyMoney(debt.paid, debt.currency)} · Solde : {formatCurrencyMoney(debt.remaining, debt.currency)}</p>
            </div>)}
          </div>
          {selectedHistoryArrearPayments.length > 0 && <div className="mt-3 grid gap-2">
            <h3 className="font-semibold">Règlements des arriérés encaissés cette année</h3>
            {selectedHistoryArrearPayments.map((payment) => <p key={payment.id} className="break-words rounded bg-white p-2 text-sm">
              {payment.paidAt} · {payment.feeName ?? "Frais"} · {payment.debtSchoolYearName ?? payment.schoolYearId} · {payment.currency === "CDF" || payment.currency === "USD" ? formatCurrencyMoney(payment.amount, payment.currency) : "Devise historique inconnue"}
            </p>)}
          </div>}
        </div>

        <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 min-w-0">
            <h2 className="break-words text-lg font-bold text-ink">Résumé par type de frais</h2>
            <p className="text-sm text-slate-500">Montants attendus, payés et restants pour les frais applicables à cet élève.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Type de frais</th>
                  <th className="px-3 py-2 text-right">Total attendu</th>
                  <th className="px-3 py-2 text-right">Total payé</th>
                  <th className="px-3 py-2 text-right">Total restant</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistoryFeeSummaries.map((summary) => (
                  <tr key={summary.feeTypeId} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-ink">{summary.feeName}</td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-700">{formatMoney(summary.expected)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-mint">{formatMoney(summary.paid)}</td>
                    <td className="px-3 py-3 text-right font-semibold text-ink">{formatMoney(summary.remaining)}</td>
                  </tr>
                ))}
                {selectedHistoryFeeSummaries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Aucun type de frais applicable pour cet élève.
                    </td>
                  </tr>
                )}
              </tbody>
              {selectedHistoryFeeSummaries.length > 0 && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-bold text-ink">
                  <tr>
                    <td className="px-3 py-3">Totaux généraux</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.expected)}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.paid)}</td>
                    <td className="px-3 py-3 text-right">{formatMoney(selectedHistoryFeeTotals.remaining)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 min-w-0">
            <h2 className="break-words text-lg font-bold text-ink">Paiements de l'eleve</h2>
            <p className="text-sm text-slate-500">Liste chronologique limitee a cet eleve.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Type de frais</th>
                  <th className="px-3 py-2">Montant paye</th>
                  <th className="px-3 py-2">Solde restant</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistoryRows.map((row) => (
                  <tr key={row.payment.id} className="border-t border-slate-100">
                    <td className="px-3 py-3 font-medium text-ink">{formatPaymentDate(row.payment.paidAt)}</td>
                    <td className="px-3 py-3 text-slate-700">{row.feeName}</td>
                    <td className="px-3 py-3 font-semibold text-mint">{formatMoney(row.payment.amount)}</td>
                    <td className="px-3 py-3 font-semibold text-ink">{formatMoney(row.remaining)}</td>
                  </tr>
                ))}
                {selectedHistoryRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      Aucun paiement enregistre pour cet eleve.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-4">
      <div className="min-w-0">
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants." />
        <div className="mb-3 w-full min-w-0 max-w-full">
          {amountSearching && <p role="status">Recherche...</p>}
          {filterArrearsError && <p role="alert" className="text-red-700">{filterArrearsError}</p>}
          {pdfExportError && <p role="alert" className="text-red-700">{pdfExportError}</p>}
          <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 box-border sm:grid-cols-2 lg:flex lg:flex-nowrap lg:items-center lg:gap-1.5">
              <select value={controlClassKey} onChange={(event) => setControlClassKey(event.target.value)} className="h-10 min-w-0 w-full rounded border border-slate-200 bg-white px-2 text-sm lg:flex-1 lg:basis-0" aria-label="Classe">
                <option value="" disabled hidden>Classe</option>
                <option value="all">Toutes</option>
                {classChoices.map((choice) => <option key={choice.key} value={choice.key}>{choice.label}</option>)}
              </select>
              <PaidAmountDropdown value={amountComparator} onChange={setAmountComparator} options={amountOptions} className="lg:flex-1 lg:basis-0" />
              <MoneyInput value={amountThreshold} onChange={setAmountThreshold} className="input min-w-0 w-full lg:flex-1 lg:basis-0" placeholder="Filtre" ariaLabel="Filtre" />
              <button onClick={() => void printFilteredStudents()} disabled={pdfExporting || amountSearching || Boolean(filterArrearsError)} className="pdf-export-button h-10 min-w-0 px-2 lg:flex-1 lg:basis-0" type="button">
                <Download className="h-4 w-4" /> {pdfExporting ? "En cours..." : "Exporter PDF"}
              </button>
              <label className="flex h-10 min-w-0 w-full items-center gap-2 rounded border border-slate-200 bg-white px-2 text-sm lg:flex-1 lg:basis-0">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  value={controlStudentSearch}
                  onChange={(event) => setControlStudentSearch(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  placeholder="Nom, prénom ou matricule"
                  aria-label="Rechercher un élève dans le contrôle"
                />
              </label>
              <button onClick={resetControlFilters} className="secondary-button h-10 min-w-0 justify-center px-2 lg:flex-1 lg:basis-0" type="button" title="Réinitialiser" aria-label="Réinitialiser"><RotateCcw className="h-4 w-4" /> Réinitialiser</button>
              {user.role !== "cashier" && <button onClick={() => setWarningOpen(true)} className="secondary-button h-10 min-w-0 justify-center px-2 lg:flex-1 lg:basis-0" type="button" title="Avertissement" aria-label="Avertissement">
                <Bell className="h-4 w-4" /> Avertissement
              </button>}
              <button onClick={() => setHistoryOpen(true)} className="secondary-button h-10 min-w-0 justify-center px-2 text-sm lg:flex-1 lg:basis-0 lg:text-xs" type="button">
                Historique
              </button>
              {user.role === "cashier" && canPay && <button onClick={() => { setCashierControlFeedback(""); setCashierControlFeedbackDrawer(null); setCashierControlDrawer("payment"); }} className="primary-button h-10 min-w-0 justify-center px-2 text-sm lg:flex-1 lg:basis-0 lg:text-xs" type="button">
              <Plus className="h-4 w-4" /> Enregistrer
              </button>}
          </div>
        </div>
        {recordedPersonnelPayment && <div role="status" className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">
          <span className="min-w-0 flex-1 break-words">Paiement du personnel enregistré : {recordedPersonnelPayment.reference}</span>
          <button type="button" className="secondary-button justify-center" onClick={() => void printPersonnelPaymentPdf(recordedPersonnelPayment, school)}>{recordedPersonnelPayment.kind === "advance" ? "Télécharger le justificatif" : "Télécharger le bulletin de paie"}</button>
          <button type="button" aria-label="Fermer la confirmation du paiement" onClick={() => setRecordedPersonnelPayment(undefined)}><X className="h-4 w-4" /></button>
        </div>}
        <div className="grid min-w-0 gap-3">
          {!amountSearching && !filterArrearsError && paginatedControlRows.map(({ student, balance, progress, hasApplicableFees }) => (
            <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <button
                    onClick={() => setSelectedHistoryStudentId(student.id)}
                    className="break-words text-left font-bold text-ink underline-offset-4 transition hover:text-blue-700 hover:underline"
                    type="button"
                  >
                    {student.nom} {student.prenom}
                  </button>
                  <p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)}</p>
                </div>
                <span className={`shrink-0 rounded px-2 py-1 text-xs font-semibold ${isStudentPaymentComplete(balance) ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                  {isStudentPaymentComplete(balance) ? "En ordre" : "Non en ordre"}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Prévu" value={formatMoney(balance.expected)} />
                <Metric label="Payé" value={formatMoney(balance.paid)} />
                <Metric label="Solde" value={formatMoney(balance.remaining)} />
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded bg-slate-100">
                <div className={`h-full rounded transition-colors ${progressBarTone(progress)}`} style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-2 flex min-w-0 flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>{progress}% payé</span>
                {!hasApplicableFees && <span className="font-semibold text-slate-500">Aucun frais défini pour cette classe.</span>}
              </div>
            </article>
          ))}
          {!amountSearching && !filterArrearsError && visibleRows.length === 0 && (
            <p className="rounded border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              Aucun élève ne correspond aux filtres appliqués.
            </p>
          )}
          {!amountSearching && !filterArrearsError && visibleRows.length > CONTROL_PAGE_SIZE && (
            <nav aria-label="Pagination du contrôle" className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{formatCount(visibleRows.length)} élèves · page {formatCount(controlPage)}/{formatCount(controlPageCount)}</span>
              <div className="flex gap-2">
                <button type="button" className="secondary-button" disabled={controlPage === 1} onClick={() => setControlPage((current) => Math.max(1, current - 1))}>Précédent</button>
                <button type="button" className="secondary-button" disabled={controlPage === controlPageCount} onClick={() => setControlPage((current) => Math.min(controlPageCount, current + 1))}>Suivant</button>
              </div>
            </nav>
          )}
        </div>
      </div>
      {user.role !== "cashier" && (
      <div className="min-w-0 space-y-4">
        {canPay && (
          <FormPanel title="Enregistrer un paiement">
            <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="input">
              {yearData.students.map((student) => (
                <option key={student.id} value={student.id}>{student.nom} {student.prenom}</option>
              ))}
            </select>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <Metric label="Attendu" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.expected, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.expected)} />
              <Metric label="Payé" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.paid, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.paid)} />
              <Metric label="Solde" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.remaining, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.remaining)} />
            </div>
            {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
            <select aria-label="Type de frais" value={selectedFeeTypeValue} onChange={(event) => { setFeeTypeId(event.target.value); setPaymentError(""); }} disabled={!selectedPaymentStudent || (payableFeeTypes.length === 0 && paymentArrears.length === 0) || paymentSubmitting} className="input disabled:opacity-60">
              <optgroup label={`Année actuelle — ${year.name}`}>
                {payableFeeTypes.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} — {year.name} — {formatMoney(fee.amount)}</option>)}
              </optgroup>
              {paymentArrears.length > 0 && <optgroup label="Dettes antérieures">
                {paymentArrears.map((debt) => <option key={debt.feeTypeId} value={debt.feeTypeId}>{debt.feeName} — Arriéré {debt.yearName} — Reste : {formatCurrencyMoney(debt.remaining, debt.currency)}</option>)}
              </optgroup>}
            </select>
            {arrearsLoading && <p className="text-sm text-slate-500">Recherche des arriérés antérieurs…</p>}
            {arrearsError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{arrearsError}</p>}
            {selectedPaymentDebt && <p className="rounded bg-amber-50 p-3 text-sm font-semibold text-amber-800">Créance de {selectedPaymentDebt.yearName} · encaissement en {year.name} · montant en {selectedPaymentDebt.currency}</p>}
            {selectedPaymentFee && selectedPaymentFeeRemaining === 0 && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Ce type de frais est déjà soldé.</p>}
            <MoneyInput value={amount} onChange={setAmount} max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" />
            <textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} maxLength={1000} className="input min-h-20" placeholder="Description" />
            <button onClick={savePayment} disabled={isPaymentEntryDisabled || paymentSubmitting} className="primary-button justify-center disabled:opacity-50"><Plus className="h-4 w-4" /> {paymentSubmitting ? "Enregistrement…" : "Enregistrer"}</button>
          </FormPanel>
        )}
        {canPay && (
          <FormPanel title="Enregistrer une dépense">
            <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} className="input">
              <option>Fournitures</option>
              <option>Transport</option>
              <option value="Salaire">Main d'œuvre</option>
              <option>Maintenance</option>
              <option>Autres</option>
            </select>
            <MoneyInput value={expenseAmount} onChange={setExpenseAmount} />
            {renderExpenseCashBalance(expenseDebitCents)}
            <textarea value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} className="input min-h-24" placeholder="Description" />
            <button onClick={saveExpense} disabled={isExpenseEntryIncomplete || expenseSubmitting || expenseCashLoading || !expenseCashBalance || expenseCashInsufficient} className="primary-button justify-center"><Plus className="h-4 w-4" /> {expenseSubmitting ? "Enregistrement…" : "Enregistrer"}</button>
          </FormPanel>
        )}
      </div>
      )}
      {user.role === "cashier" && cashierControlDrawer && (
        <AdminDrawer title={cashierDrawerTitle} onClose={() => setCashierControlDrawer(null)} closeLabel={`Fermer ${cashierDrawerTitle}`}>
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Type d'enregistrement
            <select aria-label="Type d'enregistrement" className="input min-w-0 w-full" value={cashierControlDrawer} onChange={(event) => setCashierControlDrawer(event.target.value as "payment" | "expense" | "personnel" | "inflow")}>
              <option value="payment">Enregistrer un paiement</option>
              <option value="expense">Enregistrer une dépense</option>
              <option value="personnel">Paiement du personnel</option>
              <option value="inflow">Autres entrées de caisse</option>
            </select>
          </label>
          {cashierControlFeedback && cashierControlFeedbackDrawer === cashierControlDrawer && (
            <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{cashierControlFeedback}</p>
          )}
          {cashierControlDrawer === "payment" && (
            <>
              <div className="grid min-w-0 gap-2">
                <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    ref={paymentStudentSearchRef}
                    value={paymentStudentQuery}
                    onChange={(event) => updatePaymentStudentQuery(event.target.value)}
                    className="min-w-0 flex-1 outline-none"
                    placeholder="Rechercher par nom, postnom, prénom ou matricule"
                  />
                </label>
                {paymentStudentQuery.trim() === "" && (
                  <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Saisissez un nom ou un matricule pour afficher les élèves.</p>
                )}
                {paymentStudentQuery.trim() !== "" && paymentStudentResults.length === 0 && (
                  <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève trouvé.</p>
                )}
                {!selectedPaymentStudent && paymentStudentResults.length > 0 && (
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1 scrollbar-thin">
                    {paymentStudentResults.map((student) => (
                      <button
                        key={student.id}
                        onClick={() => selectPaymentStudent(student)}
                        className={`w-full rounded border p-3 text-left text-sm transition ${
                          student.id === studentId ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-slate-50 hover:border-slate-200"
                        }`}
                        type="button"
                      >
                        <p className="break-words font-semibold text-ink">{student.nom} {student.postnom} {student.prenom}</p>
                        <p className="text-xs text-slate-500">{student.matricule} | {formatStudentClassName(student)}</p>
                      </button>
                    ))}
                  </div>
                )}
                {selectedPaymentStudent && (
                  <div className="flex min-w-0 items-center gap-2 rounded bg-mint/10 py-1.5 pl-3 pr-1.5 text-sm font-semibold text-mint">
                    <span className="min-w-0 flex-1 break-words">Élève sélectionné : {selectedPaymentStudent.nom} {selectedPaymentStudent.postnom} {selectedPaymentStudent.prenom}</span>
                    <button type="button" aria-label="Effacer l’élève sélectionné" title="Effacer l’élève sélectionné" onClick={clearPaymentStudent} disabled={paymentSubmitting} className="flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-mint/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Attendu" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.expected, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.expected)} />
                <Metric label="Payé" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.paid, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.paid)} />
                <Metric label="Solde" value={selectedPaymentDebt ? formatCurrencyMoney(selectedPaymentFeeBalance.remaining, selectedPaymentDebt.currency) : formatMoney(selectedPaymentFeeBalance.remaining)} />
              </div>
              {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
              <select aria-label="Type de frais" value={selectedFeeTypeValue} onChange={(event) => { setFeeTypeId(event.target.value); setPaymentError(""); }} disabled={!selectedPaymentStudent || (payableFeeTypes.length === 0 && paymentArrears.length === 0) || paymentSubmitting} className="input disabled:opacity-60">
                <optgroup label={`Année actuelle — ${year.name}`}>
                  {payableFeeTypes.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} — {year.name} — {formatMoney(fee.amount)}</option>)}
                </optgroup>
                {paymentArrears.length > 0 && <optgroup label="Dettes antérieures">
                  {paymentArrears.map((debt) => <option key={debt.feeTypeId} value={debt.feeTypeId}>{debt.feeName} — Arriéré {debt.yearName} — Reste : {formatCurrencyMoney(debt.remaining, debt.currency)}</option>)}
                </optgroup>}
              </select>
              {arrearsLoading && <p className="text-sm text-slate-500">Recherche des arriérés antérieurs…</p>}
              {arrearsError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{arrearsError}</p>}
              {selectedPaymentDebt && <p className="rounded bg-amber-50 p-3 text-sm font-semibold text-amber-800">Créance de {selectedPaymentDebt.yearName} · encaissement en {year.name} · montant en {selectedPaymentDebt.currency}</p>}
              {selectedPaymentFee && selectedPaymentFeeRemaining === 0 && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">Ce type de frais est déjà soldé.</p>}
              <MoneyInput value={amount} onChange={setAmount} max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" />
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                Description
                <textarea value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} maxLength={1000} className="input min-h-20" placeholder="Écrivez la description" />
              </label>
              <button onClick={savePayment} disabled={isPaymentEntryDisabled || paymentSubmitting} className="primary-button w-full justify-center" type="button"><Plus className="h-4 w-4" /> {paymentSubmitting ? "Enregistrement…" : "Enregistrer"}</button>
            </>
          )}
          {cashierControlDrawer === "personnel" && <PersonnelPaymentForm school={school} year={year} onRecorded={(payment) => { setRecordedPersonnelPayment(payment); setCashierControlDrawer(null); void expenseHistory.loadFirstPage(); void refreshExpenseCashBalance().catch(() => {}); }} />}
          {cashierControlDrawer === "inflow" && <OtherCashInflowForm year={year} onRecorded={(inflow) => {
            cashInflowHistory.prependItem(inflow);
            void refreshExpenseCashBalance().catch(() => {});
            setCashierControlFeedback("Autre entrée de caisse enregistrée avec succès.");
            setCashierControlFeedbackDrawer("inflow");
          }} />}
          {cashierControlDrawer === "expense" && (
            <>
              <select
                value={expenseCategory}
                onChange={(event) => {
                  const nextCategory = event.target.value;
                  setExpenseCategory(nextCategory);
                  setExpenseError("");
                }}
                className="input"
              >
                <option>Fournitures</option>
                <option>Transport</option>
                <option value="Salaire">Main d'œuvre</option>
                <option>Maintenance</option>
                <option>Autre</option>
              </select>
              <MoneyInput value={expenseAmount} onChange={setExpenseAmount} />
              {renderExpenseCashBalance(expenseDebitCents)}
              <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
                Description
                <textarea
                  value={expenseDescription}
                  onChange={(event) => {
                    setExpenseDescription(event.target.value);
                    setExpenseError("");
                  }}
                  className="input min-h-24"
                  placeholder="Écrivez la description"
                />
              </label>
              <input
                value={expenseBeneficiary}
                onChange={(event) => {
                  setExpenseBeneficiary(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Bénéficiaire / fournisseur"
              />
              <input
                value={expensePaymentMethod}
                onChange={(event) => {
                  setExpensePaymentMethod(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Mode de paiement"
              />
              <input
                value={expenseReference}
                onChange={(event) => {
                  setExpenseReference(event.target.value);
                  setExpenseError("");
                }}
                className="input"
                placeholder="Référence / pièce (facultatif)"
              />
              {expenseError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseError}</p>}
              <button onClick={saveExpense} disabled={isExpenseEntryIncomplete || expenseSubmitting || expenseCashLoading || !expenseCashBalance || expenseCashInsufficient} className="primary-button w-full justify-center" type="button"><Plus className="h-4 w-4" /> {expenseSubmitting ? "Enregistrement…" : "Enregistrer"}</button>
            </>
          )}
        </AdminDrawer>
      )}
      {warningOpen && (
        <AdminDrawer title="Avertissement" onClose={() => setWarningOpen(false)} closeLabel="Fermer l'avertissement">
          {renderPaymentWarningForm()}
        </AdminDrawer>
      )}
      {historyOpen && (
        <AdminDrawer title="Historique" onClose={() => setHistoryOpen(false)} closeLabel="Fermer l'historique">
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Type d'historique
            <select aria-label="Type d'historique" className="input min-w-0 w-full" value={historyKind} onChange={(event) => setHistoryKind(event.target.value as typeof historyKind)}>
              <option value="payments">Historique des paiements</option>
              <option value="expenses">Historique des dépenses</option>
              <option value="cashInflows">Historique des autres entrées de caisse</option>
              <option value="payroll">Historique Salaire/prime</option>
            </select>
          </label>
          {historyKind === "payments" && <>
            {paymentEditFeedback && <p role="status" className="rounded bg-green-50 p-3 text-sm text-green-800">{paymentEditFeedback}</p>}
            <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                className="min-w-0 flex-1 outline-none"
                placeholder="Rechercher par nom ou matricule"
              />
            </label>
            <div className="space-y-2">
              {filteredHistoryPayments.length === 0 && !paymentHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun paiement trouvé</p>}
              {filteredHistoryPayments.map(({ payment, student, fee }) => {
                return (
                  <div key={payment.id} className="rounded border border-slate-100 p-3 text-sm">
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="min-w-0 break-words font-semibold text-ink">{student.nom} {student.prenom}</p>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        <button onClick={() => generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF">
                          <Download className="h-4 w-4" />
                        </button>
                        {canCorrectPayments && !payment.collectionSchoolYearId && <button onClick={() => correctPayment(payment)} disabled={financialMutationId === payment.id} className="rounded bg-slate-100 p-2 disabled:opacity-50" title="Corriger"><Edit3 className="h-4 w-4" /></button>}
                        {canCorrectPayments && !payment.collectionSchoolYearId && <button onClick={() => deletePayment(payment)} disabled={financialMutationId === payment.id} className="rounded bg-red-50 p-2 text-red-700 disabled:opacity-50" title="Supprimer"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                    <p className="break-words text-slate-500">{fee.name} {payment.collectionSchoolYearId ? `| Arriéré ${payment.debtSchoolYearName ?? payment.schoolYearId}` : ""} | {payment.currency ? formatCurrencyMoney(payment.amount, payment.currency) : formatMoney(payment.amount)} | {payment.paidAt}</p>
                    {payment.note && <p className="mt-1 break-words text-slate-600">Description : {payment.note}</p>}
                  </div>
                );
              })}
            </div>
            {paymentEditTarget && <div className="grid min-w-0 gap-3 rounded border border-slate-300 bg-white p-3 text-sm">
              <strong>Modifier le paiement — {paymentEditTarget.receiptNumber ?? paymentEditTarget.id}</strong>
              <label className="grid gap-1">Ancien montant<input className="input" readOnly value={String(paymentEditTarget.amount)} /></label>
              <label className="grid gap-1">Nouveau montant<MoneyInput value={paymentEditAmount} onChange={setPaymentEditAmount} /></label>
              <label className="grid gap-1">Raison obligatoire<textarea className="input" maxLength={500} value={paymentEditReason} onChange={(event) => setPaymentEditReason(event.target.value)} /></label>
              <label className="grid gap-1">Saisissez exactement MODIFIER CE PAIEMENT<input className="input" autoComplete="off" value={paymentEditConfirmation} onChange={(event) => setPaymentEditConfirmation(event.target.value)} /></label>
              {paymentEditError && <p role="alert" className="text-red-700">{paymentEditError}</p>}
              <div className="flex flex-wrap gap-2"><button type="button" className="primary-button justify-center" disabled={Boolean(financialMutationId) || !paymentEditReason.trim() || !(Number(paymentEditAmount) > 0) || paymentEditConfirmation !== "MODIFIER CE PAIEMENT"} onClick={() => void savePaymentCorrection()}>Enregistrer</button><button type="button" className="secondary-button justify-center" onClick={() => setPaymentEditTarget(null)}>Annuler</button></div>
            </div>}
            {renderPaymentHistoryPagination()}
          </>}
          {historyKind === "expenses" && renderExpenseHistoryContent()}
          {historyKind === "cashInflows" && <div className="grid gap-2">
            {cashInflowHistory.isInitialLoading && <p>Chargement des entrées de caisse…</p>}
            {cashInflowHistory.loadError && <p role="alert" className="text-red-700">{cashInflowHistory.loadError}</p>}
            {cashInflowHistory.items.map((inflow) => <article key={inflow.id} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-semibold text-ink">Autres entrées de caisse · {inflow.category}</p>
              <p>{formatCurrencyMoney(inflow.amount, inflow.currency)} · {inflow.entryDate} · {inflow.source}</p>
              <p className="break-words">Description : {inflow.description}</p>
              <p>Mode de paiement : {inflow.paymentMethod}{inflow.reference ? ` · Référence : ${inflow.reference}` : ""}</p>
              <p>Enregistré par : {inflow.cashierName}</p>
            </article>)}
            {!cashInflowHistory.isInitialLoading && cashInflowHistory.items.length === 0 && <p>Aucune autre entrée de caisse enregistrée.</p>}
            {cashInflowHistory.hasMore && <button type="button" className="secondary-button w-full justify-center" disabled={cashInflowHistory.isLoadingMore} onClick={() => void cashInflowHistory.loadMore()}>Charger plus</button>}
          </div>}
          {historyKind === "payroll" && <PersonnelPayrollHistory schoolId={school.id} schools={[school]} allowEdit={user.role === "school_admin"} />}
        </AdminDrawer>
      )}
      {expenseEditTarget && (
        <AdminDrawer title="Modifier la dépense" onClose={closeEditExpense} closeLabel="Fermer la modification de dépense">
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Catégorie
            <select
              value={expenseEditCategory}
              onChange={(event) => {
                setExpenseEditCategory(event.target.value);
                setExpenseEditError("");
              }}
              className="input"
            >
              <option>Fournitures</option>
              <option>Transport</option>
              <option value="Salaire">Main d'œuvre</option>
              <option>Maintenance</option>
              <option>Autre</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Montant<MoneyInput value={expenseEditAmount} onChange={setExpenseEditAmount} /></label>
          {expenseEditDeltaCents > 0 && renderExpenseCashBalance(expenseEditDeltaCents, "Supplément à décaisser")}
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-slate-700">
            Libellé ou motif
            <textarea
              value={expenseEditDescription}
              onChange={(event) => {
                setExpenseEditDescription(event.target.value);
                setExpenseEditError("");
              }}
              className="input min-h-24"
              placeholder="Description de la dépense"
            />
          </label>
          {expenseEditError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseEditError}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={closeEditExpense} className="secondary-button justify-center" type="button">Annuler</button>
            <button onClick={updateExpense} disabled={!canManageExpenses || financialMutationId === expenseEditTarget.id || expenseEditDeltaCents > 0 && (expenseCashLoading || !expenseCashBalance || expenseEditCashInsufficient)} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
              {financialMutationId === expenseEditTarget.id ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </AdminDrawer>
      )}
      {expenseDeleteTarget && (
        <AdminDrawer title="Supprimer la dépense" onClose={() => setExpenseDeleteTarget(null)} closeLabel="Annuler la suppression de dépense">
          <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
            Confirmez-vous la suppression de cette dépense ? Cette action ne supprimera aucune autre donnée.
          </p>
          <div className="rounded border border-slate-100 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">{expenseDeleteTarget.description || expenseDeleteTarget.category}</p>
            <p className="text-slate-500">{formatExpenseDateTime(expenseDeleteTarget)} | {formatMoney(expenseDeleteTarget.amount)} | {expenseDeleteTarget.cashierName}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={() => setExpenseDeleteTarget(null)} className="secondary-button justify-center" type="button">Annuler</button>
            <button onClick={() => deleteExpense(expenseDeleteTarget)} disabled={!canManageExpenses || financialMutationId === expenseDeleteTarget.id} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Supprimer
            </button>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
