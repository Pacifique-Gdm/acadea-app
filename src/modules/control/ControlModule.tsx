import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bell, Download, Edit3, Plus, Search, Trash2 } from "lucide-react";
import { AdminDrawer, Field, FormPanel, Metric, SectionTitle } from "../../components/ui";
import { usePaginatedControlHistory } from "../../hooks/usePaginatedControlHistory";
import { createAuditLog } from "../../utils/audit";
import { buildSchoolYearDataIndexes, sumPaymentsForStudentFee } from "../../utils/dataIndexes";
import { generateReceiptNumber, resolveExpenseCashierName, resolvePaymentCashierName } from "../../utils/finance";
import { escapePdfHtml, generateReceiptPdf, money, pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { PdfTableColumn } from "../../utils/pdf";
import { getStudentBalance } from "../../utils/stats";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { feeAppliesToStudent } from "../../utils/feeTargets";
import { formatStudentClassName } from "../../utils/studentClasses";
import { compareStudentsForPdfByClass, formatStudentPdfClassName } from "../../utils/studentPdf";
import type { AppData, AppNotification, AppUser, AuditLog, Expense, FeeType, ParentProfile, Payment, School, SchoolYear, Student } from "../../types";

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
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Fournitures");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseBeneficiary, setExpenseBeneficiary] = useState("");
  const [expensePaymentMethod, setExpensePaymentMethod] = useState("");
  const [expenseReference, setExpenseReference] = useState("");
  const [expenseError, setExpenseError] = useState("");
  const [amountComparator, setAmountComparator] = useState("all");
  const [amountThreshold, setAmountThreshold] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expenseHistoryOpen, setExpenseHistoryOpen] = useState(false);
  const [expenseEditTarget, setExpenseEditTarget] = useState<Expense | null>(null);
  const [expenseEditAmount, setExpenseEditAmount] = useState("");
  const [expenseEditCategory, setExpenseEditCategory] = useState("Fournitures");
  const [expenseEditDescription, setExpenseEditDescription] = useState("");
  const [expenseEditError, setExpenseEditError] = useState("");
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState<Expense | null>(null);
  const [warningOpen, setWarningOpen] = useState(false);
  const [cashierControlDrawer, setCashierControlDrawer] = useState<"payment" | "expense" | "history" | "warning" | null>(null);
  const [cashierControlFeedback, setCashierControlFeedback] = useState("");
  const [cashierControlFeedbackDrawer, setCashierControlFeedbackDrawer] = useState<"payment" | "expense" | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [selectedHistoryStudentId, setSelectedHistoryStudentId] = useState("");
  const controlIndexes = useMemo(() => buildSchoolYearDataIndexes(yearData.students, yearData.feeTypes, yearData.payments), [yearData.students, yearData.feeTypes, yearData.payments]);
  const paymentHistory = usePaginatedControlHistory<Payment>({
    kind: "payments",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: historyOpen || cashierControlDrawer === "history",
  });
  const expenseHistory = usePaginatedControlHistory<Expense>({
    kind: "expenses",
    schoolId: school.id,
    schoolYearId: year.id,
    enabled: expenseHistoryOpen,
  });
  const feeNameChoices = Array.from(new Set(yearData.feeTypes.map((fee) => fee.name)));
  const amountFeeGroups = Array.from(
    yearData.feeTypes.reduce<Map<string, { key: string; name: string; ids: string[] }>>((items, fee) => {
      const name = fee.name.trim();
      const key = name.toLowerCase();
      if (!key) return items;
      const existing = items.get(key);
      items.set(key, existing ? { ...existing, ids: [...existing.ids, fee.id] } : { key, name, ids: [fee.id] });
      return items;
    }, new Map()).values(),
  );
  const amountFeeOptions = amountFeeGroups.flatMap((fee) => [
    { value: `fee:${fee.key}:gte`, label: `${fee.name} >=` },
    { value: `fee:${fee.key}:lt`, label: `${fee.name} <` },
  ]);
  const [warningFeeName, setWarningFeeName] = useState(feeNameChoices[0] ?? "");
  const [warningRequiredAmount, setWarningRequiredAmount] = useState("");
  const [warningDeadline, setWarningDeadline] = useState("");
  const [warningFeedback, setWarningFeedback] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  useEffect(() => {
    if (!warningFeeName && feeNameChoices[0]) setWarningFeeName(feeNameChoices[0]);
  }, [feeNameChoices, warningFeeName]);
  useEffect(() => {
    const match = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    if (match && !amountFeeGroups.some((fee) => fee.key === match[1])) {
      setAmountComparator("all");
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
  const selectedPaymentStudent = controlIndexes.studentsById.get(studentId);
  const selectedPaymentBalance = selectedPaymentStudent
    ? getStudentBalance(selectedPaymentStudent.id, yearData.feeTypes, yearData.payments, yearData.students)
    : { expected: 0, paid: 0, remaining: 0 };
  const payableFeeTypes = selectedPaymentStudent ? controlIndexes.applicableFeeTypesByStudentId.get(selectedPaymentStudent.id) ?? [] : [];
  const selectedFeeTypeValue = payableFeeTypes.some((fee) => fee.id === feeTypeId) ? feeTypeId : payableFeeTypes[0]?.id ?? "";
  const selectedPaymentFee = payableFeeTypes.find((fee) => fee.id === selectedFeeTypeValue);
  const selectedPaymentFeePaid = selectedPaymentStudent && selectedPaymentFee
    ? sumPaymentsForStudentFee(controlIndexes, selectedPaymentStudent.id, selectedPaymentFee.id)
    : 0;
  const selectedPaymentFeeRemaining = selectedPaymentFee ? Math.max(selectedPaymentFee.amount - selectedPaymentFeePaid, 0) : 0;
  const isPaymentEntryDisabled = !selectedPaymentFee || selectedPaymentFeeRemaining <= 0;
  const selectedHistoryStudent = controlIndexes.studentsById.get(selectedHistoryStudentId);
  const paymentStudentSearch = paymentStudentQuery.trim().toLowerCase();
  const paymentStudentResults = paymentStudentSearch
    ? yearData.students.filter((student) => `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule}`.toLowerCase().includes(paymentStudentSearch)).slice(0, 8)
    : [];

  const rows = yearData.students
    .map((student) => {
      const feeSummaries = getStudentFeeSummaries(student, yearData.feeTypes, yearData.payments, controlIndexes);
      const balance = feeSummaries.reduce(
        (totals, summary) => ({
          expected: totals.expected + summary.expected,
          paid: totals.paid + summary.paid,
          remaining: totals.remaining + summary.remaining,
        }),
        { expected: 0, paid: 0, remaining: 0 },
      );
      const progress = balance.expected > 0 ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
      return { student, balance, progress, hasApplicableFees: feeSummaries.length > 0 };
    })
    .filter((row) => {
      if (amountComparator === "all" || !amountThreshold) return true;
      const feeFilter = amountComparator.match(/^fee:(.+):(gte|lt)$/);
      const feeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
      const paidAmount = feeFilter
        ? (feeGroup?.ids ?? []).reduce((sum, feeId) => sum + sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId), 0)
        : row.balance.paid;
      const isGreaterOrEqual = feeFilter ? feeFilter[2] === "gte" : amountComparator === ">=";
      return isGreaterOrEqual ? paidAmount >= Number(amountThreshold) : paidAmount < Number(amountThreshold);
    });
  const historyPayments = paymentHistory.items
    .map((payment) => {
      const student = controlIndexes.studentsById.get(payment.studentId);
      const fee = controlIndexes.feeTypesById.get(payment.feeTypeId);
      return student && fee ? { payment, student, fee } : null;
    })
    .filter((item): item is { payment: Payment; student: Student; fee: FeeType } => Boolean(item));
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
      expected: totals.expected + summary.expected,
      paid: totals.paid + summary.paid,
      remaining: totals.remaining + summary.remaining,
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
    selectedHistoryRunningPaid += payment.amount;
    return {
      payment,
      feeName: fee?.name ?? "Frais",
      remaining: Math.max(selectedHistoryBalance.expected - selectedHistoryRunningPaid, 0),
    };
  });
  const sortedExpenses = [...expenseHistory.items].sort((first, second) => historyTimestamp(second.createdAt, second.spentAt) - historyTimestamp(first.createdAt, first.spentAt));
  const isOtherExpenseEditCategory = expenseEditCategory === "Autre" || expenseEditCategory === "Autres";
  const cashierDrawerTitle =
    cashierControlDrawer === "payment"
      ? "Enregistrer un paiement"
      : cashierControlDrawer === "expense"
        ? "Enregistrer une dépense"
        : cashierControlDrawer === "warning"
          ? "Avertissement"
          : "Historique des paiements";

  function studentFullName(student: Student) {
    return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
  }

  function formatMoney(value: number) {
    return `$${value.toFixed(2)}`;
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

  function selectPaymentStudent(student: Student) {
    setStudentId(student.id);
    setPaymentStudentQuery(`${student.nom} ${student.postnom} ${student.prenom} | ${student.matricule}`.replace(/\s+/g, " ").trim());
  }

  function updatePaymentStudentQuery(value: string) {
    setPaymentStudentQuery(value);
    setStudentId("");
  }

  function savePayment() {
    setCashierControlFeedback("");
    setCashierControlFeedbackDrawer(null);
    if (isArchivedContext) {
      setPaymentError("Cette année scolaire est archivée en lecture seule.");
      return;
    }
    if (!studentId || !selectedFeeTypeValue) return;
    setPaymentError("");
    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setPaymentError("Montant de paiement invalide.");
      return;
    }
    if (!selectedPaymentStudent || !selectedPaymentFee) {
      setPaymentError("Type de frais indisponible pour cet élève.");
      return;
    }
    const alreadyPaidForFee = yearData.payments
      .filter(
        (payment) =>
          payment.schoolId === school.id &&
          payment.schoolYearId === year.id &&
          payment.studentId === selectedPaymentStudent.id &&
          payment.feeTypeId === selectedPaymentFee.id,
      )
      .reduce((sum, payment) => sum + payment.amount, 0);
    const totalPaidAfterPayment = alreadyPaidForFee + paymentAmount;
    const remainingAfterPayment = Math.max(selectedPaymentFee.amount - totalPaidAfterPayment, 0);
    const isFeePaidOff = remainingAfterPayment === 0;
    if (totalPaidAfterPayment > selectedPaymentFee.amount) {
      setPaymentError("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const student = data.students.find((item) => item.id === studentId);
    const payment: Payment = {
      id: createId("pay"),
      schoolId: school.id,
      schoolYearId: year.id,
      studentId,
      parentId: student?.parentId,
      feeTypeId: selectedFeeTypeValue,
      amount: paymentAmount,
      paidAt: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      receiptNumber: generateReceiptNumber(data.payments, year.name),
      cashierName: user.name,
    };
    const notification: AppNotification | undefined = student?.parentId
      ? {
          id: createId("notif"),
          schoolId: school.id,
          schoolYearId: year.id,
          parentId: student.parentId,
          studentId,
          type: "payment",
          title: "Paiement enregistré",
          body: [
            `Élève : ${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim(),
            `Type de frais : ${selectedPaymentFee.name}`,
            `Montant payé : ${money(paymentAmount)}`,
            ...(isFeePaidOff ? ["Statut : Soldé"] : []),
            `Reste à payer : ${money(remainingAfterPayment)}`,
          ].join("\n"),
          createdAt: new Date().toISOString(),
          read: false,
        }
      : undefined;
    updateData({
      payments: [...data.payments, payment],
      notifications: notification ? [notification, ...data.notifications] : data.notifications,
      auditLogs: [createAuditLog(user, school.id, year.id, "Création paiement", `${payment.receiptNumber} - $${payment.amount}`, createId), ...data.auditLogs],
    });
    paymentHistory.prependItem(payment);
    setAmount("");
    if (user.role === "cashier") {
      setCashierControlFeedback("Paiement enregistré avec succès.");
      setCashierControlFeedbackDrawer("payment");
    }
  }

  function saveExpense() {
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
    if (!expenseAmount.trim() || !Number.isFinite(nextAmount) || nextAmount <= 0) {
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
    const expense: Expense = {
      id: createId("expense"),
      schoolId: school.id,
      schoolYearId: year.id,
      amount: nextAmount,
      category: trimmedCategory,
      description: trimmedDescription,
      beneficiary: trimmedBeneficiary,
      paymentMethod: trimmedPaymentMethod,
      reference: trimmedReference,
      spentAt: new Date().toISOString().slice(0, 10),
      createdAt: new Date().toISOString(),
      cashierName: user.name,
    };
    updateData({
      expenses: [expense, ...data.expenses],
      auditLogs: [createAuditLog(user, school.id, year.id, "Création dépense", `${expense.category} - $${expense.amount}`, createId), ...data.auditLogs],
    });
    expenseHistory.prependItem(expense);
    setExpenseAmount("");
    setExpenseDescription("");
    setExpenseBeneficiary("");
    setExpensePaymentMethod("");
    setExpenseReference("");
    if (user.role === "cashier") {
      setCashierControlFeedback("Dépense enregistrée avec succès.");
      setCashierControlFeedbackDrawer("expense");
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

  function updateExpense() {
    if (!expenseEditTarget || !canManageExpenses) return;
    setExpenseEditError("");
    const nextAmount = Number(expenseEditAmount);
    if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
      setExpenseEditError("Montant de dépense invalide.");
      return;
    }
    if (isOtherExpenseEditCategory && !expenseEditDescription.trim()) {
      setExpenseEditError("Veuillez préciser la nature de cette dépense.");
      return;
    }
    const nextDescription = expenseEditDescription.trim() || expenseEditCategory;
    const updatedExpense: Expense = { ...expenseEditTarget, amount: nextAmount, category: expenseEditCategory, description: nextDescription };
    updateData({
      expenses: data.expenses.map((item) =>
        item.id === expenseEditTarget.id
          ? updatedExpense
          : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Modification dépense", `${expenseEditTarget.category} - ${formatMoney(expenseEditTarget.amount)} → ${expenseEditCategory} - ${formatMoney(nextAmount)}`, createId),
        ...data.auditLogs,
      ],
    });
    expenseHistory.updateItem(updatedExpense);
    closeEditExpense();
  }

  function deleteExpense(expense: Expense) {
    if (!canManageExpenses) return;
    updateData({
      expenses: data.expenses.filter((item) => item.id !== expense.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression dépense", `${expense.category} - ${formatMoney(expense.amount)}`, createId), ...data.auditLogs],
    });
    expenseHistory.removeItem(expense.id);
    setExpenseDeleteTarget(null);
  }

  async function generateExpensePdf(expense: Expense) {
    const beneficiary = getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]);
    const paymentMethod = getExpenseField(expense, ["paymentMethod", "modePaiement", "paymentMode", "mode"]);
    const reference = getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"]);
    await renderAcadPdfPreview({
      filename: `depense-${expense.spentAt}-${expense.id}.pdf`,
      title: "Justificatif de dépense",
      school,
      year,
      sections: [
        pdfSection(
          "Dépense",
          pdfInfoGrid([
            { label: "Date", value: formatExpenseDateTime(expense) },
            { label: "Libellé / motif", value: expense.description || expense.category },
            { label: "Catégorie", value: expense.category },
            { label: "Montant", value: formatMoney(expense.amount) },
            { label: "Bénéficiaire / fournisseur", value: beneficiary || "-" },
            { label: "Caissier", value: resolveExpenseCashierName(expense, yearData.auditLogs) },
            { label: "Mode de paiement", value: paymentMethod || "-" },
            { label: "Référence / pièce", value: reference || "-" },
          ]),
        ),
      ],
    });
  }

  function sendPaymentWarnings() {
    setWarningFeedback(null);
    if (isArchivedContext) {
      setWarningFeedback({ type: "error", message: "Cette année scolaire est archivée en lecture seule." });
      return;
    }
    const requiredAmount = Number(warningRequiredAmount);
    if (!warningFeeName || !Number.isFinite(requiredAmount) || requiredAmount <= 0 || !warningDeadline) {
      setWarningFeedback({ type: "error", message: "Veuillez renseigner le type de frais, le montant requis et la date limite." });
      return;
    }

    const matchingFees = yearData.feeTypes.filter((fee) => fee.name === warningFeeName);
    const matchingFeeIds = new Set(matchingFees.map((fee) => fee.id));
    const warningFeeLabels = Array.from(new Set(matchingFees.map((fee) => String(fee.name).trim()).filter(Boolean)));
    const warningFeeSummary = warningFeeLabels.length ? warningFeeLabels.join(", ") : warningFeeName;
    const parentById = new Map(yearData.parents.map((parent) => [parent.id, parent]));
    const now = new Date().toISOString();
    const sentAtLabel = new Date(now).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const affectedStudents = yearData.students.filter((student) => {
      const paid = yearData.payments
        .filter((payment) => payment.studentId === student.id && matchingFeeIds.has(payment.feeTypeId))
        .reduce((sum, payment) => sum + payment.amount, 0);
      return paid < requiredAmount;
    });
    const warnings = affectedStudents
      .map((student) => {
        const parent = student.parentId ? parentById.get(student.parentId) : undefined;
        if (!parent) return null;
        const studentName = studentFullName(student);
        const body = [
          "Cher Parent,",
          "",
          `Nous vous informons que le paiement de ${warningFeeSummary} relatif à votre enfant ${studentName} n'a pas encore atteint le montant requis par l'établissement.`,
          "",
          `Détails Type de frais : ${warningFeeSummary}.`,
          `Montant requis : $${requiredAmount.toFixed(2)}`,
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
            studentId: student.id,
            type: "payment" as const,
            title: "Avertissement de paiement",
            body,
            createdAt: now,
            read: false,
          },
        };
      })
      .filter(Boolean) as { parent: ParentProfile; notification: AppNotification }[];

    if (warnings.length === 0) {
      setWarningFeedback({ type: "info", message: "Aucun parent ne correspond aux critères sélectionnés." });
      return;
    }

    const campaignId = createId("warn");
    const notifiedParents = new Set(warnings.map((item) => item.parent.id));
    const status = warnings.length === affectedStudents.length ? "Succès" : "Partiel";
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
    if (!canCorrectPayments) return;
    const nextAmount = prompt("Nouveau montant du paiement", String(payment.amount));
    if (!nextAmount) return;
    const correctedAmount = Number(nextAmount);
    if (!Number.isFinite(correctedAmount) || correctedAmount <= 0) {
      alert("Montant de paiement invalide.");
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
      ? Math.max(0, sumPaymentsForStudentFee(controlIndexes, paymentStudent.id, paymentFee.id) - payment.amount)
      : 0;
    if (!paymentFee || paidForFee + correctedAmount > paymentFee.amount) {
      alert("Paiement impossible : ce montant dépasse le montant prévu pour ce frais.");
      return;
    }
    const reason = prompt("Motif obligatoire de correction");
    if (!reason) return;
    const correctedPayment: Payment = { ...payment, amount: correctedAmount, updatedAt: new Date().toISOString(), correctionReason: reason };
    updateData({
      payments: data.payments.map((item) =>
        item.id === payment.id ? correctedPayment : item,
      ),
      auditLogs: [
        createAuditLog(user, school.id, year.id, "Correction paiement", `${payment.receiptNumber ?? payment.id}: ancien $${payment.amount}, nouveau $${correctedAmount}. Motif: ${reason}`, createId),
        ...data.auditLogs,
      ],
    });
    paymentHistory.updateItem(correctedPayment);
  }

  function deletePayment(payment: Payment) {
    if (!canCorrectPayments) return;
    const reason = prompt("Motif obligatoire de suppression du paiement");
    if (!reason) return;
    updateData({
      payments: data.payments.filter((item) => item.id !== payment.id),
      auditLogs: [createAuditLog(user, school.id, year.id, "Suppression paiement", `${payment.receiptNumber ?? payment.id}: $${payment.amount}. Motif: ${reason}`, createId), ...data.auditLogs],
    });
    paymentHistory.removeItem(payment.id);
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
          Type de frais
          <select value={warningFeeName} onChange={(event) => setWarningFeeName(event.target.value)} className="input">
            {feeNameChoices.map((feeName) => (
              <option key={feeName} value={feeName}>{feeName}</option>
            ))}
          </select>
        </label>
        <Field label="Montant requis" value={warningRequiredAmount} onChange={setWarningRequiredAmount} type="number" />
        <Field label="Date limite de régularisation" value={warningDeadline} onChange={setWarningDeadline} type="date" />
        <button onClick={sendPaymentWarnings} disabled={!feeNameChoices.length} className="primary-button justify-center disabled:opacity-50" type="button">
          <Bell className="h-4 w-4" /> Envoyer
        </button>
        {!feeNameChoices.length && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun type de frais n'est encore défini.</p>}
      </div>
    );
  }

  async function printFilteredStudents() {
    const feeFilter = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    const selectedPdfFeeGroup = feeFilter ? amountFeeGroups.find((fee) => fee.key === feeFilter[1]) : undefined;
    const filterLabel =
      amountComparator === "all" || !amountThreshold
        ? "Montant payé : tous"
        : selectedPdfFeeGroup && feeFilter
          ? `${selectedPdfFeeGroup.name} ${feeFilter[2] === "gte" ? ">=" : "<"} ${amountThreshold}`
          : `Montant payé ${amountComparator} ${amountThreshold}`;
    const pdfBalanceForRow = (row: (typeof rows)[number]) => {
      if (!selectedPdfFeeGroup) return row.balance;
      const expected = yearData.feeTypes
        .filter((fee) => selectedPdfFeeGroup.ids.includes(fee.id) && feeAppliesToStudent(fee, row.student))
        .reduce((sum, fee) => sum + fee.amount, 0);
      const paid = selectedPdfFeeGroup.ids.reduce((sum, feeId) => sum + sumPaymentsForStudentFee(controlIndexes, row.student.id, feeId), 0);
      return { expected, paid, remaining: Math.max(expected - paid, 0) };
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
      ],
    });
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
        {sortedExpenses.length === 0 && !expenseHistory.isInitialLoading && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucune dépense enregistrée.</p>}
        {sortedExpenses.map((expense) => {
          const beneficiary = getExpenseField(expense, ["beneficiary", "beneficiaire", "supplier", "fournisseur", "providerName", "payee"]);
          const paymentMethod = getExpenseField(expense, ["paymentMethod", "modePaiement", "paymentMode", "mode"]);
          const reference = getExpenseField(expense, ["reference", "referenceNumber", "pieceNumber", "voucherNumber", "receiptNumber"]);
          return (
            <div key={expense.id} className="rounded border border-slate-100 p-3 text-sm">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold text-ink">{expense.description || expense.category}</p>
                  <p className="break-words text-slate-500">{formatExpenseDateTime(expense)} | {expense.category} | {formatMoney(expense.amount)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button onClick={() => generateExpensePdf(expense)} className="rounded bg-slate-100 p-2" title="Télécharger le justificatif PDF" type="button">
                    <Download className="h-4 w-4" />
                  </button>
                  {user.role !== "cashier" && canManageExpenses && <button onClick={() => openEditExpense(expense)} className="rounded bg-slate-100 p-2" title="Modifier" type="button">
                    <Edit3 className="h-4 w-4" />
                  </button>}
                  {user.role !== "cashier" && canManageExpenses && <button onClick={() => setExpenseDeleteTarget(expense)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer" type="button">
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
              <p className="text-sm font-semibold uppercase text-mint">Historique individuel</p>
              <h1 className="break-words text-2xl font-bold text-ink">{studentFullName(selectedHistoryStudent)}</h1>
              <p className="break-words text-sm text-slate-500">
                {selectedHistoryStudent.matricule} | {formatStudentClassName(selectedHistoryStudent)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-center gap-2 sm:justify-start">
            <button onClick={() => createStudentHistoryPdf("print")} className="primary-button justify-center" type="button">
              <Download className="h-4 w-4" /> Imprimer PDF
            </button>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <Metric label="Total attendu" value={formatMoney(selectedHistoryFeeTotals.expected)} />
          <Metric label="Total payé" value={formatMoney(selectedHistoryFeeTotals.paid)} />
          <Metric label="Total restant" value={formatMoney(selectedHistoryFeeTotals.remaining)} />
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
        <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en dollar américain." />
        {user.role === "cashier" ? (
          <div className={`mb-3 grid min-w-0 max-w-full gap-2 lg:w-full lg:gap-2 ${canPay ? "lg:grid-cols-[minmax(105px,0.8fr)_minmax(70px,0.6fr)_repeat(5,minmax(0,1fr))]" : "lg:grid-cols-[minmax(120px,1fr)_minmax(90px,0.8fr)_repeat(3,minmax(0,1fr))]"}`}>
            <div className="flex min-w-0 flex-nowrap items-stretch gap-1.5 lg:contents">
              <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)} className="h-10 min-w-0 flex-[1.1] rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full">
                <option value="all">Montant payé</option>
                {amountFeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="h-10 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full" placeholder="Filtre" />
              <button onClick={printFilteredStudents} className="primary-button h-10 min-w-0 flex-1 justify-center px-2 text-xs sm:text-sm lg:w-full">
                <Download className="h-4 w-4" /> Imprimer
              </button>
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:contents">
              <button onClick={() => setCashierControlDrawer("history")} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique des paiements
              </button>
              <button onClick={() => setExpenseHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique de dépenses
              </button>
              {canPay && (
                <>
                  <button onClick={() => { setCashierControlFeedback(""); setCashierControlFeedbackDrawer(null); setCashierControlDrawer("payment"); }} className="primary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                    Enregistrer un paiement
                  </button>
                  <button onClick={() => { setCashierControlFeedback(""); setCashierControlFeedbackDrawer(null); setCashierControlDrawer("expense"); }} className="primary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                    Enregistrer une dépense
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mb-3 grid min-w-0 max-w-full gap-2 lg:w-full lg:grid-cols-[minmax(120px,1fr)_minmax(90px,0.8fr)_repeat(4,minmax(0,1fr))] lg:gap-2">
            <div className="flex min-w-0 flex-nowrap items-stretch gap-1.5 lg:contents">
              <select value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)} className="h-10 min-w-0 flex-[1.1] rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full">
                <option value="all">Montant payé</option>
                {amountFeeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)} type="number" className="h-10 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs sm:text-sm lg:w-full" placeholder="Filtre" />
              <button onClick={printFilteredStudents} className="primary-button h-10 min-w-0 flex-1 justify-center px-2 text-xs sm:text-sm lg:w-full">
                <Download className="h-4 w-4" /> Imprimer
              </button>
            </div>
            <div className="grid min-w-0 gap-2 lg:contents">
              <button onClick={() => setHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique des paiements
              </button>
              <button onClick={() => setExpenseHistoryOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Historique de dépenses
              </button>
              <button onClick={() => setWarningOpen(true)} className="secondary-button h-10 min-w-0 w-full justify-center px-2 text-sm lg:px-1 lg:text-[11px] lg:whitespace-nowrap xl:px-2 xl:text-xs" type="button">
                Avertissement
              </button>
            </div>
          </div>
        )}
        <div className="grid min-w-0 gap-3">
          {rows.map(({ student, balance, progress, hasApplicableFees }) => (
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
              <Metric label="Attendu" value={`$${selectedPaymentBalance.expected}`} />
              <Metric label="Payé" value={`$${selectedPaymentBalance.paid}`} />
              <Metric label="Solde" value={`$${selectedPaymentBalance.remaining}`} />
            </div>
            {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
            <select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60">
              {payableFeeTypes.map((fee) => (
                <option key={fee.id} value={fee.id}>{fee.name} - ${fee.amount}</option>
              ))}
            </select>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" placeholder="Montant" />
            <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button justify-center disabled:opacity-50"><Plus className="h-4 w-4" /> Enregistrer</button>
          </FormPanel>
        )}
        {canPay && (
          <FormPanel title="Enregistrer une dépense">
            <select value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)} className="input">
              <option>Fournitures</option>
              <option>Transport</option>
              <option>Salaire</option>
              <option>Maintenance</option>
              <option>Autres</option>
            </select>
            <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
            <textarea value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} className="input min-h-24" placeholder="Description" />
            <button onClick={saveExpense} className="primary-button justify-center"><Plus className="h-4 w-4" /> Enregistrer</button>
          </FormPanel>
        )}
      </div>
      )}
      {user.role === "cashier" && cashierControlDrawer && (
        <AdminDrawer title={cashierDrawerTitle} onClose={() => setCashierControlDrawer(null)} closeLabel={`Fermer ${cashierDrawerTitle}`}>
          {cashierControlFeedback && cashierControlFeedbackDrawer === cashierControlDrawer && (
            <p className="rounded border border-mint/30 bg-mint/10 p-3 text-sm font-semibold text-mint">{cashierControlFeedback}</p>
          )}
          {cashierControlDrawer === "payment" && (
            <>
              <div className="grid min-w-0 gap-2">
                <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
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
                  <p className="rounded bg-mint/10 p-3 text-sm font-semibold text-mint">
                    Élève sélectionné : {selectedPaymentStudent.nom} {selectedPaymentStudent.postnom} {selectedPaymentStudent.prenom}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                <Metric label="Attendu" value={`$${selectedPaymentBalance.expected}`} />
                <Metric label="Payé" value={`$${selectedPaymentBalance.paid}`} />
                <Metric label="Solde" value={`$${selectedPaymentBalance.remaining}`} />
              </div>
              {paymentError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{paymentError}</p>}
              <select value={selectedFeeTypeValue} onChange={(event) => setFeeTypeId(event.target.value)} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60">
                {payableFeeTypes.map((fee) => (
                  <option key={fee.id} value={fee.id}>{fee.name} - ${fee.amount}</option>
                ))}
              </select>
              <input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" min="0" max={selectedPaymentFeeRemaining} disabled={isPaymentEntryDisabled} className="input disabled:opacity-60" placeholder="Montant" />
              <button onClick={savePayment} disabled={isPaymentEntryDisabled} className="primary-button justify-center disabled:opacity-50" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
            </>
          )}
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
                <option>Salaire</option>
                <option>Maintenance</option>
                <option>Autre</option>
              </select>
              <input value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} type="number" min="0" className="input" placeholder="Montant" />
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
              {expenseError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseError}</p>}
              <button onClick={saveExpense} className="primary-button justify-center" type="button"><Plus className="h-4 w-4" /> Enregistrer</button>
            </>
          )}
          {cashierControlDrawer === "history" && (
            <>
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
                          <button onClick={() => generateReceiptPdf(payment, student, fee, school, resolvePaymentCashierName(payment, yearData.auditLogs))} className="rounded bg-slate-100 p-2" title="Voir le reçu PDF" type="button">
                            <Download className="h-4 w-4" />
                          </button>
                          {canCorrectPayments && <button onClick={() => correctPayment(payment)} className="rounded bg-slate-100 p-2" title="Corriger" type="button"><Edit3 className="h-4 w-4" /></button>}
                          {canCorrectPayments && <button onClick={() => deletePayment(payment)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer" type="button"><Trash2 className="h-4 w-4" /></button>}
                        </div>
                      </div>
                      <p className="break-words text-slate-500">{fee.name} | ${payment.amount} | {payment.paidAt}</p>
                    </div>
                  );
                })}
              </div>
              {renderPaymentHistoryPagination()}
            </>
          )}
          {cashierControlDrawer === "warning" && renderPaymentWarningForm()}
        </AdminDrawer>
      )}
      {warningOpen && (
        <AdminDrawer title="Avertissement" onClose={() => setWarningOpen(false)} closeLabel="Fermer l'avertissement">
          {renderPaymentWarningForm()}
        </AdminDrawer>
      )}
      {historyOpen && (
        <AdminDrawer title="Historique des paiements" onClose={() => setHistoryOpen(false)} closeLabel="Fermer l'historique">
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
                        {canCorrectPayments && <button onClick={() => correctPayment(payment)} className="rounded bg-slate-100 p-2" title="Corriger"><Edit3 className="h-4 w-4" /></button>}
                        {canCorrectPayments && <button onClick={() => deletePayment(payment)} className="rounded bg-red-50 p-2 text-red-700" title="Supprimer"><Trash2 className="h-4 w-4" /></button>}
                      </div>
                    </div>
                    <p className="break-words text-slate-500">{fee.name} | ${payment.amount} | {payment.paidAt}</p>
                  </div>
                );
              })}
            </div>
            {renderPaymentHistoryPagination()}
        </AdminDrawer>
      )}
      {expenseHistoryOpen && (
        <AdminDrawer title="Historique de dépenses" onClose={() => setExpenseHistoryOpen(false)} closeLabel="Fermer l'historique des dépenses">
          {renderExpenseHistoryContent()}
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
              <option>Salaire</option>
              <option>Maintenance</option>
              <option>Autre</option>
            </select>
          </label>
          <Field label="Montant" value={expenseEditAmount} onChange={setExpenseEditAmount} type="number" />
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
          {expenseEditError && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{expenseEditError}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button onClick={closeEditExpense} className="secondary-button justify-center" type="button">Annuler</button>
            <button onClick={updateExpense} disabled={!canManageExpenses} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Enregistrer
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
            <button onClick={() => deleteExpense(expenseDeleteTarget)} disabled={!canManageExpenses} className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Supprimer
            </button>
          </div>
        </AdminDrawer>
      )}
    </section>
  );
}
