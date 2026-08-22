import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import type { AppUser, School } from "../../types";
import type { CoordinationDashboardReadModel } from "../../services/coordinationReadModel";
import { coordinationPdfInstitution } from "./coordinationPdfInstitution";
import type { Coordination } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { formatStudentClassName } from "../../utils/studentClasses";
import { buildCoordinationClassChoices, buildCoordinationOptionChoices, filterCoordinationStudents, type CoordinationStudentStatus } from "../../utils/coordinationSupervision";
import { CoordinationStudentRecord } from "./CoordinationStudentRecord";
import { isArchivedStudent } from "../../utils/studentUtils";
import { exportCoordinationFinancialTransactions } from "./coordinationFinancialExports";

export function CoordinationStudents({ user, coordination, schools, selectedSchoolId, model, loading, loadError }: { user: AppUser; coordination: Coordination; schools: School[]; selectedSchoolId: string; model: CoordinationDashboardReadModel; loading: boolean; loadError: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CoordinationStudentStatus>("all");
  const [classKey, setClassKey] = useState("");
  const [optionKey, setOptionKey] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const classes = useMemo(() => buildCoordinationClassChoices(model.students, schools, selectedSchoolId), [model.students, schools, selectedSchoolId]);
  const options = useMemo(() => buildCoordinationOptionChoices(model.students, schools, selectedSchoolId, classKey), [classKey, model.students, schools, selectedSchoolId]);
  const students = useMemo(() => filterCoordinationStudents({ students: model.students, selectedSchoolId, search, status, classKey, optionKey }), [classKey, model.students, optionKey, search, selectedSchoolId, status]);
  const selectedStudent = model.students.find((student) => student.id === selectedStudentId);

  useEffect(() => {
    setClassKey("");
    setOptionKey("");
    setSelectedStudentId("");
  }, [selectedSchoolId]);
  useEffect(() => {
    if (classKey && !classes.some((choice) => choice.value === classKey)) setClassKey("");
  }, [classKey, classes]);
  useEffect(() => {
    if (optionKey && !options.some((choice) => choice.value === optionKey)) setOptionKey("");
  }, [optionKey, options]);

  async function exportPdf() {
    const contextSchool = schools.find((school) => school.id === selectedSchoolId) ?? schools[0];
    if (!contextSchool) return;
    const schoolName = (schoolId: string) => schools.find((school) => school.id === schoolId)?.name ?? schoolId;
    await renderAcadPdfPreview({
      filename: `coordination-eleves-${selectedSchoolId || "toutes"}.pdf`,
      title: "Élèves — Coordination",
      school: coordinationPdfInstitution(coordination, contextSchool),
      subtitle: `École : ${selectedSchoolId ? contextSchool.name : "Toutes les écoles"} | Recherche : ${search || "Toutes"} | Statut : ${status === "all" ? "Tous" : status === "active" ? "Actifs" : "Archivés"} | Classe : ${classes.find((item) => item.value === classKey)?.label ?? "Toutes les classes"} | Option : ${options.find((item) => item.value === optionKey)?.label ?? "Toutes les options"}`,
      sections: [pdfSection("Élèves", pdfTable([
        { header: "Matricule", render: (student) => escapePdfHtml(student.matricule || "—") },
        { header: "Élève", render: (student) => escapePdfHtml(`${student.nom} ${student.postnom} ${student.prenom}`.trim()) },
        { header: "École", render: (student) => escapePdfHtml(schoolName(student.schoolId)) },
        { header: "Classe", render: (student) => escapePdfHtml(formatStudentClassName(student)) },
      ], students, "Aucun élève dans le périmètre sélectionné."))],
    });
  }

  async function exportFinancial(kind: "payments" | "expenses") {
    await exportCoordinationFinancialTransactions({
      kind,
      source: "students",
      coordination,
      schools,
      selectedSchoolId,
      students,
      payments: model.payments,
      expenses: model.expenses,
      filtersLabel: `Recherche : ${search || "Toutes"} | Statut : ${status === "all" ? "Tous" : status === "active" ? "Actifs" : "Archivés"} | Classe : ${classes.find((item) => item.value === classKey)?.label ?? "Toutes les classes"} | Option : ${options.find((item) => item.value === optionKey)?.label ?? "Toutes les options"}`,
    });
  }

  if (selectedStudent) {
    return <CoordinationStudentRecord student={selectedStudent} user={user} schools={schools} model={model} onBack={() => setSelectedStudentId("")}/>;
  }

  return <section className="grid min-w-0 gap-4">
    <div><h2 className="text-lg font-bold">Élèves</h2><p className="text-sm text-slate-600">Consultation en lecture seule · {students.length} résultat(s).</p></div>
    <div className="grid w-full min-w-0 grid-cols-1 items-stretch gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_auto_auto]">
      <label className="flex min-w-0 items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2"><Search className="h-4 w-4 shrink-0 text-slate-400"/><input className="min-w-0 flex-1 outline-none" placeholder="Rechercher" value={search} onChange={(event) => setSearch(event.target.value)}/></label>
      <select aria-label="Statut des élèves" className="input min-w-0 w-full" value={status} onChange={(event) => setStatus(event.target.value as CoordinationStudentStatus)}><option value="all">Tous</option><option value="active">Actifs</option><option value="archived">Archivés</option></select>
      <select aria-label="Classe" className="input min-w-0 w-full" value={classKey} onChange={(event) => { setClassKey(event.target.value); setOptionKey(""); }}><option value="">Toutes les classes</option>{classes.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <select aria-label="Option" className="input min-w-0 w-full" value={optionKey} onChange={(event) => setOptionKey(event.target.value)}><option value="">Toutes les options</option>{options.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>
      <div className="flex min-w-0 items-stretch justify-end gap-2" data-testid="coordination-students-financial-downloads">
        <button type="button" className="rounded bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!students.length} title="Télécharger les paiements PDF" aria-label="Télécharger les paiements PDF" onClick={() => void exportFinancial("payments")}><Download className="h-4 w-4"/></button>
        <button type="button" className="rounded bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50" disabled={!students.length} title="Télécharger les dépenses PDF" aria-label="Télécharger les dépenses PDF" onClick={() => void exportFinancial("expenses")}><Download className="h-4 w-4"/></button>
      </div>
      <button type="button" className="pdf-export-button min-w-0 w-full xl:w-auto" disabled={!students.length} onClick={() => void exportPdf()}><Download className="h-4 w-4"/> Exporter PDF</button>
    </div>
    {loading && <p role="status" className="rounded bg-blue-50 p-3 text-sm text-blue-700">Chargement des élèves…</p>}
    {loadError && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
    {!loading && <div className="max-w-full overflow-x-auto rounded border border-slate-200 bg-white"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Matricule</th><th className="p-3">Nom complet</th><th className="p-3">École</th><th className="p-3">Statut</th><th className="p-3">Sexe</th><th className="p-3">Classe</th></tr></thead><tbody>{students.map((student) => <tr key={student.id} className="border-t"><td className="p-3 font-semibold">{student.matricule}</td><td className="p-3"><button type="button" className="text-left font-semibold text-blue-700 hover:underline" onClick={() => setSelectedStudentId(student.id)}>{student.nom} {student.postnom} {student.prenom}</button></td><td className="p-3">{schools.find((school) => school.id === student.schoolId)?.name ?? student.schoolId}</td><td className="p-3">{isArchivedStudent(student) ? "Archivé" : "Actif"}</td><td className="p-3">{student.sexe}</td><td className="p-3">{formatStudentClassName(student)}</td></tr>)}</tbody></table>{students.length === 0 && <p className="p-5 text-sm text-slate-500">Aucun élève dans le périmètre sélectionné.</p>}</div>}
  </section>;
}
