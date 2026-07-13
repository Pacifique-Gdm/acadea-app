import { useMemo, useState } from "react";
import type { DisciplineSanction, Student } from "../../types";

type NewSanctionInput = {
  student: Student;
  reason: string;
  description: string;
  sanctionType: string;
  duration: number;
  startDate: string;
  expectedEndDate: string;
  observation?: string;
};

type NewSanctionDrawerProps = {
  students: Student[];
  sanctions: DisciplineSanction[];
  onCancel: () => void;
  onSave: (input: NewSanctionInput) => void;
};

const defaultReasonChoices = [
  "Retard",
  "Absence injustifiée",
  "Indiscipline",
  "Insolence",
  "Violence",
  "Tricherie",
  "Dégradation du matériel",
  "Tenue non conforme",
  "Non-respect du règlement",
  "Autre",
];

const defaultSanctionTypeChoices = [
  "Avertissement",
  "Blâme",
  "Retenue",
  "Travail d’intérêt scolaire",
  "Exclusion temporaire",
  "Convocation du parent",
  "Autre",
];

type ChoiceKind = "reason" | "sanctionType";

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + Math.max(days, 0));
  return date.toISOString().slice(0, 10);
}

function studentName(student: Student) {
  return `${student.nom} ${student.postnom} ${student.prenom}`.replace(/\s+/g, " ").trim();
}

function classLabel(student: Pick<Student, "className" | "option">) {
  const option = student.option?.trim();
  if (!option) return student.className;
  return `${student.className} ${option}`;
}

export function NewSanctionDrawer({ students, sanctions, onCancel, onSave }: NewSanctionDrawerProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [studentId, setStudentId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [sanctionType, setSanctionType] = useState("");
  const [duration, setDuration] = useState("1");
  const [startDate, setStartDate] = useState(today);
  const [observation, setObservation] = useState("");
  const [reasonChoices, setReasonChoices] = useState(defaultReasonChoices);
  const [sanctionTypeChoices, setSanctionTypeChoices] = useState(defaultSanctionTypeChoices);
  const [choicePanel, setChoicePanel] = useState<ChoiceKind | null>(null);
  const [choiceDraft, setChoiceDraft] = useState("");
  const [choiceError, setChoiceError] = useState("");
  const selectedStudent = students.find((student) => student.id === studentId);
  const durationValue = Number(duration);
  const expectedEndDate = Number.isFinite(durationValue) && durationValue > 0 ? addDays(startDate, durationValue) : "";
  const hasActiveSanction = Boolean(selectedStudent && sanctions.some((sanction) => sanction.studentId === selectedStudent.id && sanction.status === "active"));
  const sortedStudents = useMemo(
    () => [...students].sort((first, second) => studentName(first).localeCompare(studentName(second), "fr")),
    [students],
  );
  const canSave = Boolean(selectedStudent && reason.trim() && sanctionType.trim() && Number.isFinite(durationValue) && durationValue > 0 && startDate && expectedEndDate);

  function submit() {
    if (!selectedStudent || !canSave) return;
    onSave({
      student: selectedStudent,
      reason: reason.trim(),
      description: description.trim(),
      sanctionType: sanctionType.trim(),
      duration: durationValue,
      startDate,
      expectedEndDate,
      observation: observation.trim() || undefined,
    });
  }

  function openChoicePanel(kind: ChoiceKind) {
    setChoicePanel(kind);
    setChoiceDraft("");
    setChoiceError("");
  }

  function closeChoicePanel() {
    setChoicePanel(null);
    setChoiceDraft("");
    setChoiceError("");
  }

  function addChoice() {
    if (!choicePanel) return;
    const value = choiceDraft.trim();
    if (!value) {
      setChoiceError("Veuillez renseigner une valeur.");
      return;
    }
    const choices = choicePanel === "reason" ? reasonChoices : sanctionTypeChoices;
    const exists = choices.some((choice) => choice.trim().toLowerCase() === value.toLowerCase());
    if (exists) {
      setChoiceError("Cette valeur existe déjà.");
      return;
    }
    if (choicePanel === "reason") {
      setReasonChoices((current) => [...current, value]);
      setReason(value);
    } else {
      setSanctionTypeChoices((current) => [...current, value]);
      setSanctionType(value);
    }
    closeChoicePanel();
  }

  return (
    <aside className="min-w-0 max-w-full rounded border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 break-words text-lg font-bold text-ink">Informations de sanction</h2>
      <div className="grid min-w-0 gap-3">
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          Élève
          <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="input">
            <option value="">Sélectionner un élève</option>
            {sortedStudents.map((student) => (
              <option key={student.id} value={student.id}>{studentName(student)} - {student.matricule}</option>
            ))}
          </select>
        </label>
        {selectedStudent && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">Classe automatique</p>
            <p className="mt-1 text-slate-600">{classLabel(selectedStudent)}</p>
          </div>
        )}
        {hasActiveSanction && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            Cet élève possède déjà une sanction en cours.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Date de début
            <input value={startDate} onChange={(event) => setStartDate(event.target.value)} type="date" className="input" />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Durée en jours
            <input value={duration} onChange={(event) => setDuration(event.target.value)} type="number" min="1" className="input" />
          </label>
        </div>
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-ink">Date prévue de fin</p>
          <p className="mt-1 text-slate-600">{expectedEndDate || "Durée invalide"}</p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Motif
            <select value={reason} onChange={(event) => setReason(event.target.value)} className="input">
              <option value="" disabled hidden>Choisir un motif</option>
              {reasonChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </label>
          <button onClick={() => openChoicePanel("reason")} className="secondary-button justify-center" type="button">Ajouter</button>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
            Type de sanction
            <select value={sanctionType} onChange={(event) => setSanctionType(event.target.value)} className="input">
              <option value="" disabled hidden>Choisir un type</option>
              {sanctionTypeChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </label>
          <button onClick={() => openChoicePanel("sanctionType")} className="secondary-button justify-center" type="button">Ajouter</button>
        </div>
        {choicePanel && (
          <div className="grid min-w-0 gap-3 rounded border border-slate-200 bg-slate-50 p-3">
            <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
              {choicePanel === "reason" ? "Nouveau motif" : "Nouveau type de sanction"}
              <input value={choiceDraft} onChange={(event) => {
                setChoiceDraft(event.target.value);
                setChoiceError("");
              }} className="input bg-white" />
            </label>
            {choiceError && <p className="text-sm font-semibold text-red-600">{choiceError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <button onClick={closeChoicePanel} className="secondary-button justify-center" type="button">Annuler</button>
              <button onClick={addChoice} className="primary-button justify-center" type="button">Ajouter</button>
            </div>
          </div>
        )}
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="input min-h-24" />
        </label>
        <label className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
          Observation
          <textarea value={observation} onChange={(event) => setObservation(event.target.value)} className="input min-h-20" />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={onCancel} className="secondary-button justify-center" type="button">Annuler</button>
          <button onClick={submit} disabled={!canSave} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">Enregistrer</button>
        </div>
      </div>
    </aside>
  );
}
