import { useMemo, useRef, useState } from "react";
import { Download, Pencil, Printer, RotateCcw, Search } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import { canManageStudentMedicalRecords, saveStudentMedicalRecord, getMedicalRecordStatus, medicalRecordSaveErrorMessage } from "../../services/studentMedicalRecords";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { AppUser, School, SchoolSection, SchoolYear, Student } from "../../types";
import { pdfInfoGrid, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { getSchoolClassChoices, getSchoolSections, schoolSectionLabels } from "../../utils/schoolConfig";
import { buildValveClassChoices } from "../../utils/valves";
import type { StudentMedicalRecord } from "./secretaryTypes";
import { emptyMedicalRecordInput, formatMedicalRecordValue, medicalRecordSections, normalizeMedicalRecordInput, requiredMedicalRecordFields } from "./medicalRecordFields";
import type { MedicalRecordInput } from "./medicalRecordFields";
import { medicalRecordPdfSections } from "./medicalRecordPdf";
import { buildSecretaryStatistics, filterSecretaryStatisticsStudents, secretaryStatisticsScopeLabel, type SecretaryStatisticsFilter } from "./secretaryStatistics";

const statusPresentation = {
  complete: { label: "Complète", className: "bg-emerald-100 text-emerald-800" },
  incomplete: { label: "Incomplète", className: "bg-orange-100 text-orange-800" },
  missing: { label: "Non créée", className: "bg-slate-100 text-slate-700" },
};

function MedicalStatusBadge({ record }: { record?: StudentMedicalRecord }) {
  const presentation = statusPresentation[getMedicalRecordStatus(record)];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${presentation.className}`}>{presentation.label}</span>;
}

type MedicalRecordFieldsProps =
  | { mode: "edit"; input: MedicalRecordInput; onChange: (input: MedicalRecordInput) => void }
  | { mode: "view"; record?: Partial<MedicalRecordInput> };

function MedicalRecordFields(props: MedicalRecordFieldsProps) {
  return <>{medicalRecordSections.map((section) => props.mode === "edit"
    ? <fieldset className="grid gap-3" key={section.title}><legend className="mb-2 font-bold">{section.title}</legend>
        {section.fields.map((field) => field.control === "textarea"
          ? <textarea key={field.key} className="input" placeholder={field.label} aria-label={field.label} required={field.required} value={props.input[field.key]} onChange={(event) => props.onChange({ ...props.input, [field.key]: event.target.value })} />
          : <input key={field.key} className="input" placeholder={field.label} aria-label={field.label} required={field.required} value={props.input[field.key]} onChange={(event) => props.onChange({ ...props.input, [field.key]: event.target.value })} />)}
      </fieldset>
    : <section className="rounded border bg-white p-4" key={section.title}><h3 className="font-bold">{section.title}</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2">{section.fields.map((field) => <div className="min-w-0" key={field.key}><dt className="text-xs font-semibold uppercase text-slate-500">{field.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-slate-700">{formatMedicalRecordValue(props.record?.[field.key])}</dd></div>)}</dl></section>)}</>;
}

export function SecretaryMedicalRecordsDrawer({ open, onClose, user, students, records, school, year }: {
  open: boolean; onClose: () => void; user: AppUser; students: Student[]; records: StudentMedicalRecord[]; school: School; year: SchoolYear;
}) {
  const [queryText, setQueryText] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [input, setInput] = useState<MedicalRecordInput>(emptyMedicalRecordInput);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedStudentIds, setSavedStudentIds] = useState<Set<string>>(() => new Set());
  const [optimisticRecords, setOptimisticRecords] = useState<Map<string, StudentMedicalRecord>>(() => new Map());
  const saveLock = useRef(false);
  const schoolId = school.id;
  const schoolYearId = year.id;
  const canEditMedicalRecords = canManageStudentMedicalRecords(user, schoolId);
  const recordsByStudent = useMemo(() => new Map([
    ...records.filter((record) => record.schoolId === schoolId && record.schoolYearId === schoolYearId).map((record) => [record.studentId, record] as const),
    ...optimisticRecords,
  ]), [optimisticRecords, records, schoolId, schoolYearId]);
  const visibleStudents = useMemo(() => students.filter((student) => student.schoolId === schoolId && student.schoolYearId === schoolYearId && `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom} ${student.className}`.toLowerCase().includes(queryText.toLowerCase())), [queryText, schoolId, schoolYearId, students]);

  function openForm(student: Student) {
    if (!canEditMedicalRecords) return;
    const record = recordsByStudent.get(student.id);
    setInput(normalizeMedicalRecordInput(record));
    setViewingStudent(null);
    setEditingStudent(student);
    setMessage("");
  }

  async function save() {
    if (!editingStudent || saveLock.current) return;
    if (!requiredMedicalRecordFields.every((field) => input[field].trim())) {
      setMessage("Renseignez le groupe sanguin et les informations du contact d'urgence.");
      return;
    }
    saveLock.current = true; setSaving(true); setMessage("");
    try {
      await saveStudentMedicalRecord({ user, studentId: editingStudent.id, schoolId, schoolYearId, input });
      setSavedStudentIds((current) => new Set(current).add(editingStudent.id));
      const savedAt = new Date().toISOString();
      setOptimisticRecords((current) => new Map(current).set(editingStudent.id, {
        ...input,
        id: editingStudent.id,
        studentId: editingStudent.id,
        schoolId,
        schoolYearId,
        createdBy: recordsByStudent.get(editingStudent.id)?.createdBy ?? user.id,
        createdAt: recordsByStudent.get(editingStudent.id)?.createdAt ?? savedAt,
        updatedAt: savedAt,
      }));
      setInput(emptyMedicalRecordInput); setEditingStudent(null); setViewingStudent(editingStudent); setMessage("Fiche médicale enregistrée.");
    } catch (error) {
      console.error("Échec de l'enregistrement de la fiche médicale", error);
      setMessage(medicalRecordSaveErrorMessage(error));
    } finally { saveLock.current = false; setSaving(false); }
  }

  const viewingRecord = viewingStudent ? recordsByStudent.get(viewingStudent.id) : undefined;
  return <>
    {open && <AdminDrawer title="Fiches médicales" onClose={onClose} closeLabel="Fermer">
      <div className="flex h-full min-h-0 flex-col gap-3">
        {message && <p className="shrink-0 rounded border bg-white p-3 text-sm">{message}</p>}
        <div className="sticky top-0 z-10 shrink-0 bg-white pb-1">
          <label className="flex items-center gap-2 rounded border bg-white px-3 shadow-sm"><Search className="h-4 w-4" /><input className="min-w-0 flex-1 py-2 outline-none" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Rechercher un élève" /></label>
        </div>
        <div className="grid min-h-0 gap-2 overflow-y-auto overscroll-contain pr-1">
          {visibleStudents.map((student) => {
            const record = recordsByStudent.get(student.id);
            return <article key={student.id} className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              {student.photoUrl ? <img className="h-12 w-12 rounded-full object-cover" src={student.photoUrl} alt="" /> : <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 font-bold text-slate-600">{student.prenom?.[0] ?? student.nom?.[0] ?? "É"}</div>}
              <div className="min-w-0"><button type="button" onClick={() => setViewingStudent(student)} className="rounded text-left font-bold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-blue-700 hover:decoration-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label={`Consulter la fiche médicale de ${student.nom} ${student.postnom} ${student.prenom}`}>{student.nom} {student.postnom} {student.prenom}</button><p className="text-sm text-slate-500">{student.matricule} · {formatStudentClassName(student)}</p><div className="mt-2"><MedicalStatusBadge record={record} /></div></div>
              {canEditMedicalRecords && !record && !savedStudentIds.has(student.id) && <div className="flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => openForm(student)}><Pencil className="h-4 w-4" /> Créer</button></div>}
            </article>;
          })}
          {visibleStudents.length === 0 && <p className="rounded border bg-white p-6 text-center text-sm text-slate-500">Aucun élève trouvé.</p>}
        </div>
      </div>
    </AdminDrawer>}
    {editingStudent && <AdminDrawer title={`Fiche médicale · ${editingStudent.nom} ${editingStudent.prenom}`} onClose={() => !saving && setEditingStudent(null)} closeLabel="Fermer">
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <MedicalRecordFields mode="edit" input={input} onChange={setInput} />
        {message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
        <button className="primary-button justify-center" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </AdminDrawer>}
    {viewingStudent && <AdminDrawer title={`Fiche médicale · ${viewingStudent.nom} ${viewingStudent.prenom}`} onClose={() => setViewingStudent(null)} closeLabel="Fermer">
      <div className="grid gap-4 text-sm">
        <div className="flex flex-wrap justify-end gap-2">{canEditMedicalRecords && viewingRecord && <button className="primary-button" type="button" onClick={() => openForm(viewingStudent)}><Pencil className="h-4 w-4" /> Modifier</button>}{viewingRecord && <button className="secondary-button" type="button" onClick={() => void renderAcadPdfPreview({ filename: `fiche-medicale-${viewingStudent.matricule}.pdf`, title: "FICHE MÉDICALE", school, year, sections: medicalRecordPdfSections(viewingStudent, viewingRecord), singlePageFit: true })}><Printer className="h-4 w-4" /> Imprimer</button>}</div>
        <MedicalRecordFields mode="view" record={viewingRecord} />
      </div>
    </AdminDrawer>}
  </>;
}

export function SecretaryStatisticsDrawer({ open, onClose, students, records, school, year }: { open: boolean; onClose: () => void; students: Student[]; records: StudentMedicalRecord[]; school: School; year: SchoolYear }) {
  const [filterType, setFilterType] = useState<"all" | "section" | "class">("all");
  const [selectedSection, setSelectedSection] = useState<SchoolSection | "">("");
  const [selectedClassKey, setSelectedClassKey] = useState("");
  const scopedStudents = useMemo(() => students.filter((student) => student.schoolId === school.id && student.schoolYearId === year.id), [school.id, students, year.id]);
  const sections = useMemo(() => getSchoolSections(school), [school]);
  const classes = useMemo(() => {
    const configured = getSchoolClassChoices(school).map((className) => ({ value: className, label: className }));
    const present = buildValveClassChoices(scopedStudents, selectedClassKey);
    return Array.from(new Map([...configured, ...present].map((item) => [item.value, item])).values());
  }, [school, scopedStudents, selectedClassKey]);
  const activeFilter = useMemo<SecretaryStatisticsFilter>(() => {
    if (filterType === "section" && selectedSection) return { type: "section", section: selectedSection, label: schoolSectionLabels[selectedSection] };
    if (filterType === "class" && selectedClassKey) return { type: "class", classKey: selectedClassKey, label: classes.find((item) => item.value === selectedClassKey)?.label ?? selectedClassKey };
    return { type: "all" };
  }, [classes, filterType, selectedClassKey, selectedSection]);
  const filteredStudents = useMemo(() => filterSecretaryStatisticsStudents(scopedStudents, activeFilter), [activeFilter, scopedStudents]);
  const statistics = useMemo(() => buildSecretaryStatistics(filteredStudents, records.filter((record) => record.schoolId === school.id && record.schoolYearId === year.id)), [filteredStudents, records, school.id, year.id]);
  const scopeLabel = secretaryStatisticsScopeLabel(activeFilter);

  async function exportPdf() {
    await renderAcadPdfPreview({ filename: `statistiques-${year.name}.pdf`, title: "STATISTIQUES", school, year, subtitle: scopeLabel, sections: [
      pdfSection("Synthèse", pdfInfoGrid(statistics.cards.map(([label, value]) => ({ label, value }))), { className: "statistics-pdf-section statistics-summary-pdf-section" }),
      pdfSection("Répartition par classe", pdfTable([
        { header: "ORDRE", render: (row) => row.order, align: "center" }, { header: "SECTION", render: (row) => row.section }, { header: "CLASSE", render: (row) => row.className ?? "—" }, { header: "OPTION", render: (row) => row.option ?? "—" }, { header: "EFFECTIF", render: (row) => row.count, align: "right" }, { header: "POURCENTAGE", render: (row) => `${row.percentage.toFixed(2).replace(".", ",")} %`, align: "right" },
      ], statistics.classRows, "Aucune donnée pour cette répartition."), { className: "statistics-pdf-section" }),
      pdfSection("Répartition par niveau", pdfTable([
        { header: "ORDRE", render: (row) => row.order, align: "center" }, { header: "SECTION", render: (row) => row.section }, { header: "EFFECTIF", render: (row) => row.count, align: "right" }, { header: "POURCENTAGE", render: (row) => `${row.percentage.toFixed(2).replace(".", ",")} %`, align: "right" },
      ], statistics.sectionRows, "Aucune donnée pour cette répartition."), { pageBreakBefore: true, className: "statistics-pdf-section" }),
    ] });
  }

  function resetFilter() { setFilterType("all"); setSelectedSection(""); setSelectedClassKey(""); }
  function selectFilterType(value: typeof filterType) { setFilterType(value); setSelectedSection(""); setSelectedClassKey(""); }

  return open ? <AdminDrawer title="Statistiques" onClose={onClose} closeLabel="Fermer"><div className="grid min-w-0 gap-4">
    <div className="sticky top-0 z-20 grid w-full min-w-0 grid-cols-[minmax(0,1fr)_2.5rem] gap-2 border-b border-slate-100 bg-white pb-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(9rem,auto)]"><select aria-label="Type de filtre" className="input h-10 min-w-0 w-full" value={filterType} onChange={(event) => selectFilterType(event.target.value as typeof filterType)}><option value="all">Toutes</option><option value="section">Section</option><option value="class">Classe précise</option></select><button type="button" title="Réinitialiser le filtre" aria-label="Réinitialiser le filtre" className="secondary-button h-10 w-10 shrink-0 justify-center px-0" onClick={resetFilter}><RotateCcw aria-hidden="true" className="h-4 w-4" /></button><button type="button" className="pdf-export-button col-span-2 h-10 w-full sm:col-span-1" onClick={() => void exportPdf()}><Download className="h-4 w-4" /> Exporter PDF</button></div>
    <div className="grid min-w-0 gap-3">
      {filterType === "section" && <label className="grid gap-1 text-sm font-semibold">Section<select className="input" value={selectedSection} onChange={(event) => setSelectedSection(event.target.value as SchoolSection)}><option value="">Sélectionner une section</option>{sections.map((section) => <option key={section} value={section}>{schoolSectionLabels[section]}</option>)}</select>{sections.length === 0 && <span className="text-sm text-slate-500">Aucune section disponible.</span>}</label>}
      {filterType === "class" && <label className="grid gap-1 text-sm font-semibold">Classe précise<select className="input" value={selectedClassKey} onChange={(event) => setSelectedClassKey(event.target.value)}><option value="">Sélectionner une classe</option>{classes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>{classes.length === 0 && <span className="text-sm text-slate-500">Aucune classe disponible.</span>}</label>}
    </div>
    {filteredStudents.length === 0 ? <p className="rounded border border-dashed bg-white p-6 text-center text-sm text-slate-500">Aucune donnée statistique pour le filtre sélectionné.</p> : <><div className="grid gap-3 sm:grid-cols-2">{statistics.cards.map(([label, value]) => <article className="rounded border bg-white p-4" key={label}><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></article>)}</div><section className="rounded border bg-white p-4"><h3 className="font-bold">Répartition par classe</h3>{statistics.classRows.map((row) => <p className="mt-2 flex justify-between" key={`${row.section}-${row.className}-${row.option}`}><span>{row.className}{row.option && row.option !== "—" ? ` · ${row.option}` : ""}</span><strong>{row.count}</strong></p>)}</section><section className="rounded border bg-white p-4"><h3 className="font-bold">Répartition par niveau</h3>{statistics.sectionRows.map((row) => <p className="mt-2 flex justify-between" key={row.section}><span>{row.section}</span><strong>{row.count}</strong></p>)}</section></>}
  </div></AdminDrawer> : null;
}
