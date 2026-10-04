import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download } from "lucide-react";
import { StudentDetailPage } from "../../components/students/StudentDetailPage";
import { loadCoordinationStudentArrears, loadCoordinationStudentParent } from "../../services/coordinationService";
import type { HistoricalDebt } from "../../services/financialTransactions";
import { historicalArrearsPdfSection } from "../control/historicalArrearsPdf";
import { formatCurrencyMoney, resolveSchoolCurrency } from "../../utils/currency";
import { getStudentFeeSummaries } from "../../utils/studentFeeSummary";
import { pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";
import { loadCoordinationStudentFinancialDetails } from "../../services/coordinationStudentPagination";
import type { CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import type { AppData, AppUser, Coordination, ParentProfile, School, SchoolYear, Student } from "../../types";

function detailData(model: CoordinationDashboardReadModel, parents: ParentProfile[]): AppData {
  return { users: model.personnel, schools: [], schoolYears: model.schoolYears, students: model.students, parents, feeTypes: model.feeTypes, payments: model.payments, expenses: model.expenses, messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
}

function fallbackYear(student: Student): SchoolYear {
  return { id: student.schoolYearId, schoolId: student.schoolId, name: "Année scolaire", startsAt: "", endsAt: "", status: "active" };
}

export function CoordinationStudentRecord({ student, user, coordination, schools, years, onBack, context = "students" }: { student: Student; user: AppUser; coordination: Coordination; schools: School[]; years: SchoolYear[]; onBack: () => void; context?: "students" | "control" }) {
  const [parent, setParent] = useState<ParentProfile | null>(null);
  const [financial, setFinancial] = useState<Pick<CoordinationDashboardReadModel, "feeTypes" | "payments">>({ feeTypes: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  const [arrears, setArrears] = useState<HistoricalDebt[]>([]);
  const [arrearsLoading, setArrearsLoading] = useState(true);
  const [arrearsError, setArrearsError] = useState("");
  const [parentLoading, setParentLoading] = useState(true);
  const [parentError, setParentError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setParent(null); setFinancial({ feeTypes: [], payments: [] }); setArrears([]); setLoading(true); setDetailError("");
    setArrearsLoading(true); setArrearsError(""); setParentLoading(true); setParentError("");
    loadCoordinationStudentFinancialDetails(student)
      .then((value) => { if (!cancelled) setFinancial(value); })
      .catch(() => { if (!cancelled) setDetailError("Les données financières ne sont pas disponibles."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    loadCoordinationStudentArrears(student.id)
      .then((historical) => { if (!cancelled) setArrears([...historical.debts, ...historical.settled]); })
      .catch(() => { if (!cancelled) setArrearsError("Les arriérés ne sont pas disponibles."); })
      .finally(() => { if (!cancelled) setArrearsLoading(false); });
    loadCoordinationStudentParent(student.id)
      .then((value) => { if (!cancelled) setParent(value); })
      .catch(() => { if (!cancelled) setParentError("Les informations du parent ne sont pas disponibles."); })
      .finally(() => { if (!cancelled) setParentLoading(false); });
    return () => { cancelled = true; };
  }, [student]);
  const model = useMemo<CoordinationDashboardReadModel>(() => ({ students: [student], feeTypes: financial.feeTypes, payments: financial.payments, expenses: [], personnel: [], schoolYears: years }), [financial, student, years]);
  const data = useMemo(() => detailData(model, parent ? [parent] : []), [model, parent]);
  const schoolsById = useMemo(() => new Map(schools.map((item) => [item.id, item])), [schools]);
  const school = schools.find((item) => item.id === student.schoolId);
  if (!school) return <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">École de l’élève introuvable.</p>;
  const year = model.schoolYears.find((item) => item.id === student.schoolYearId) ?? fallbackYear(student);
  async function printPdf() {
    if (!school || loading || arrearsLoading || detailError || arrearsError) return;
    const currency = resolveSchoolCurrency({ ...school, currency: year.currency ?? school.currency });
    try {
      await renderAcadPdfPreview({ filename: `fiche-financiere-${student.id}.pdf`, title: "Fiche financière individuelle", school: coordinationPdfInstitution(coordination, school), subtitle: `${student.nom} ${student.postnom ?? ""} ${student.prenom} | ${school.name} | ${year.name}`, sections: [
        pdfSection("Frais de l'année sélectionnée", pdfTable([
          { header: "Frais", render: (row) => row.feeName },
          { header: "Attendu", render: (row) => formatCurrencyMoney(row.expected, currency), align: "right" },
          { header: "Payé", render: (row) => formatCurrencyMoney(row.paid, currency), align: "right" },
          { header: "Restant", render: (row) => formatCurrencyMoney(row.remaining, currency), align: "right" },
        ], getStudentFeeSummaries(student, financial.feeTypes, financial.payments), "Aucun frais.")),
        historicalArrearsPdfSection(arrears),
      ] });
    } catch { setDetailError("Impossible de générer le PDF."); }
  }
  const arrearsCard = <section className="grid min-w-0 gap-3 rounded border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold">Dettes des années antérieures</h3>{arrearsLoading ? <p role="status">Chargement des arriérés…</p> : arrearsError ? <p role="alert">{arrearsError}</p> : <>{arrears.length === 0 && <p>Aucun arriéré pour cet élève.</p>}{arrears.map((debt) => <article key={`${debt.schoolYearId}:${debt.feeTypeId}`} className="min-w-0 rounded border bg-white p-3"><h4 className="break-words font-semibold">{debt.feeName} — {debt.yearName}</h4><div className="grid min-w-0 gap-2 sm:grid-cols-3"><p>Attendu : {formatCurrencyMoney(debt.expected, debt.currency)}</p><p>Payé : {formatCurrencyMoney(debt.paid, debt.currency)}</p><p>Restant : {formatCurrencyMoney(debt.remaining, debt.currency)}</p></div><p>{debt.remaining === 0 ? "Soldée" : "À payer"}</p></article>)}</>}</section>;
  return <div className="grid min-w-0 gap-3">
    <StudentDetailPage studentId={student.id} user={user} data={data} yearData={{ students: data.students, parents: data.parents, feeTypes: data.feeTypes, payments: data.payments, auditLogs: [] }} year={year} school={school} schoolsById={schoolsById} updateData={() => undefined} onBack={onBack} createId={() => "read-only"} formatArchiveDate={(value) => value || "Non renseignée"} canLinkParent={false} financialLoading={loading} financialError={detailError} parentLoading={parentLoading} parentError={parentError} afterPayments={context === "control" ? arrearsCard : undefined} header={context === "control" ? <header className="flex min-w-0 items-start gap-2 rounded border border-slate-200 bg-white p-3 sm:gap-3 sm:p-4">
      <button type="button" aria-label="Retour au contrôle" className="secondary-button shrink-0 p-2" onClick={onBack}><ArrowLeft className="h-5 w-5" /></button>
      <h1 className="min-w-0 flex-1 break-words text-lg font-bold text-ink sm:text-2xl">{student.nom} {student.postnom} {student.prenom}</h1>
      <button type="button" className="pdf-export-button shrink-0 px-2 text-xs sm:text-sm" disabled={loading || arrearsLoading || Boolean(detailError || arrearsError)} onClick={() => void printPdf()}><Download className="h-4 w-4" />Imprimer PDF</button>
    </header> : undefined}/>
  </div>;
}
