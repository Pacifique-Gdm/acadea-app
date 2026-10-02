import { useEffect, useMemo, useState } from "react";
import { StudentDetailPage } from "../../components/students/StudentDetailPage";
import { loadCoordinationStudentParent } from "../../services/coordinationService";
import { loadCoordinationStudentFinancialDetails } from "../../services/coordinationStudentPagination";
import type { CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import type { AppData, AppUser, ParentProfile, School, SchoolYear, Student } from "../../types";

function detailData(model: CoordinationDashboardReadModel, parents: ParentProfile[]): AppData {
  return { users: model.personnel, schools: [], schoolYears: model.schoolYears, students: model.students, parents, feeTypes: model.feeTypes, payments: model.payments, expenses: model.expenses, messages: [], notifications: [], auditLogs: [], valves: [], disciplineSanctions: [], attendance: [], attendanceSettings: [], biometricTerminals: [] };
}

function fallbackYear(student: Student): SchoolYear {
  return { id: student.schoolYearId, schoolId: student.schoolId, name: "Année scolaire", startsAt: "", endsAt: "", status: "active" };
}

export function CoordinationStudentRecord({ student, user, schools, years, onBack }: { student: Student; user: AppUser; schools: School[]; years: SchoolYear[]; onBack: () => void }) {
  const [parent, setParent] = useState<ParentProfile | null>(null);
  const [financial, setFinancial] = useState<Pick<CoordinationDashboardReadModel, "feeTypes" | "payments">>({ feeTypes: [], payments: [] });
  const [loading, setLoading] = useState(true);
  const [detailError, setDetailError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setParent(null); setFinancial({ feeTypes: [], payments: [] }); setLoading(true); setDetailError("");
    loadCoordinationStudentFinancialDetails(student)
      .then((value) => { if (!cancelled) setFinancial(value); })
      .catch(() => { if (!cancelled) setDetailError("Les données financières ne sont pas disponibles."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    loadCoordinationStudentParent(student.id)
      .then((value) => { if (!cancelled) setParent(value); })
      .catch(() => { if (!cancelled) setDetailError("Les informations du parent ne sont pas disponibles."); });
    return () => { cancelled = true; };
  }, [student]);
  const model = useMemo<CoordinationDashboardReadModel>(() => ({ students: [student], feeTypes: financial.feeTypes, payments: financial.payments, expenses: [], personnel: [], schoolYears: years }), [financial, student, years]);
  const data = useMemo(() => detailData(model, parent ? [parent] : []), [model, parent]);
  const schoolsById = useMemo(() => new Map(schools.map((item) => [item.id, item])), [schools]);
  const school = schools.find((item) => item.id === student.schoolId);
  if (!school) return <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">École de l’élève introuvable.</p>;
  const year = model.schoolYears.find((item) => item.id === student.schoolYearId) ?? fallbackYear(student);
  return <div className="grid gap-3">{loading && <p role="status">Chargement de la fiche…</p>}{detailError && <p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-800">{detailError}</p>}{!loading && <StudentDetailPage studentId={student.id} user={user} data={data} yearData={{ students: data.students, parents: data.parents, feeTypes: data.feeTypes, payments: data.payments, auditLogs: [] }} year={year} school={school} schoolsById={schoolsById} updateData={() => undefined} onBack={onBack} createId={() => "read-only"} formatArchiveDate={(value) => value || "Non renseignée"} canLinkParent={false}/>}</div>;
}
