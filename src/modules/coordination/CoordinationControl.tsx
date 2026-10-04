import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, RotateCcw } from "lucide-react";
import { AdminDrawer, Metric, SectionTitle } from "../../components/ui";
import type { AppUser, Coordination, Expense, Payment, School, Student } from "../../types";
import { escapePdfHtml, generateExpensePdf, generateReceiptPdf, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { activityTimestamp } from "../../utils/activityHistory";
import { resolveExpenseCashierName, resolvePaymentCashierName } from "../../utils/finance";
import { MISSING_FINANCIAL_OPERATION_SCHOOL_ERROR, resolveFinancialOperationSchool } from "../../utils/financialOperationSchool";
import type { CoordinationStudentStatus } from "../../utils/coordinationSupervision";
import { formatStudentClassName } from "../../utils/studentClasses";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";
import { CoordinationStudentRecord } from "./CoordinationStudentRecord";
import { useCoordinationControlPage } from "./useCoordinationControlPage";
import { buildCoordinationAmountOptions, loadCoordinationControlHistory, loadCoordinationControlPage, type CoordinationControlCursor, type ControlRow } from "../../services/coordinationControlPagination";
import { controlHistoryCurrency, defaultControlHistoryDate, matchesControlHistory } from "../../utils/coordinationControlHistory";
import { formatCurrencyMoney, resolveSchoolCurrency } from "../../utils/currency";
import { controlArrearsPdfSections } from "../../utils/controlArrearsPdf";
import { loadCoordinationStudentArrearsDetailsBatch } from "../../services/coordinationService";
import type { HistoricalDebt } from "../../services/financialTransactions";
import { PaidAmountDropdown } from "../../components/PaidAmountDropdown";
import { COORDINATION_ACTIVE_YEAR, coordinationYearChoices } from "../../services/coordinationStudentPagination";
import { arrearsFilterForCriterion } from "../../utils/arrearsFilter";

type HistoryKind = "payments" | "expenses";

export function CoordinationControl({ user, coordination, schools, selectedSchoolId, onSchoolChange, refreshToken }: { user: AppUser; coordination: Coordination; schools: School[]; selectedSchoolId: string; onSchoolChange: (schoolId: string) => void; refreshToken: number }) {
  const [classKey, setClassKey] = useState("");
  const [amountComparator, setAmountComparator] = useState("");
  const [amountThreshold, setAmountThreshold] = useState("");
  const arrearsFilter = useMemo(() => arrearsFilterForCriterion(amountComparator, amountThreshold), [amountComparator, amountThreshold]);
  const [historyKind, setHistoryKind] = useState<HistoryKind | null>(null);
  const [historySchoolId, setHistorySchoolId] = useState("");
  const [historyDate] = useState(defaultControlHistoryDate);
  const [historyStart, setHistoryStart] = useState(historyDate);
  const [historyEnd, setHistoryEnd] = useState(historyDate);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [documentError, setDocumentError] = useState("");
  const page = useCoordinationControlPage(user, schools, selectedSchoolId, refreshToken, classKey, amountComparator, amountThreshold, arrearsFilter);
  const { rows, loading, error: loadError, classChoices } = page;
  const [history, setHistory] = useState<{ students: Student[]; payments: Payment[]; expenses: Expense[] }>({ students: [], payments: [], expenses: [] });
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyScope = schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId).map((school) => school.id).sort().join("|");
  const historyOpen = Boolean(historyKind);
  useEffect(() => {
    if (!historyOpen) return;
    let cancelled = false;
    setHistory({ students: [], payments: [], expenses: [] }); setHistoryLoading(true); setDocumentError("");
    loadCoordinationControlHistory(historyScope ? historyScope.split("|") : [])
      .then((value) => { if (!cancelled) setHistory(value); })
      .catch(() => { if (!cancelled) setDocumentError("Impossible de charger l'historique du contrôle."); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyOpen, historyScope, refreshToken]);
  useEffect(() => { setSelectedStudentId(""); }, [page.filterKey]);
  const schoolsById = useMemo(() => new Map(schools.map((school) => [school.id, school])), [schools]);
  const studentsById = useMemo(() => new Map(history.students.map((student) => [student.id, student])), [history.students]);
  const feeTypesById = useMemo(() => new Map(page.fees.map((fee) => [fee.id, fee])), [page.fees]);
  const feeChoices = page.fees.filter((fee) => schoolsById.has(fee.schoolId) && (!selectedSchoolId || fee.schoolId === selectedSchoolId) && (page.selectedYearId === COORDINATION_ACTIVE_YEAR ? schoolsById.get(fee.schoolId)?.activeSchoolYearId === fee.schoolYearId : !page.selectedYearId || fee.schoolYearId === page.selectedYearId));
  const amountOptions = buildCoordinationAmountOptions(schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId), feeChoices);
  useEffect(() => { setAmountComparator(""); }, [selectedSchoolId]);
  useEffect(() => { if (page.metadataReady && classKey && !classChoices.some((choice) => choice.value === classKey)) setClassKey(""); }, [classChoices, classKey, page.metadataReady]);
  useEffect(() => { if (page.metadataReady && amountComparator && !amountOptions.some((choice) => choice.value === amountComparator)) { setAmountComparator(""); setAmountThreshold(""); } }, [amountComparator, amountOptions, page.metadataReady]);
  const selectedStudent = rows.find((row) => row.student.id === selectedStudentId)?.student;
  const schoolName = (schoolId: string) => schools.find((school) => school.id === schoolId)?.name ?? schoolId;
  const historyFilters = useMemo(() => ({ schoolId: historySchoolId, startDate: historyStart, endDate: historyEnd }), [historySchoolId, historyStart, historyEnd]);
  const historyPayments = useMemo(() => history.payments.filter((payment) => matchesControlHistory(payment, historyFilters)).sort((first, second) => activityTimestamp(second.createdAt ?? second.paidAt) - activityTimestamp(first.createdAt ?? first.paidAt)), [history.payments, historyFilters]);
  const historyExpenses = useMemo(() => history.expenses.filter((expense) => matchesControlHistory(expense, historyFilters)).sort((first, second) => activityTimestamp(second.createdAt ?? second.spentAt) - activityTimestamp(first.createdAt ?? first.spentAt)), [history.expenses, historyFilters]);
  const historyMoney = (operation: Payment | Expense) => formatCurrencyMoney(operation.amount, controlHistoryCurrency(operation, schools, page.years));
  useEffect(() => { setHistorySchoolId(selectedSchoolId); }, [selectedSchoolId]);

  async function exportHistory() {
    const contextSchool = schools.find((school) => school.id === (historySchoolId || selectedSchoolId)) ?? schools[0];
    if (!contextSchool || historyLoading) return;
    const title = historyKind === "payments" ? "Paiements" : "Dépenses";
    const reportRows = historyKind === "payments" ? historyPayments.map((payment) => {
      const student = studentsById.get(payment.studentId);
      return { school: schoolName(payment.schoolId), date: payment.paidAt.slice(0, 10), label: `${student ? `${student.nom} ${student.prenom}` : payment.studentId} — ${feeTypesById.get(payment.feeTypeId)?.name ?? payment.feeName ?? "Frais"}`, amount: historyMoney(payment) };
    }) : historyExpenses.map((expense) => ({ school: schoolName(expense.schoolId), date: expense.spentAt.slice(0, 10), label: `${expense.category} — ${expense.description}`, amount: historyMoney(expense) }));
    try {
      await renderAcadPdfPreview({ filename: `historique-controle-${historyKind}.pdf`, title: `Historique du contrôle — ${title}`, school: coordinationPdfInstitution(coordination, contextSchool), subtitle: `École : ${historySchoolId ? schoolName(historySchoolId) : selectedSchoolId ? schoolName(selectedSchoolId) : "Toutes les écoles"} | Période : ${historyStart || "Début"} au ${historyEnd || "Fin"}`, sections: [pdfSection(title, pdfTable([
        { header: "École", render: (row) => escapePdfHtml(row.school) }, { header: "Date", render: (row) => row.date }, { header: "Libellé", render: (row) => escapePdfHtml(row.label) }, { header: "Montant / devise", render: (row) => row.amount, align: "right" },
      ], reportRows, "Aucune opération pour ces filtres."))] });
    } catch { setDocumentError("Impossible d’exporter l’historique."); }
  }

  async function exportPdf() {
    const arrearsCriterion = amountComparator.match(/^school:([^:]+):arrears:(gte|lt)$/);
    const criterionSchoolId = arrearsCriterion ? decodeURIComponent(arrearsCriterion[1]) : "";
    const contextSchool = schools.find((school) => school.id === (criterionSchoolId || selectedSchoolId)) ?? schools[0];
    if (!contextSchool) return;
    const exportRows: ControlRow[] = [];
    let cursor: CoordinationControlCursor | undefined;
    do {
      const result = await loadCoordinationControlPage(page.filters, page.fees, page.amountFilter, cursor, arrearsFilter);
      exportRows.push(...result.rows); cursor = result.nextCursor;
    } while (cursor);
    if (arrearsCriterion) {
      const details: Record<string, HistoricalDebt[]> = {};
      for (let offset = 0; offset < exportRows.length; offset += 50) {
        Object.assign(details, await loadCoordinationStudentArrearsDetailsBatch(exportRows.slice(offset, offset + 50).map((row) => row.student.id)));
      }
      await renderAcadPdfPreview({ filename: `controle-arrieres-${contextSchool.id}.pdf`, title: "Rapport d'arriérés", school: coordinationPdfInstitution(coordination, contextSchool),
        subtitle: `École : ${contextSchool.name} | Critère : Arriérés ${arrearsCriterion[2] === "gte" ? "≥" : "<"} ${amountThreshold ? formatCurrencyMoney(Number(amountThreshold), resolveSchoolCurrency(contextSchool)) : "tous"}`,
        sections: controlArrearsPdfSections(exportRows.map((row) => row.student), details, resolveSchoolCurrency(contextSchool)),
      });
      return;
    }
    await renderAcadPdfPreview({ filename: `controle-coordination-${selectedSchoolId || "toutes"}.pdf`, title: "Contrôle", school: coordinationPdfInstitution(coordination, contextSchool), subtitle: `École : ${selectedSchoolId ? contextSchool.name : "Toutes les écoles"} | Classe : ${classChoices.find((item) => item.value === classKey)?.label ?? "Toutes"} | Montant : ${amountOptions.find((item) => item.value === amountComparator)?.label ?? "Tous"} ${amountThreshold}`.trim(), sections: [pdfSection("Suivi des paiements", pdfTable([
      { header: "Élève", render: (row) => escapePdfHtml(`${row.student.nom} ${row.student.prenom}`) },
      { header: "École", render: (row) => escapePdfHtml(schoolName(row.student.schoolId)) },
      { header: "Classe", render: (row) => escapePdfHtml(formatStudentClassName(row.student)) },
      { header: "Prévu", render: (row) => row.balance.expected.toFixed(2), align: "right" },
      { header: "Payé", render: (row) => row.balance.paid.toFixed(2), align: "right" },
      { header: "Solde", render: (row) => row.balance.remaining.toFixed(2), align: "right" },
    ], exportRows, "Aucun élève ne correspond aux filtres."))] });
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
    const year = page.years.find((item) => item.id === expense.schoolYearId && item.schoolId === expense.schoolId);
    setDocumentError("");
    await generateExpensePdf(expense, school, year, resolveExpenseCashierName(expense, []));
  }

  if (selectedStudent) return <CoordinationStudentRecord context="control" student={selectedStudent} user={user} coordination={coordination} schools={schools} years={page.years} onBack={() => setSelectedStudentId("")}/>;

  return <section className="grid min-w-0 gap-4">
    <div className="grid min-w-0 grid-cols-2 gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-sm sm:p-4">
      <label className="grid min-w-0 gap-1"><span className="font-bold">École</span><select className="input min-w-0 w-full" aria-label="Filtrer par école" value={selectedSchoolId} onChange={(event) => onSchoolChange(event.target.value)}><option value="">{user.role === "sub_coordination_admin" ? "Toutes mes écoles" : "Toutes les écoles"} ({schools.length})</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
      <label className="grid min-w-0 gap-1"><span className="font-bold">Année scolaire</span><select className="input min-w-0 w-full" aria-label="Année scolaire" value={page.selectedYearId} onChange={(event) => page.setSelectedYearId(event.target.value)}><option value={COORDINATION_ACTIVE_YEAR}>Année active</option>{coordinationYearChoices(page.years, schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId)).map((year) => <option key={year.id} value={year.id}>{year.name} — {schoolName(year.schoolId)}</option>)}<option value="">Toutes les années</option></select></label>
    </div>
    <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en lecture seule."/>
    <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[repeat(3,minmax(5rem,1fr))_minmax(7rem,1.2fr)_minmax(4rem,.7fr)_repeat(3,max-content)]">
      <select className="input min-w-0 w-full" aria-label="Statut des élèves" value={page.status} onChange={(event) => page.setStatus(event.target.value as CoordinationStudentStatus)}><option value="all">Tous</option><option value="active">Actifs</option><option value="archived">Archivés</option></select>
      <select aria-label="Classe" className="input min-w-0 w-full" value={classKey} onChange={(event) => setClassKey(event.target.value)}><option value="">Toutes</option>{classChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <select className="input min-w-0 w-full" aria-label="Option" value={page.option} onChange={(event) => page.setOption(event.target.value)}><option value="">Toutes les options</option>{page.options.map((option) => <option key={option}>{option}</option>)}</select>
      <PaidAmountDropdown value={amountComparator} onChange={setAmountComparator} options={amountOptions}/>
      <input aria-label="Filtre" className="input min-w-0 w-full" type="number" min="0" step="any" placeholder="Filtre" value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)}/>
      <button type="button" className="pdf-export-button min-w-0 w-full xl:w-auto" onClick={() => void exportPdf()}><Download className="h-4 w-4"/> Exporter PDF</button>
      <button type="button" className="secondary-button min-w-0 w-full justify-center xl:w-auto" onClick={() => { setClassKey(""); setAmountComparator(""); setAmountThreshold(""); page.setSelectedYearId(COORDINATION_ACTIVE_YEAR); page.setStatus("all"); page.setOption(""); }}><RotateCcw className="h-4 w-4"/> Réinitialiser</button>
      <button type="button" className="secondary-button min-w-0 w-full justify-center xl:w-auto" onClick={() => { const today = defaultControlHistoryDate(); setHistoryStart(today); setHistoryEnd(today); setHistoryKind("payments"); }}>Historique</button>
    </div>
    {loading && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-700">Chargement du contrôle…</p>}
    {loadError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
    {!historyKind && documentError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{documentError}</p>}
    {!loading && <div className="grid min-w-0 gap-3">{rows.map(({ student, balance, progress, feeSummaries }) => <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between"><div className="min-w-0"><button type="button" className="break-words text-left font-bold text-ink hover:text-blue-700 hover:underline" onClick={() => setSelectedStudentId(student.id)}>{student.nom} {student.prenom}</button><p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)} | {schoolName(student.schoolId)}</p></div><span className={`w-fit shrink-0 rounded px-2 py-1 text-xs font-semibold ${balance.expected > 0 && balance.remaining === 0 ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>{balance.expected > 0 && balance.remaining === 0 ? "En ordre" : "Non en ordre"}</span></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"><Metric label="Prévu" value={balance.expected.toFixed(2)}/><Metric label="Payé" value={balance.paid.toFixed(2)}/><Metric label="Solde" value={balance.remaining.toFixed(2)}/></div><div className="mt-4 h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-700" style={{ width: `${progress}%` }}/></div>{feeSummaries.length === 0 && <p className="mt-2 text-xs text-slate-500">Aucun frais défini pour cette classe.</p>}</article>)}{rows.length === 0 && <p className="rounded bg-white p-5 text-sm text-slate-500">Aucune donnée de contrôle dans le périmètre sélectionné.</p>}</div>}
    <nav aria-label="Pagination du contrôle" className="flex flex-wrap items-center justify-between gap-2"><span>Page {page.pageIndex + 1} · {rows.length} élèves · 50 maximum par page</span><div className="flex gap-2"><button type="button" className="secondary-button" disabled={loading || page.pageIndex === 0} onClick={page.previous}>Précédente</button><button type="button" className="secondary-button" disabled={loading || !page.hasNext} onClick={page.next}>Suivante</button></div></nav>
    {historyKind && <AdminDrawer width="wide" title="Historique du contrôle" closeLabel="Fermer l’historique" toolbar={<div className="grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className={historyKind === "payments" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("payments")}>Paiements</button><button type="button" className={historyKind === "expenses" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("expenses")}>Dépenses</button></div>} onClose={() => { setHistoryKind(null); setDocumentError(""); }}>
      <div className="mb-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid min-w-0 gap-1 text-sm">École<select aria-label="École de l’historique" className="input" value={historySchoolId} onChange={(event) => setHistorySchoolId(event.target.value)}><option value="">Toutes les écoles du périmètre</option>{schools.filter((school) => !selectedSchoolId || school.id === selectedSchoolId).map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label className="grid min-w-0 gap-1 text-sm">Date début<input type="date" aria-label="Date début historique" className="input min-w-0" value={historyStart} onChange={(event) => setHistoryStart(event.target.value)}/></label>
        <label className="grid min-w-0 gap-1 text-sm">Date fin<input type="date" aria-label="Date fin historique" className="input min-w-0" value={historyEnd} onChange={(event) => setHistoryEnd(event.target.value)}/></label>
        <button type="button" className="pdf-export-button min-w-0 self-end justify-center" disabled={historyLoading || Boolean(documentError)} onClick={() => void exportHistory()}><Download className="h-4 w-4"/>Exporter PDF</button>
      </div>
      {historyLoading && <p role="status">Chargement de l’historique…</p>}
      {documentError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{documentError}</p>}
      {historyKind === "payments" ? <ReadOnlyTable headers={["Élève", "École", "Montant", "Date", "PDF"]} rows={historyPayments.map((payment) => { const student = studentsById.get(payment.studentId); return [student ? `${student.nom} ${student.prenom}` : payment.studentId, schoolName(payment.schoolId), historyMoney(payment), payment.paidAt, <button type="button" className="rounded bg-slate-100 p-2 text-slate-700" title="Voir le reçu PDF" aria-label={`Voir le reçu PDF du paiement ${payment.receiptNumber ?? payment.id}`} onClick={() => void downloadPaymentReceipt(payment)}><Download className="h-4 w-4"/></button>]; })}/> : <ReadOnlyTable headers={["École", "Catégorie", "Description", "Montant", "Date", "PDF"]} rows={historyExpenses.map((expense) => [schoolName(expense.schoolId), expense.category, expense.description, historyMoney(expense), expense.spentAt, <button type="button" className="rounded bg-slate-100 p-2 text-slate-700" title="Voir le justificatif PDF" aria-label={`Voir le justificatif PDF de la dépense ${expense.reference ?? expense.id}`} onClick={() => void downloadExpenseProof(expense)}><Download className="h-4 w-4"/></button>])}/>}</AdminDrawer>}
  </section>;
}

function ReadOnlyTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="p-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b">{row.map((cell, cellIndex) => <td key={cellIndex} className="break-words p-2">{cell}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune donnée.</p>}</div>;
}
