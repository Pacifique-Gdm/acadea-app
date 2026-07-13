import { useMemo, useState } from "react";
import type { DisciplineSanction, Student } from "../../types";

type NewSanctionInput = {
  students: Student[];
  reason: string;
  description: string;
  sanctionType: string;
  duration: number;
  startDate: string;
  expectedEndDate: string;
  observation: string;
};

type NewSanctionDrawerProps = {
  students: Student[];
  sanctions: DisciplineSanction[];
  onCancel: () => void;
  onSave: (input: NewSanctionInput) => Promise<string[] | void> | string[] | void;
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
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState("");
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
  const [isSaving, setIsSaving] = useState(false);

  const durationValue = Number(duration);
  const expectedEndDate = Number.isFinite(durationValue) && durationValue > 0 ? addDays(startDate, durationValue) : "";
  const studentsById = useMemo(() => new Map(students.map((student) => [student.id, student])), [students]);
  const selectedStudents = selectedStudentIds.map((id) => studentsById.get(id)).filter((student): student is Student => Boolean(student));
  const activeSanctionStudentIds = useMemo(
    () => new Set(sanctions.filter((sanction) => sanction.status === "active").map((sanction) => sanction.studentId)),
    [sanctions],
  );
  const sortedStudents = useMemo(
    () => [...students].sort((first, second) => studentName(first).localeCompare(studentName(second), "fr")),
    [students],
  );
  const normalizedSearch = studentSearch.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!normalizedSearch) return [];
    return sortedStudents.filter((student) => {
      if (selectedStudentIds.includes(student.id)) return false;
      const haystack = [
        student.nom,
        student.postnom,
        student.prenom,
        studentName(student),
        student.matricule,
        classLabel(student),
      ].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, selectedStudentIds, sortedStudents]);
  const selectedStudentsWithActiveSanction = selectedStudents.filter((student) => activeSanctionStudentIds.has(student.id));
  const canSave = Boolean(selectedStudents.length > 0 && reason.trim() && sanctionType.trim() && Number.isFinite(durationValue) && durationValue > 0 && startDate && expectedEndDate && !isSaving);

  function selectStudent(studentId: string) {
    setSelectedStudentIds((current) => (current.includes(studentId) ? current : [...current, studentId]));
    setStudentSearch("");
  }

  function removeStudent(studentId: string) {
    setSelectedStudentIds((current) => current.filter((id) => id !== studentId));
  }

  async function submit() {
    if (!canSave) return;
    setIsSaving(true);
    try {
      const failedStudentIds = await onSave({
        students: selectedStudents,
        reason: reason.trim(),
        description: description.trim(),
        sanctionType: sanctionType.trim(),
        duration: durationValue,
        startDate,
        expectedEndDate,
        observation: observation.trim(),
      });
      if (Array.isArray(failedStudentIds)) {
        setSelectedStudentIds(failedStudentIds);
      }
    } finally {
      setIsSaving(false);
    }
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
          Rechercher un élève
          <input
            value={studentSearch}
            onChange={(event) => setStudentSearch(event.target.value)}
            className="input"
            placeholder="Nom, postnom, prénom, matricule ou classe"
          />
        </label>
        {normalizedSearch && (
          <div className="max-h-56 space-y-2 overflow-y-auto rounded border border-slate-200 bg-white p-2 scrollbar-thin">
            {searchResults.length === 0 && <p className="rounded bg-slate-50 p-3 text-sm text-slate-500">Aucun élève trouvé.</p>}
            {searchResults.map((student) => (
              <button
                key={student.id}
                onClick={() => selectStudent(student.id)}
                className="w-full rounded border border-slate-100 bg-slate-50 p-3 text-left text-sm transition hover:border-blue-200 hover:bg-blue-50"
                type="button"
              >
                <p className="font-semibold text-ink">{studentName(student)}</p>
                <p className="text-xs text-slate-500">{classLabel(student)}{student.matricule ? ` · ${student.matricule}` : ""}</p>
              </button>
            ))}
          </div>
        )}
        {selectedStudents.length > 0 && (
          <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">{selectedStudents.length} élève(s) sélectionné(s)</p>
            <div className="grid gap-2">
              {selectedStudents.map((student) => (
                <div key={student.id} className="flex min-w-0 items-center justify-between gap-3 rounded bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink">{studentName(student)}</p>
                    <p className="truncate text-xs text-slate-500">{classLabel(student)}{student.matricule ? ` · ${student.matricule}` : ""}</p>
                  </div>
                  <button
                    onClick={() => removeStudent(student.id)}
                    className="shrink-0 rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-red-600"
                    type="button"
                    aria-label={`Retirer ${studentName(student)}`}
                  >
                    X
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {selectedStudentsWithActiveSanction.length > 0 && (
          <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
            {selectedStudentsWithActiveSanction.length === 1
              ? "Cet élève possède déjà une sanction en cours."
              : `${selectedStudentsWithActiveSanction.length} élèves possèdent déjà une sanction en cours.`}
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
          <button onClick={submit} disabled={!canSave} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </div>
    </aside>
  );
}
