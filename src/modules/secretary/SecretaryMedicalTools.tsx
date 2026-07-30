import { useMemo, useRef, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import { saveStudentMedicalRecord, getMedicalRecordStatus } from "../../services/studentMedicalRecords";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { AppUser, Student } from "../../types";
import type { StudentMedicalRecord } from "./secretaryTypes";
import { emptyMedicalRecordInput, formatMedicalRecordValue, medicalRecordSections, normalizeMedicalRecordInput, requiredMedicalRecordFields } from "./medicalRecordFields";
import type { MedicalRecordInput } from "./medicalRecordFields";

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

export function SecretaryMedicalRecordsDrawer({ open, onClose, user, students, records, schoolId, schoolYearId }: {
  open: boolean; onClose: () => void; user: AppUser; students: Student[]; records: StudentMedicalRecord[]; schoolId: string; schoolYearId: string;
}) {
  const [queryText, setQueryText] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [input, setInput] = useState<MedicalRecordInput>(emptyMedicalRecordInput);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const canEditMedicalRecords = user.role === "secretary" && user.status !== "inactive" && user.schoolId === schoolId;
  const recordsByStudent = useMemo(() => new Map(records.filter((record) => record.schoolId === schoolId && record.schoolYearId === schoolYearId).map((record) => [record.studentId, record])), [records, schoolId, schoolYearId]);
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
      setInput(emptyMedicalRecordInput); setEditingStudent(null); setMessage("Fiche médicale enregistrée.");
    } catch (error) {
      console.error("Échec de l'enregistrement de la fiche médicale", error);
      setMessage(error instanceof Error ? error.message : "Impossible d'enregistrer la fiche médicale.");
    } finally { saveLock.current = false; setSaving(false); }
  }

  const viewingRecord = viewingStudent ? recordsByStudent.get(viewingStudent.id) : undefined;
  return <>
    {open && <AdminDrawer title="Fiches médicales" onClose={onClose} closeLabel="Fermer">
      <div className="grid gap-4">
        {message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
        <label className="flex items-center gap-2 rounded border bg-white px-3"><Search className="h-4 w-4" /><input className="min-w-0 flex-1 py-2 outline-none" value={queryText} onChange={(event) => setQueryText(event.target.value)} placeholder="Rechercher un élève" /></label>
        <div className="grid gap-2">
          {visibleStudents.map((student) => {
            const record = recordsByStudent.get(student.id);
            return <article key={student.id} className="grid gap-3 rounded border bg-white p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              {student.photoUrl ? <img className="h-12 w-12 rounded-full object-cover" src={student.photoUrl} alt="" /> : <div className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 font-bold text-slate-600">{student.prenom?.[0] ?? student.nom?.[0] ?? "É"}</div>}
              <div className="min-w-0"><button type="button" onClick={() => setViewingStudent(student)} className="rounded text-left font-bold text-ink underline decoration-slate-300 underline-offset-4 transition hover:text-blue-700 hover:decoration-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2" aria-label={`Consulter la fiche médicale de ${student.nom} ${student.postnom} ${student.prenom}`}>{student.nom} {student.postnom} {student.prenom}</button><p className="text-sm text-slate-500">{student.matricule} · {formatStudentClassName(student)}</p><div className="mt-2"><MedicalStatusBadge record={record} /></div></div>
              {canEditMedicalRecords && <div className="flex flex-wrap gap-2"><button className="primary-button" type="button" onClick={() => openForm(student)}><Pencil className="h-4 w-4" /> {record ? "Modifier" : "Créer"}</button></div>}
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
        {canEditMedicalRecords && <div className="flex justify-end"><button className="primary-button" type="button" onClick={() => openForm(viewingStudent)}><Pencil className="h-4 w-4" /> Modifier</button></div>}
        <MedicalRecordFields mode="view" record={viewingRecord} />
      </div>
    </AdminDrawer>}
  </>;
}

export function SecretaryStatisticsDrawer({ open, onClose, students, records }: { open: boolean; onClose: () => void; students: Student[]; records: StudentMedicalRecord[] }) {
  const byClass = useMemo(() => students.reduce<Record<string, number>>((result, student) => ({ ...result, [formatStudentClassName(student)]: (result[formatStudentClassName(student)] ?? 0) + 1 }), {}), [students]);
  const byLevel = useMemo(() => students.reduce<Record<string, number>>((result, student) => { const level = student.section || "Non renseigné"; return { ...result, [level]: (result[level] ?? 0) + 1 }; }, {}), [students]);
  const recordsByStudent = useMemo(() => new Map(records.map((record) => [record.studentId, record])), [records]);
  const statuses = students.map((student) => getMedicalRecordStatus(recordsByStudent.get(student.id)));
  const cards = [
    ["Total élèves", students.length], ["Garçons", students.filter((student) => student.sexe === "M").length], ["Filles", students.filter((student) => student.sexe === "F").length],
    ["Fiches complètes", statuses.filter((status) => status === "complete").length], ["Fiches incomplètes", statuses.filter((status) => status === "incomplete").length], ["Fiches non créées", statuses.filter((status) => status === "missing").length],
  ];
  return open ? <AdminDrawer title="Statistiques" onClose={onClose} closeLabel="Fermer"><div className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2">{cards.map(([label, value]) => <article className="rounded border bg-white p-4" key={label}><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></article>)}</div><section className="rounded border bg-white p-4"><h3 className="font-bold">Répartition par classe</h3>{Object.entries(byClass).map(([label, value]) => <p className="mt-2 flex justify-between" key={label}><span>{label}</span><strong>{value}</strong></p>)}</section><section className="rounded border bg-white p-4"><h3 className="font-bold">Répartition par niveau</h3>{Object.entries(byLevel).map(([label, value]) => <p className="mt-2 flex justify-between" key={label}><span>{label}</span><strong>{value}</strong></p>)}</section></div></AdminDrawer> : null;
}
