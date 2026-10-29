import { useMemo, useState } from "react";
import type { AppUser, School, SchoolYear } from "../../types";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import { saveSchedulePeriod, setSchedulePeriodActive, setStudyClassVacation } from "./studyService";
import { operationalClassLabel, studyVacationLabels } from "./studyScope";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import type { SchedulePeriod, StudyVacation } from "./studyTypes";
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
  const vacationActions = useAsyncAction();
  const [savedClasses, setSavedClasses] = useState<Record<string, string>>( {} );
  const sixDays = resolveAttendanceSchoolDays(data.attendanceSettings).includes("saturday");
  const periodClasses = useMemo(() => data.classes, [data.classes]);
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
    if (dayScope === "saturday" && !sixDays) return setError("Le samedi n’est pas disponible pour une école configurée sur 5 jours.");
    const id = editing?.id ?? `${school.id}__${year.id}__${vacation}__${dayScope}__${crypto.randomUUID()}`;
    setBusy(true); setError("");
    try {
      await saveSchedulePeriod({ user, item: { id, schoolId: school.id, schoolYearId: year.id, label: label.trim(), startTime: start, endTime: end, order: Number(order), type, vacation, dayScope, active: editing?.active ?? true, createdBy: editing?.createdBy ?? user.id, createdAt: editing?.createdAt ?? now, updatedAt: now }, existing: data.periods });
      setEditorOpen(false); setEditing(undefined); setConfirmation(""); setSuccess("Période enregistrée.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Enregistrement impossible."); }
    finally { setBusy(false); }
  }

  async function deactivate(item: SchedulePeriod) {
    if (busy) return;
    if (deactivationConfirmation !== "DÉSACTIVER CETTE PÉRIODE") return setDeactivationError("Saisissez exactement « DÉSACTIVER CETTE PÉRIODE ».");
    setBusy(true); setDeactivationError(""); setSuccess("");
    try {
      await setSchedulePeriodActive(user, item, false);
      setDeactivating(undefined); setDeactivationConfirmation(""); setSuccess("Période désactivée.");
    } catch (cause) { setDeactivationError(cause instanceof Error ? cause.message : "Désactivation impossible."); }
    finally { setBusy(false); }
  }

  async function saveClassVacation(item: (typeof periodClasses)[number], next: { vacation: StudyVacation; saturdayEnabled: boolean; saturdayVacation?: StudyVacation | null }) {
    setVacationError("");
    await vacationActions.run(item.id, async () => {
      setSavedClasses((current) => ({ ...current, [item.id]: "" }));
      await setStudyClassVacation({ user, item, ...next, persisted: data.sourceClasses.some((current) => current.id === item.id) });
      setSavedClasses((current) => ({ ...current, [item.id]: `${operationalClassLabel(item)} : vacation enregistrée.` }));
    });
  }

  const editor = editorOpen && <div data-testid="period-editor" className="grid min-w-0 gap-3 rounded border bg-white p-4">
    <div className="grid gap-2 sm:grid-cols-2"><select className="input" aria-label="Vacation" value={vacation} onChange={(event) => setVacation(event.target.value as StudyVacation)}><option value="morning">Avant-midi</option><option value="afternoon">Après-midi</option></select><select className="input" aria-label="Jours concernés" value={dayScope} onChange={(event) => setDayScope(event.target.value as typeof dayScope)}><option value="weekdays">Lundi à vendredi</option>{sixDays && <option value="saturday">Samedi (configuration spéciale)</option>}</select></div>
    <input className="input" placeholder="Libellé" value={label} onChange={(event) => setLabel(event.target.value)} />
    <div className="grid gap-2 sm:grid-cols-2"><input className="input" aria-label="Heure de début" type="time" value={start} onChange={(event) => setStart(event.target.value)} /><input className="input" aria-label="Heure de fin" type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
    <input className="input" aria-label="Ordre" type="number" min="1" value={order} onChange={(event) => setOrder(event.target.value)} />
    <select className="input" value={type} onChange={(event) => setType(event.target.value as SchedulePeriod["type"])}><option value="course">Cours</option><option value="break">Pause</option><option value="recess">Récréation</option></select>
    {editing && <label className="grid gap-1 text-sm font-semibold">Saisissez exactement « MODIFIER CETTE PÉRIODE »<input className="input" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => { setEditorOpen(false); setEditing(undefined); }}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
  </div>;

  return <section className="grid gap-5">
    <p className="text-sm text-slate-600">Configuration Discipline : {sixDays ? "6 jours (lundi à samedi)" : "5 jours (lundi à vendredi)"}. Les périodes standard sont partagées du lundi au vendredi.</p>
    {success && <p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">{success}</p>}
    {vacationActions.error && <p role="alert" className="text-sm text-red-700">{vacationActions.error}</p>}
    {periodClasses.filter((item) => vacationActions.isPending(item.id) || savedClasses[item.id]).map((item) => <p key={item.id} role="status" className="text-sm">{vacationActions.isPending(item.id) ? `${operationalClassLabel(item)} : enregistrement…` : savedClasses[item.id]}</p>)}
    <div className="grid gap-3 rounded border bg-white p-3"><h3 className="font-bold">Vacation des classes</h3>{vacationError && <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{vacationError}</p>}{periodClasses.map((item) => <label key={item.id} className="grid items-center gap-2 rounded border border-slate-100 p-2 text-sm sm:grid-cols-[minmax(0,1fr)_180px_150px]"><span className="min-w-0 font-medium">{operationalClassLabel(item)}</span><select aria-label={`Vacation de ${operationalClassLabel(item)}`} className="input w-full" disabled={vacationActions.isPending(item.id)} value={item.vacation ?? ""} onChange={(event) => void saveClassVacation(item, { vacation: event.target.value as StudyVacation, saturdayEnabled: item.saturdayEnabled ?? false, saturdayVacation: item.saturdayVacation })}><option value="" disabled>Choisir</option><option value="morning">Avant-midi</option><option value="afternoon">Après-midi</option></select>{sixDays && <span className="flex items-center gap-2"><input type="checkbox" disabled={vacationActions.isPending(item.id)} checked={item.saturdayEnabled ?? false} onChange={(event) => void saveClassVacation(item, { vacation: item.vacation ?? "morning", saturdayEnabled: event.target.checked, saturdayVacation: item.saturdayVacation })} /> Samedi</span>}</label>)}</div>
    {!editing && editor}
    <button type="button" className="primary-button w-full justify-center" onClick={() => edit()}>Ajouter une période</button>
    <div className="grid gap-3">{sorted.map((item) => <article className="grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={item.id}><p className="font-bold text-ink">{studyVacationLabels[item.vacation ?? "morning"]}</p><p className="font-semibold">{(item.dayScope ?? "weekdays") === "saturday" ? "Samedi" : "Lundi–vendredi"} — {item.label}</p><p className="text-sm text-slate-600">{periodTypeLabel(item.type)} — {item.startTime} → {item.endTime}</p><div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => edit(item)}>Modifier</button>{item.active ? <button type="button" className="secondary-button w-full justify-center" disabled={busy} onClick={() => { setDeactivating(item); setDeactivationConfirmation(""); setDeactivationError(""); setEditorOpen(false); setEditing(undefined); setSuccess(""); }}>Désactiver</button> : <span className="flex items-center justify-center rounded bg-slate-100 text-sm text-slate-500">Désactivée</span>}</div>{editorOpen && editing?.id === item.id && editor}{deactivating?.id === item.id && <div className="grid gap-3 rounded border border-red-200 bg-red-50 p-3"><p className="text-sm font-semibold">Désactiver « {item.label} » ? Saisissez exactement « DÉSACTIVER CETTE PÉRIODE ».</p><input className="input" aria-label={`Confirmation de désactivation de ${item.label}`} autoComplete="off" value={deactivationConfirmation} onChange={(event) => setDeactivationConfirmation(event.target.value)} />{deactivationError && <p role="alert" className="text-sm text-red-700">{deactivationError}</p>}<div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={() => setDeactivating(undefined)}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void deactivate(item)}>{busy ? "Traitement…" : "Confirmer"}</button></div></div>}</article>)}</div>
  </section>;
}
