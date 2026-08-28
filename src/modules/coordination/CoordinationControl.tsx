import { useMemo, useState, type ReactNode } from "react";
import { Download, RotateCcw } from "lucide-react";
import { AdminDrawer, Metric, SectionTitle } from "../../components/ui";
import type { CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import type { AppUser, Coordination, Expense, Payment, School } from "../../types";
import { buildSchoolYearDataIndexes } from "../../utils/dataIndexes";
import { escapePdfHtml, generateExpensePdf, generateReceiptPdf, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { activityTimestamp } from "../../utils/activityHistory";
import { resolveExpenseCashierName, resolvePaymentCashierName } from "../../utils/finance";
import { MISSING_FINANCIAL_OPERATION_SCHOOL_ERROR, resolveFinancialOperationSchool } from "../../utils/financialOperationSchool";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { buildCoordinationClassChoices, coordinationStudentClassKey } from "../../utils/coordinationSupervision";
import { formatStudentClassName } from "../../utils/studentClasses";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";
import { CoordinationStudentRecord } from "./CoordinationStudentRecord";

type HistoryKind = "payments" | "expenses";

export function CoordinationControl({ user, coordination, schools, selectedSchoolId, model, loading, loadError }: { user: AppUser; coordination: Coordination; schools: School[]; selectedSchoolId: string; model: CoordinationDashboardReadModel; loading: boolean; loadError: string }) {
  const [classKey, setClassKey] = useState("");
  const [amountComparator, setAmountComparator] = useState("");
  const [amountThreshold, setAmountThreshold] = useState("");
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [documentError, setDocumentError] = useState("");
  const scopedStudents = useMemo(() => model.students.filter((student) => !selectedSchoolId || student.schoolId === selectedSchoolId), [model.students, selectedSchoolId]);
  const scopedFeeTypes = useMemo(() => model.feeTypes.filter((fee) => !selectedSchoolId || fee.schoolId === selectedSchoolId), [model.feeTypes, selectedSchoolId]);
  const scopedPayments = useMemo(() => model.payments.filter((payment) => !selectedSchoolId || payment.schoolId === selectedSchoolId), [model.payments, selectedSchoolId]);
  const scopedExpenses = useMemo(() => model.expenses.filter((expense) => !selectedSchoolId || expense.schoolId === selectedSchoolId), [model.expenses, selectedSchoolId]);
  const indexes = useMemo(() => buildSchoolYearDataIndexes(scopedStudents, scopedFeeTypes, scopedPayments), [scopedFeeTypes, scopedPayments, scopedStudents]);
  const schoolsById = useMemo(() => new Map(schools.map((school) => [school.id, school])), [schools]);
  const studentsById = useMemo(() => new Map(model.students.map((student) => [student.id, student])), [model.students]);
  const feeTypesById = useMemo(() => new Map(model.feeTypes.map((fee) => [fee.id, fee])), [model.feeTypes]);
  const classChoices = useMemo(() => buildCoordinationClassChoices(scopedStudents, schools, selectedSchoolId), [schools, scopedStudents, selectedSchoolId]);
  const feeChoices = useMemo(() => scopedFeeTypes.map((fee) => ({ value: fee.id, label: `${fee.name}${selectedSchoolId ? "" : ` — ${schools.find((school) => school.id === fee.schoolId)?.name ?? fee.schoolId}`}` })), [schools, scopedFeeTypes, selectedSchoolId]);
  const rows = useMemo(() => scopedStudents.map((student) => {
    const feeSummaries = getStudentFeeSummaries(student, scopedFeeTypes, scopedPayments, indexes);
    const balance = feeSummaries.reduce((total, item) => ({ expected: total.expected + item.expected, paid: total.paid + item.paid, remaining: total.remaining + item.remaining }), { expected: 0, paid: 0, remaining: 0 });
    const progress = balance.expected ? Math.min(100, Math.round((balance.paid / balance.expected) * 100)) : 0;
    return { student, feeSummaries, balance, progress };
  }).filter((row) => {
    if (classKey && coordinationStudentClassKey(row.student) !== classKey) return false;
    if (!amountComparator || !amountThreshold) return true;
    const threshold = Number(amountThreshold);
    if (!Number.isFinite(threshold)) return true;
    if (amountComparator === "all-fees-gte") return row.feeSummaries.length > 0 && row.feeSummaries.every((summary) => summary.paid >= threshold);
    if (amountComparator === "all-fees-lt") return row.feeSummaries.some((summary) => summary.paid < threshold);
    const match = amountComparator.match(/^fee:(.+):(gte|lt)$/);
    if (!match) return true;
    const summary = row.feeSummaries.find((item) => item.feeTypeId === match[1]);
    return Boolean(summary && (match[2] === "gte" ? summary.paid >= threshold : summary.paid < threshold));
  }), [amountComparator, amountThreshold, classKey, indexes, scopedFeeTypes, scopedPayments, scopedStudents]);
  const selectedStudent = model.students.find((student) => student.id === selectedStudentId);
  const schoolName = (schoolId: string) => schools.find((school) => school.id === schoolId)?.name ?? schoolId;
  const historyPayments = useMemo(() => [...scopedPayments].sort((first, second) => activityTimestamp(second.createdAt ?? second.paidAt) - activityTimestamp(first.createdAt ?? first.paidAt)), [scopedPayments]);
  const historyExpenses = useMemo(() => [...scopedExpenses].sort((first, second) => activityTimestamp(second.createdAt ?? second.spentAt) - activityTimestamp(first.createdAt ?? first.spentAt)), [scopedExpenses]);

  async function exportPdf() {
    const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
    if (!contextSchool) return;
    await renderAcadPdfPreview({ filename: `controle-coordination-${selectedSchoolId || "toutes"}.pdf`, title: "Contrôle", school: coordinationPdfInstitution(coordination, contextSchool), subtitle: `École : ${selectedSchoolId ? contextSchool.name : "Toutes les écoles"} | Classe : ${classChoices.find((item) => item.value === classKey)?.label ?? "Toutes"} | Montant : ${amountComparator || "Tous"} ${amountThreshold}`.trim(), sections: [pdfSection("Suivi des paiements", pdfTable([
      { header: "Élève", render: (row) => escapePdfHtml(`${row.student.nom} ${row.student.prenom}`) },
      { header: "École", render: (row) => escapePdfHtml(schoolName(row.student.schoolId)) },
      { header: "Classe", render: (row) => escapePdfHtml(formatStudentClassName(row.student)) },
      { header: "Prévu", render: (row) => row.balance.expected.toFixed(2), align: "right" },
      { header: "Payé", render: (row) => row.balance.paid.toFixed(2), align: "right" },
      { header: "Solde", render: (row) => row.balance.remaining.toFixed(2), align: "right" },
    ], rows, "Aucun élève ne correspond aux filtres."))] });
  }

  function operationSchool(operation: { schoolId: string }) {
    const school = resolveFinancialOperationSchool(operation, schoolsById);
    if (!school) setDocumentError(MISSING_FINANCIAL_OPERATION_SCHOOL_ERROR);
    return school;
  }

  async function downloadPaymentReceipt(payment: Payment) {
    const school = operationSchool(payment);
    if (!school) return;
    const student = studentsById.get(payment.studentId);
    const feeType = feeTypesById.get(payment.feeTypeId);
    if (!student || !feeType) {
      setDocumentError("Impossible de générer le document : les données liées à ce paiement sont introuvables.");
      return;
    }
    setDocumentError("");
    await generateReceiptPdf(payment, student, feeType, school, resolvePaymentCashierName(payment, []));
  }

  async function downloadExpenseProof(expense: Expense) {
    const school = operationSchool(expense);
    if (!school) return;
    const year = model.schoolYears.find((item) => item.id === expense.schoolYearId && item.schoolId === expense.schoolId);
    setDocumentError("");
    await generateExpensePdf(expense, school, year, resolveExpenseCashierName(expense, []));
  }

  if (selectedStudent) return <CoordinationStudentRecord student={selectedStudent} user={user} schools={schools} model={model} onBack={() => setSelectedStudentId("")}/>;

  return <section className="grid min-w-0 gap-4">
    <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en lecture seule."/>
    <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto_auto]">
      <select aria-label="Classe" className="input min-w-0 w-full" value={classKey} onChange={(event) => setClassKey(event.target.value)}><option value="">Toutes</option>{classChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <select aria-label="Montant payé" className="input min-w-0 w-full" value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)}><option value="">Montant payé</option><option value="all-fees-gte">Tous les frais ≥</option><option value="all-fees-lt">Tous les frais &lt;</option>{feeChoices.flatMap((fee) => [<option key={`${fee.value}-gte`} value={`fee:${fee.value}:gte`}>{fee.label} ≥</option>, <option key={`${fee.value}-lt`} value={`fee:${fee.value}:lt`}>{fee.label} &lt;</option>])}</select>
      <input aria-label="Filtre" className="input min-w-0 w-full" type="number" placeholder="Filtre" value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)}/>
      <button type="button" className="pdf-export-button min-w-0 w-full xl:w-auto" onClick={() => void exportPdf()}><Download className="h-4 w-4"/> Exporter PDF</button>
      <button type="button" className="secondary-button min-w-0 w-full justify-center xl:w-auto" onClick={() => { setClassKey(""); setAmountComparator(""); setAmountThreshold(""); }}><RotateCcw className="h-4 w-4"/> Réinitialiser</button>
      <button type="button" className="secondary-button min-w-0 w-full justify-center xl:w-auto" onClick={() => setHistoryKind("payments")}>Historique</button>
    </div>
    {loading && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-700">Chargement du contrôle…</p>}
    {loadError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
    {!historyKind && documentError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{documentError}</p>}
    {!loading && <div className="grid min-w-0 gap-3">{rows.map(({ student, balance, progress, feeSummaries }) => <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between"><div className="min-w-0"><button type="button" className="break-words text-left font-bold text-ink hover:text-blue-700 hover:underline" onClick={() => setSelectedStudentId(student.id)}>{student.nom} {student.prenom}</button><p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)} | {schoolName(student.schoolId)}</p></div><span className={`w-fit shrink-0 rounded px-2 py-1 text-xs font-semibold ${balance.expected > 0 && balance.remaining === 0 ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>{balance.expected > 0 && balance.remaining === 0 ? "En ordre" : "Non en ordre"}</span></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"><Metric label="Prévu" value={balance.expected.toFixed(2)}/><Metric label="Payé" value={balance.paid.toFixed(2)}/><Metric label="Solde" value={balance.remaining.toFixed(2)}/></div><div className="mt-4 h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-700" style={{ width: `${progress}%` }}/></div>{feeSummaries.length === 0 && <p className="mt-2 text-xs text-slate-500">Aucun frais défini pour cette classe.</p>}</article>)}{rows.length === 0 && <p className="rounded bg-white p-5 text-sm text-slate-500">Aucune donnée de contrôle dans le périmètre sélectionné.</p>}</div>}
    {historyKind && <AdminDrawer width="wide" title="Historique du contrôle" closeLabel="Fermer l’historique" toolbar={<div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className={historyKind === "payments" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("payments")}>Paiements</button><button type="button" className={historyKind === "expenses" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("expenses")}>Dépenses</button></div>} onClose={() => { setHistoryKind(null); setDocumentError(""); }}>{documentError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{documentError}</p>}{historyKind === "payments" ? <ReadOnlyTable headers={["Élève", "École", "Montant", "Date", "PDF"]} rows={historyPayments.map((payment) => { const student = studentsById.get(payment.studentId); return [student ? `${student.nom} ${student.prenom}` : payment.studentId, schoolName(payment.schoolId), payment.amount.toFixed(2), payment.paidAt, <button type="button" className="rounded bg-slate-100 p-2 text-slate-700" title="Voir le reçu PDF" aria-label={`Voir le reçu PDF du paiement ${payment.receiptNumber ?? payment.id}`} onClick={() => void downloadPaymentReceipt(payment)}><Download className="h-4 w-4"/></button>]; })}/> : <ReadOnlyTable headers={["École", "Catégorie", "Description", "Montant", "Date", "PDF"]} rows={historyExpenses.map((expense) => [schoolName(expense.schoolId), expense.category, expense.description, expense.amount.toFixed(2), expense.spentAt, <button type="button" className="rounded bg-slate-100 p-2 text-slate-700" title="Voir le justificatif PDF" aria-label={`Voir le justificatif PDF de la dépense ${expense.reference ?? expense.id}`} onClick={() => void downloadExpenseProof(expense)}><Download className="h-4 w-4"/></button>])}/>}</AdminDrawer>}
  </section>;
}

function ReadOnlyTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="p-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b">{row.map((cell, cellIndex) => <td key={cellIndex} className="break-words p-2">{cell}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune donnée.</p>}</div>;
}
