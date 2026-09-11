import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { AdminDrawer } from "../../components/ui";
import type { AppUser, SchoolYear } from "../../types";
import { DAY_LABELS } from "./studySchedule";
import { saveTeacherWeekAvailability } from "./studyService";
import type { StudyDay, StudyTeacher, TeacherAvailability } from "./studyTypes";

type Range = { startTime: string; endTime: string };
type EditableStatus = "available" | "rest";
type DayDraft = { status: EditableStatus; wholeDay: boolean; ranges: Range[]; legacyUnavailable: boolean };

function initialDrafts(teacherId: string, items: TeacherAvailability[], schoolDays: StudyDay[]) {
  return Object.fromEntries(schoolDays.map((day): [StudyDay, DayDraft] => {
    const active = items.filter((item) => item.teacherId === teacherId && item.dayOfWeek === day && item.active);
    const available = active.filter((item) => item.status === "available");
    const ranges = available.flatMap((item) => item.startTime && item.endTime ? [{ startTime: item.startTime, endTime: item.endTime }] : []);
    return [day, {
      status: active.some((item) => item.status === "rest") ? "rest" : "available",
      wholeDay: ranges.length === 0,
      ranges,
      legacyUnavailable: active.some((item) => item.status === "unavailable"),
    }];
  })) as Record<StudyDay, DayDraft>;
}

export function TeacherAvailabilitySummary({ teacherId, items, schoolDays }: { teacherId: string; items: TeacherAvailability[]; schoolDays: StudyDay[] }) {
  return <div className="grid gap-2">{schoolDays.map((day) => {
    const active = items.filter((item) => item.teacherId === teacherId && item.dayOfWeek === day && item.active);
    return <div key={day} className="rounded bg-slate-50 p-2 text-sm"><strong>{DAY_LABELS[day]}</strong><p>{active.length ? active.map((item) => item.status === "rest" ? "Repos" : `${item.status === "available" ? "Disponible" : "Indisponible (historique)"}${item.startTime ? ` ${item.startTime} – ${item.endTime}` : " toute la journée"}`).join(" · ") : "Non configuré"}</p></div>;
  })}</div>;
}

export function TeacherAvailabilityDrawer({ user, teacher, year, items, schoolDays, onClose }: { user: AppUser; teacher: StudyTeacher; year: SchoolYear; items: TeacherAvailability[]; schoolDays: StudyDay[]; onClose: () => void }) {
  const [drafts, setDrafts] = useState(() => initialDrafts(teacher.id, items, schoolDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasLegacyUnavailable = schoolDays.some((day) => drafts[day]?.legacyUnavailable);

  function updateDay(day: StudyDay, update: (current: DayDraft) => DayDraft) {
    setDrafts((current) => ({ ...current, [day]: update(current[day]) }));
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      await saveTeacherWeekAvailability({
        user,
        schoolId: teacher.schoolId,
        schoolYearId: year.id,
        teacherId: teacher.id,
        days: schoolDays.map((day) => ({
          dayOfWeek: day,
          status: drafts[day].status,
          ranges: drafts[day].status === "rest" || drafts[day].wholeDay ? [] : drafts[day].ranges,
        })),
        existing: items,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return <AdminDrawer title={`Configurer les disponibilités — ${teacher.fullName}`} closeLabel="Fermer" onClose={() => !busy && onClose()}>
    <p className="text-sm text-slate-600">Configurez toute la semaine, puis enregistrez une seule fois.</p>
    {hasLegacyUnavailable && <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Des indisponibilités historiques existent. Elles restent lisibles et seront remplacées par les choix Disponible ou Repos lors de cet enregistrement.</p>}
    <div className="grid gap-4" data-testid="weekly-availability-editor">
      {schoolDays.map((day) => {
        const draft = drafts[day];
        return <fieldset key={day} className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 font-bold text-slate-800">{DAY_LABELS[day]}</legend>
          <label className="grid gap-1 text-sm font-semibold">Statut
            <select className="input max-w-full" value={draft.status} onChange={(event) => updateDay(day, (current) => ({ ...current, status: event.target.value as EditableStatus, wholeDay: event.target.value === "rest" ? true : current.wholeDay, ranges: event.target.value === "rest" ? [] : current.ranges, legacyUnavailable: false }))}>
              <option value="available">Disponible</option>
              <option value="rest">Repos</option>
            </select>
          </label>
          {draft.status === "available" && <>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.wholeDay} onChange={(event) => updateDay(day, (current) => ({ ...current, wholeDay: event.target.checked, ranges: event.target.checked ? [] : current.ranges }))} />Toute la journée</label>
            {!draft.wholeDay && <div className="grid min-w-0 gap-2">
              {draft.ranges.map((range, index) => <div key={`${day}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <input aria-label={`Début ${DAY_LABELS[day]} ${index + 1}`} className="input min-w-0 max-w-full" type="time" value={range.startTime} onChange={(event) => updateDay(day, (current) => ({ ...current, ranges: current.ranges.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: event.target.value } : item) }))} />
                <input aria-label={`Fin ${DAY_LABELS[day]} ${index + 1}`} className="input min-w-0 max-w-full" type="time" value={range.endTime} onChange={(event) => updateDay(day, (current) => ({ ...current, ranges: current.ranges.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: event.target.value } : item) }))} />
                <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded border border-slate-200" aria-label={`Retirer la plage ${DAY_LABELS[day]} ${index + 1}`} onClick={() => updateDay(day, (current) => ({ ...current, ranges: current.ranges.filter((_, itemIndex) => itemIndex !== index) }))}><Trash2 className="h-4 w-4" /></button>
              </div>)}
              <button type="button" className="secondary-button justify-center" onClick={() => updateDay(day, (current) => ({ ...current, ranges: [...current.ranges, { startTime: "", endTime: "" }] }))}><Plus className="h-4 w-4" />Ajouter une plage</button>
            </div>}
          </>}
        </fieldset>;
      })}
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-2"><button type="button" className="secondary-button justify-center" disabled={busy} onClick={onClose}>Annuler</button><button type="button" className="primary-button justify-center" disabled={busy} onClick={() => void save()}>{busy ? "Enregistrement…" : "Enregistrer"}</button></div>
  </AdminDrawer>;
}
