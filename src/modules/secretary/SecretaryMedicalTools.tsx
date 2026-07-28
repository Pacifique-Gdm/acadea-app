import { useMemo, useRef, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import { saveStudentMedicalRecord, getMedicalRecordStatus } from "../../services/studentMedicalRecords";
import { formatStudentClassName } from "../../utils/studentClasses";
import type { AppUser, Student } from "../../types";
import type { StudentMedicalRecord } from "./secretaryTypes";

const emptyMedicalInput = {
  bloodGroup: "", rhesus: "", allergies: "", chronicDiseases: "", currentTreatments: "",
  disabilityOrSpecialNeed: "", vaccinations: "", medicalObservations: "", emergencyContactName: "",
  emergencyContactPhone: "", emergencyContactRelationship: "", attendingPhysician: "", physicianPhone: "",
  referenceHealthCenter: "",
};

type MedicalInput = typeof emptyMedicalInput;

const statusPresentation = {
  complete: { label: "Complète", className: "bg-emerald-100 text-emerald-800" },
  incomplete: { label: "Incomplète", className: "bg-orange-100 text-orange-800" },
  missing: { label: "Non créée", className: "bg-slate-100 text-slate-700" },
};

function MedicalStatusBadge({ record }: { record?: StudentMedicalRecord }) {
  const presentation = statusPresentation[getMedicalRecordStatus(record)];
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${presentation.className}`}>{presentation.label}</span>;
}

export function SecretaryMedicalRecordsDrawer({ open, onClose, user, students, records, schoolId, schoolYearId }: {
  open: boolean; onClose: () => void; user: AppUser; students: Student[]; records: StudentMedicalRecord[]; schoolId: string; schoolYearId: string;
}) {
  const [queryText, setQueryText] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [viewingStudent, setViewingStudent] = useState<Student | null>(null);
  const [input, setInput] = useState<MedicalInput>(emptyMedicalInput);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const recordsByStudent = useMemo(() => new Map(records.map((record) => [record.studentId, record])), [records]);
  const visibleStudents = useMemo(() => students.filter((student) => `${student.matricule} ${student.nom} ${student.postnom} ${student.prenom} ${student.className}`.toLowerCase().includes(queryText.toLowerCase())), [queryText, students]);

  function openForm(student: Student) {
    const record = recordsByStudent.get(student.id);
    setInput({ ...emptyMedicalInput, ...(record ?? {}) });
    setViewingStudent(null);
    setEditingStudent(student);
    setMessage("");
  }

  async function save() {
    if (!editingStudent || saveLock.current) return;
    if (!input.bloodGroup.trim() || !input.emergencyContactName.trim() || !input.emergencyContactPhone.trim() || !input.emergencyContactRelationship.trim()) {
      setMessage("Renseignez le groupe sanguin et les informations du contact d'urgence.");
      return;
    }
    saveLock.current = true; setSaving(true); setMessage("");
    try {
      await saveStudentMedicalRecord({ user, studentId: editingStudent.id, schoolId, schoolYearId, input });
      setInput(emptyMedicalInput); setEditingStudent(null); setMessage("Fiche médicale enregistrée.");
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
              <div className="min-w-0"><p className="font-bold">{student.nom} {student.postnom} {student.prenom}</p><p className="text-sm text-slate-500">{student.matricule} · {formatStudentClassName(student)}</p><div className="mt-2"><MedicalStatusBadge record={record} /></div></div>
              <div className="flex flex-wrap gap-2"><button className="secondary-button" type="button" disabled={!record} onClick={() => setViewingStudent(student)}>Consulter</button><button className="primary-button" type="button" onClick={() => openForm(student)}><Pencil className="h-4 w-4" /> {record ? "Modifier" : "Créer"}</button></div>
            </article>;
          })}
          {visibleStudents.length === 0 && <p className="rounded border bg-white p-6 text-center text-sm text-slate-500">Aucun élève trouvé.</p>}
        </div>
      </div>
    </AdminDrawer>}
    {editingStudent && <AdminDrawer title={`Fiche médicale · ${editingStudent.nom} ${editingStudent.prenom}`} onClose={() => !saving && setEditingStudent(null)} closeLabel="Fermer">
      <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className="grid gap-3"><legend className="mb-2 font-bold">Informations médicales</legend>
          <div className="grid gap-3 sm:grid-cols-2"><input className="input" placeholder="Groupe sanguin" value={input.bloodGroup} onChange={(event) => setInput({ ...input, bloodGroup: event.target.value })} /><input className="input" placeholder="Rhésus (optionnel)" value={input.rhesus} onChange={(event) => setInput({ ...input, rhesus: event.target.value })} /></div>
          <textarea className="input" placeholder="Allergies" value={input.allergies} onChange={(event) => setInput({ ...input, allergies: event.target.value })} /><textarea className="input" placeholder="Maladies chroniques" value={input.chronicDiseases} onChange={(event) => setInput({ ...input, chronicDiseases: event.target.value })} /><textarea className="input" placeholder="Traitements en cours" value={input.currentTreatments} onChange={(event) => setInput({ ...input, currentTreatments: event.target.value })} /><textarea className="input" placeholder="Handicap ou besoin particulier" value={input.disabilityOrSpecialNeed} onChange={(event) => setInput({ ...input, disabilityOrSpecialNeed: event.target.value })} /><textarea className="input" placeholder="Vaccinations" value={input.vaccinations} onChange={(event) => setInput({ ...input, vaccinations: event.target.value })} /><textarea className="input" placeholder="Observations médicales" value={input.medicalObservations} onChange={(event) => setInput({ ...input, medicalObservations: event.target.value })} />
        </fieldset>
        <fieldset className="grid gap-3"><legend className="mb-2 font-bold">Urgence</legend><input className="input" placeholder="Contact d'urgence" value={input.emergencyContactName} onChange={(event) => setInput({ ...input, emergencyContactName: event.target.value })} /><input className="input" placeholder="Téléphone du contact d'urgence" value={input.emergencyContactPhone} onChange={(event) => setInput({ ...input, emergencyContactPhone: event.target.value })} /><input className="input" placeholder="Lien avec l'élève" value={input.emergencyContactRelationship} onChange={(event) => setInput({ ...input, emergencyContactRelationship: event.target.value })} /></fieldset>
        <fieldset className="grid gap-3"><legend className="mb-2 font-bold">Suivi médical</legend><input className="input" placeholder="Médecin traitant" value={input.attendingPhysician} onChange={(event) => setInput({ ...input, attendingPhysician: event.target.value })} /><input className="input" placeholder="Téléphone du médecin" value={input.physicianPhone} onChange={(event) => setInput({ ...input, physicianPhone: event.target.value })} /><input className="input" placeholder="Centre de santé de référence" value={input.referenceHealthCenter} onChange={(event) => setInput({ ...input, referenceHealthCenter: event.target.value })} /></fieldset>
        {message && <p className="rounded border bg-white p-3 text-sm">{message}</p>}
        <button className="primary-button justify-center" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </form>
    </AdminDrawer>}
    {viewingStudent && viewingRecord && <AdminDrawer title={`Fiche médicale · ${viewingStudent.nom} ${viewingStudent.prenom}`} onClose={() => setViewingStudent(null)} closeLabel="Fermer">
      <div className="grid gap-4 text-sm">{[
        ["Informations générales", `Groupe sanguin : ${viewingRecord.bloodGroup || "Non renseigné"}${viewingRecord.rhesus ? ` ${viewingRecord.rhesus}` : ""}`],
        ["Allergies", viewingRecord.allergies], ["Pathologies", viewingRecord.chronicDiseases], ["Traitements", viewingRecord.currentTreatments],
        ["Vaccinations", viewingRecord.vaccinations], ["Contacts d'urgence", `${viewingRecord.emergencyContactName} · ${viewingRecord.emergencyContactPhone} · ${viewingRecord.emergencyContactRelationship}`],
        ["Observations", viewingRecord.medicalObservations],
      ].map(([title, value]) => <section className="rounded border bg-white p-4" key={title}><h3 className="font-bold">{title}</h3><p className="mt-2 whitespace-pre-wrap text-slate-600">{value || "Non renseigné"}</p></section>)}<button className="primary-button justify-center" type="button" onClick={() => openForm(viewingStudent)}>Modifier</button></div>
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
