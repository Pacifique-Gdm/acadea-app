import { useMemo, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { AdminDrawer, Metric, SectionTitle } from "../../components/ui";
import type { CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import type { AppUser, Coordination, School } from "../../types";
import { buildSchoolYearDataIndexes } from "../../utils/dataIndexes";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
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
  const scopedStudents = useMemo(() => model.students.filter((student) => !selectedSchoolId || student.schoolId === selectedSchoolId), [model.students, selectedSchoolId]);
  const scopedFeeTypes = useMemo(() => model.feeTypes.filter((fee) => !selectedSchoolId || fee.schoolId === selectedSchoolId), [model.feeTypes, selectedSchoolId]);
  const scopedPayments = useMemo(() => model.payments.filter((payment) => !selectedSchoolId || payment.schoolId === selectedSchoolId), [model.payments, selectedSchoolId]);
  const scopedExpenses = useMemo(() => model.expenses.filter((expense) => !selectedSchoolId || expense.schoolId === selectedSchoolId), [model.expenses, selectedSchoolId]);
  const indexes = useMemo(() => buildSchoolYearDataIndexes(scopedStudents, scopedFeeTypes, scopedPayments), [scopedFeeTypes, scopedPayments, scopedStudents]);
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

  if (selectedStudent) return <CoordinationStudentRecord student={selectedStudent} user={user} schools={schools} model={model} onBack={() => setSelectedStudentId("")}/>;

  return <section className="grid min-w-0 gap-4">
    <SectionTitle title="Contrôle" subtitle="Frais scolaires, paiements, historique et soldes restants en lecture seule."/>
    <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-nowrap">
      <select aria-label="Classe" className="input min-w-0 lg:flex-1 lg:basis-0" value={classKey} onChange={(event) => setClassKey(event.target.value)}><option value="">Toutes</option>{classChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <select aria-label="Montant payé" className="input min-w-0 lg:flex-1 lg:basis-0" value={amountComparator} onChange={(event) => setAmountComparator(event.target.value)}><option value="">Montant payé</option><option value="all-fees-gte">Tous les frais ≥</option><option value="all-fees-lt">Tous les frais &lt;</option>{feeChoices.flatMap((fee) => [<option key={`${fee.value}-gte`} value={`fee:${fee.value}:gte`}>{fee.label} ≥</option>, <option key={`${fee.value}-lt`} value={`fee:${fee.value}:lt`}>{fee.label} &lt;</option>])}</select>
      <input aria-label="Filtre" className="input min-w-0 lg:flex-1 lg:basis-0" type="number" placeholder="Filtre" value={amountThreshold} onChange={(event) => setAmountThreshold(event.target.value)}/>
      <button type="button" className="pdf-export-button min-w-0 lg:flex-1 lg:basis-0" onClick={() => void exportPdf()}><Download className="h-4 w-4"/> Exporter PDF</button>
      <button type="button" className="secondary-button min-w-0 justify-center lg:flex-1 lg:basis-0" onClick={() => { setClassKey(""); setAmountComparator(""); setAmountThreshold(""); }}><RotateCcw className="h-4 w-4"/> Réinitialiser</button>
      <button type="button" className="secondary-button min-w-0 justify-center lg:flex-1 lg:basis-0" onClick={() => setHistoryKind("payments")}>Historique</button>
    </div>
    {loading && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-700">Chargement du contrôle…</p>}
    {loadError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
    {!loading && <div className="grid min-w-0 gap-3">{rows.map(({ student, balance, progress, feeSummaries }) => <article key={student.id} className="min-w-0 rounded border border-slate-200 bg-white p-4"><div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:justify-between"><div className="min-w-0"><button type="button" className="break-words text-left font-bold text-ink hover:text-blue-700 hover:underline" onClick={() => setSelectedStudentId(student.id)}>{student.nom} {student.prenom}</button><p className="break-words text-sm text-slate-500">{student.matricule} | {formatStudentClassName(student)} | {schoolName(student.schoolId)}</p></div><span className={`w-fit shrink-0 rounded px-2 py-1 text-xs font-semibold ${balance.expected > 0 && balance.remaining === 0 ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>{balance.expected > 0 && balance.remaining === 0 ? "En ordre" : "Non en ordre"}</span></div><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3"><Metric label="Prévu" value={balance.expected.toFixed(2)}/><Metric label="Payé" value={balance.paid.toFixed(2)}/><Metric label="Solde" value={balance.remaining.toFixed(2)}/></div><div className="mt-4 h-3 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-blue-700" style={{ width: `${progress}%` }}/></div>{feeSummaries.length === 0 && <p className="mt-2 text-xs text-slate-500">Aucun frais défini pour cette classe.</p>}</article>)}{rows.length === 0 && <p className="rounded bg-white p-5 text-sm text-slate-500">Aucune donnée de contrôle dans le périmètre sélectionné.</p>}</div>}
    {historyKind && <AdminDrawer title="Historique du contrôle" closeLabel="Fermer l’historique" onClose={() => setHistoryKind(null)}><div className="grid grid-cols-2 gap-2"><button type="button" className={historyKind === "payments" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("payments")}>Paiements</button><button type="button" className={historyKind === "expenses" ? "primary-button justify-center" : "secondary-button justify-center"} onClick={() => setHistoryKind("expenses")}>Dépenses</button></div>{historyKind === "payments" ? <ReadOnlyTable headers={["Élève", "École", "Montant", "Date"]} rows={scopedPayments.map((payment) => { const student = scopedStudents.find((item) => item.id === payment.studentId); return [student ? `${student.nom} ${student.prenom}` : payment.studentId, schoolName(payment.schoolId), payment.amount.toFixed(2), payment.paidAt]; })}/> : <ReadOnlyTable headers={["École", "Catégorie", "Description", "Montant", "Date"]} rows={scopedExpenses.map((expense) => [schoolName(expense.schoolId), expense.category, expense.description, expense.amount.toFixed(2), expense.spentAt])}/>}</AdminDrawer>}
  </section>;
}

function ReadOnlyTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return <div className="max-w-full overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="p-2">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${index}-${row.join("-")}`} className="border-b">{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`} className="p-2">{cell}</td>)}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-4 text-sm text-slate-500">Aucune donnée.</p>}</div>;
}
