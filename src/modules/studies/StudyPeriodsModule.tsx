import { useMemo, useState } from "react";
import type { AppUser, School, SchoolYear } from "../../types";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import { saveSchedulePeriod, saveStudyClassDayVacations, setSchedulePeriodActive } from "./studyService";
import { operationalClassLabel, periodTargetPairs, studyDayVacation, studyVacationLabels } from "./studyScope";
import { DAY_LABELS } from "./studySchedule";
import type { SchedulePeriod, StudyDay, StudyDayVacation, StudyVacation } from "./studyTypes";
import type { useStudyData } from "./useStudyData";

const periodTypeLabel = (type: SchedulePeriod["type"]) => type === "course" ? "Cours" : type === "break" ? "Pause" : "Récréation";

export function StudyPeriodsModule({ user, school, year, data }: { user: AppUser; school: School; year: SchoolYear; data: ReturnType<typeof useStudyData> }) {
  const [editing, setEditing] = useState<SchedulePeriod>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deactivating, setDeactivating] = useState<SchedulePeriod>();
  const [deactivationConfirmation, setDeactivationConfirmation] = useState("");
  const [deactivationError, setDeactivationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [label, setLabel] = useState(""), [start, setStart] = useState(""), [end, setEnd] = useState(""), [order, setOrder] = useState("1");
  const [type, setType] = useState<SchedulePeriod["type"]>("course");
  const [vacation, setVacation] = useState<StudyVacation>("morning");
  const [dayScope, setDayScope] = useState<"weekdays" | "saturday">("weekdays");
  const [error, setError] = useState("");
  const [vacationError, setVacationError] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dayDraft, setDayDraft] = useState<Record<string, Partial<Record<StudyDay, StudyDayVacation>>>>({});
  const [vacationConfirmation, setVacationConfirmation] = useState("");
  const schoolDays = resolveAttendanceSchoolDays(data.attendanceSettings);
  const sixDays = schoolDays.includes("saturday");
  const periodClasses = useMemo(() => data.classes, [data.classes]);
  const selectedClasses = periodClasses.filter((item) => selectedIds.includes(item.id));
  const selectedPairs = periodTargetPairs(selectedClasses, schoolDays, vacation);
  const establishedScheduleIds = new Set(data.timetables.filter((item) => item.status === "VALID" || item.status === "PUBLISHED").map((item) => item.id));
  const establishedEntries = data.timetableEntries.filter((item) => establishedScheduleIds.has(item.scheduleId));
  const classHasEstablishedEntries = (id: string) => establishedEntries.some((item) => item.classId === id);
  const periodHasEstablishedEntries = (id: string) => establishedEntries.some((item) => item.periodId === id);
  const sorted = [...data.periods].sort((a, b) => (a.vacation ?? "morning").localeCompare(b.vacation ?? "morning") || (a.dayScope ?? "weekdays").localeCompare(b.dayScope ?? "weekdays") || a.order - b.order || a.startTime.localeCompare(b.startTime));

  function edit(item?: SchedulePeriod) {
    setEditing(item); setLabel(item?.label ?? ""); setStart(item?.startTime ?? ""); setEnd(item?.endTime ?? "");
    setOrder(String(item?.order ?? sorted.filter((current) => (current.vacation ?? "morning") === vacation && (current.dayScope ?? "weekdays") === dayScope).length + 1));
    setType(item?.type ?? "course"); setVacation(item?.vacation ?? "morning"); setDayScope(item?.dayScope ?? "weekdays"); setError(""); setConfirmation(""); setSuccess(""); setDeactivating(undefined); setEditorOpen(true);
  }

  async function save() {
    if (busy) return;
    if (editing && confirmation !== "MODIFIER CETTE PÉRIODE") return setError("Saisissez exactement « MODIFIER CETTE PÉRIODE ».");
    const now = new Date().toISOString();
    if (!editing && !selectedPairs.length) return setError("Choisissez des classes et une vacation avec au moins un jour de cours.");
    if (editing && periodHasEstablishedEntries(editing.id)) return setError("Cette période figure dans un horaire validé ou publié. Créez une nouvelle version sans modifier cet horaire.");
    if (dayScope === "saturday" && !sixDays) return setError("Le samedi n’est pas disponible pour une école configurée sur 5 jours.");
    const id = editing?.id ?? `${school.id}__${year.id}__${vacation}__${dayScope}__${crypto.randomUUID()}`;
    setBusy(true); setError("");
    try {
      await saveSchedulePeriod({ user, item: { id, schoolId: school.id, schoolYearId: year.id, label: label.trim(), startTime: start, endTime: end, order: Number(order), type, vacation, dayScope: editing?.dayScope ?? "weekdays", ...(editing?.targetPairs ? { targetPairs: editing.targetPairs } : editing ? {} : { targetPairs: selectedPairs }), active: editing?.active ?? true, createdBy: editing?.createdBy ?? user.id, createdAt: editing?.createdAt ?? now, updatedAt: now }, existing: data.periods });
      setEditorOpen(false); setEditing(undefined); setConfirmation(""); setSuccess("Période enregistrée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  async function deactivate(item: SchedulePeriod) {
    if (busy) return;
    if (deactivationConfirmation !== "DÉSACTIVER CETTE PÉRIODE") return setDeactivationError("Saisissez exactement « DÉSACTIVER CETTE PÉRIODE ».");
    if (periodHasEstablishedEntries(item.id)) return setDeactivationError("Cette période figure dans un horaire validé ou publié. Désactivation bloquée.");
    setBusy(true); setDeactivationError(""); setSuccess("");
    try {
      await setSchedulePeriodActive(user, item, false);
      setDeactivating(undefined); setDeactivationConfirmation(""); setSuccess("Période désactivée.");
    } catch (cause) { setDeactivationError(cause instanceof Error ? cause.message : "Désactivation impossible."); }
    finally { setBusy(false); }
  }

  async function saveClassVacations() {
    if (busy || !selectedClasses.length) return setVacationError("Sélectionnez au moins une classe opérationnelle.");
    const replacing = selectedClasses.some((item) => item.vacation || item.saturdayVacation || item.dayVacations && Object.keys(item.dayVacations).length > 0);
    if (replacing && vacationConfirmation !== "REMPLACER LES VACATIONS") return setVacationError("Saisissez exactement « REMPLACER LES VACATIONS » avant de remplacer une configuration particulière.");
    if (selectedClasses.some((item) => classHasEstablishedEntries(item.id))) return setVacationError("Un horaire validé ou publié utilise une classe sélectionnée. Ses vacations ne peuvent pas être modifiées ici.");
    setBusy(true); setVacationError(""); setSuccess("");
    try {
      const values = Object.fromEntries(selectedClasses.map((item) => [item.id, Object.fromEntries(schoolDays.map((day) => [day, dayDraft[item.id]?.[day] ?? studyDayVacation(item, day)]))])) as Record<string, Partial<Record<StudyDay, StudyDayVacation>>>;
      await saveStudyClassDayVacations({ user, classes: selectedClasses, sourceClasses: data.sourceClasses, days: schoolDays, values });
      setVacationConfirmation(""); setDayDraft({}); setSuccess("Vacations journalières enregistrées pour les classes sélectionnées.");
    } catch (cause) { setVacationError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  const editor = editorOpen && <div data-testid="period-editor" className="grid min-w-0 gap-3 rounded border bg-white p-4">
    <div className="grid gap-2 sm:grid-cols-2"><select className="input" aria-label="Vacation" disabled={Boolean(editing)} value={vacation} onChange={(event) => setVacation(event.target.value as StudyVacation)}><option value="morning">Avant-midi</option><option value="afternoon">Après-midi</option></select>{editing && !editing.targetPairs ? <select className="input" aria-label="Jours concernés" disabled value={dayScope} onChange={(event) => setDayScope(event.target.value as typeof dayScope)}><option value="weekdays">Lundi à vendredi</option>{sixDays && <option value="saturday">Samedi (configuration spéciale)</option>}</select> : <p className="text-sm text-slate-600">{editing ? "Portée existante conservée" : `${selectedPairs.length} couple(s) classe/jour concernés.`}</p>}</div>
    {!editing && <p className="text-sm text-slate-600">Une seule période sera créée pour tout le groupe {studyVacationLabels[vacation]} sélectionné.</p>}
    <input className="input" placeholder="Libellé" value={label} onChange={(event) => setLabel(event.target.value)} />
    <div className="grid gap-2 sm:grid-cols-2"><input className="input" aria-label="Heure de début" type="time" value={start} onChange={(event) => setStart(event.target.value)} /><input className="input" aria-label="Heure de fin" type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
    <input className="input" aria-label="Ordre" type="number" min="1" value={order} onChange={(event) => setOrder(event.target.value)} />
    <select className="input" value={type} onChange={(event) => setType(event.target.value as SchedulePeriod["type"])}><option value="course">Cours</option><option value="break">Pause</option><option value="recess">Récréation</option></select>
    {editing && <label className="grid gap-1 text-sm font-semibold">Saisissez exactement « MODIFIER CETTE PÉRIODE »<input className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => { setEditorOpen(false); setEditing(undefined); }}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
  </div>;

  return <section className="grid gap-5">
    <p className="text-sm text-slate-600">Configuration Discipline : {schoolDays.map((day) => DAY_LABELS[day]).join(", ")}. Les périodes historiques restent partagées ; les nouvelles périodes ciblent les classes et jours sélectionnés.</p>
    {success && <p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">{success}</p>}
    <div className="grid gap-3 rounded border bg-white p-3">
      <h3 className="font-bold">Classe opérationnelle et vacations par jour</h3>
      <div className="flex flex-wrap gap-2"><button type="button" className="secondary-button" onClick={() => setSelectedIds(periodClasses.map((item) => item.id))}>Toutes les classes</button><button type="button" className="secondary-button" onClick={() => setSelectedIds([])}>Aucune classe</button></div>
      <div className="grid gap-2 sm:grid-cols-2">{periodClasses.map((item) => <label key={item.id} className="flex items-center gap-2 rounded border p-2 text-sm"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{operationalClassLabel(item)}</label>)}</div>
      {selectedClasses.map((item) => <div key={item.id} className="grid gap-2 rounded border border-slate-200 p-3"><p className="font-semibold">{operationalClassLabel(item)}</p><div className="grid gap-2 sm:grid-cols-2">{schoolDays.map((day) => <label key={day} className="grid gap-1 text-sm">{DAY_LABELS[day]}<select className="input" aria-label={`${operationalClassLabel(item)} — ${DAY_LABELS[day]}`} value={dayDraft[item.id]?.[day] ?? studyDayVacation(item, day)} onChange={(event) => setDayDraft((current) => ({ ...current, [item.id]: { ...current[item.id], [day]: event.target.value as StudyDayVacation } }))}><option value="morning">Avant-midi</option><option value="afternoon">Après-midi</option><option value="full">Journée complète</option><option value="none">Pas de cours</option></select></label>)}</div>{classHasEstablishedEntries(item.id) && <p role="alert" className="text-sm text-amber-800">Horaire validé ou publié : modification de cette classe bloquée.</p>}</div>)}
      {selectedClasses.some((item) => item.vacation || item.saturdayVacation || item.dayVacations && Object.keys(item.dayVacations).length > 0) && <label className="grid gap-1 text-sm">Remplacement d’une configuration particulière : saisissez « REMPLACER LES VACATIONS »<input className="input" value={vacationConfirmation} onChange={(event) => setVacationConfirmation(event.target.value)} /></label>}
      {vacationError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{vacationError}</p>}
      <button type="button" className="primary-button w-full justify-center" disabled={busy || !selectedClasses.length} onClick={() => void saveClassVacations()}>{busy ? "Enregistrement…" : "Enregistrer les vacations sélectionnées"}</button>
    </div>
    {selectedClasses.length > 0 && <div className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-semibold">Groupes de périodes pour les classes sélectionnées</p>
      {(["morning", "afternoon"] as const).map((groupVacation) => <p key={groupVacation}><strong>{studyVacationLabels[groupVacation]} :</strong> {periodTargetPairs(selectedClasses, schoolDays, groupVacation).map((pair) => {
        const [classId, day] = pair.split("|");
        return `${operationalClassLabel(selectedClasses.find((item) => item.id === classId)!)} · ${DAY_LABELS[day as StudyDay]}`;
      }).join(" ; ") || "Aucun couple classe/jour"}</p>)}
    </div>}
    {!editing && editor}
    <button type="button" className="primary-button w-full justify-center" disabled={!selectedClasses.length} onClick={() => edit()}>Ajouter une période</button>
    <div className="grid gap-3">{sorted.map((item) => <article className="grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={item.id}>
      <p className="font-bold text-ink">{studyVacationLabels[item.vacation ?? "morning"]}</p>
      <p className="font-semibold">{item.label}</p>
      <p className="text-sm text-slate-600">{item.targetPairs ? item.targetPairs.map((pair) => {
        const [classId, day] = pair.split("|");
        return `${operationalClassLabel(periodClasses.find((schoolClass) => schoolClass.id === classId) ?? { id: classId, schoolId: school.id, schoolYearId: year.id, name: classId })} · ${DAY_LABELS[day as StudyDay] ?? day}`;
      }).join(" ; ") : (item.dayScope ?? "weekdays") === "saturday" ? "Samedi" : "Lundi–vendredi"}</p>
      <p className="text-sm text-slate-600">{periodTypeLabel(item.type)} — {item.startTime} → {item.endTime}</p>
      <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => edit(item)}>Modifier</button>{item.active ? <button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => { setDeactivating(item); setDeactivationConfirmation(""); setDeactivationError(""); setEditorOpen(false); setEditing(undefined); setSuccess(""); }}>Désactiver</button> : <span className="flex items-center justify-center rounded bg-slate-100 text-sm text-slate-500">Désactivée</span>}</div>
      {editorOpen && editing?.id === item.id && editor}
      {deactivating?.id === item.id && <div className="grid gap-3 rounded border border-red-200 bg-red-50 p-3"><p className="text-sm font-semibold">Désactiver « {item.label} » ? Saisissez exactement « DÉSACTIVER CETTE PÉRIODE ».</p><input className="input" aria-label={`Confirmation de désactivation de ${item.label}`} autoComplete="off" value={deactivationConfirmation} onChange={(event) => setDeactivationConfirmation(event.target.value)} />{deactivationError && <p role="alert" className="text-sm text-red-700">{deactivationError}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setDeactivating(undefined)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void deactivate(item)}>{busy ? "Traitement…" : "Confirmer"}</button></div></div>}
    </article>)}</div>
  </section>;
}
