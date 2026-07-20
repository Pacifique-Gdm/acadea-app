import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import type { AppUser, AttendanceDaySchedule, AttendanceSchoolDay, AttendanceSettings, School, SchoolClass, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import { attendanceClassRuleKey, attendanceSchoolDayLabels, attendanceSchoolDays, attendanceSettingsId, defaultFiveSchoolDays, defaultSixSchoolDays, resolveAttendanceSchoolDays } from "../../utils/attendance";
import { getSchoolEducationLevels } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";

export function AttendanceSettingsDrawer({
  school,
  year,
  user,
  students,
  settings,
  onSave,
}: {
  school: School;
  year: SchoolYear;
  user: AppUser;
  students: Student[];
  settings?: AttendanceSettings;
  onSave: (settings: AttendanceSettings) => Promise<void>;
}) {
  const [schoolDays, setSchoolDays] = useState<AttendanceSchoolDay[]>(() => resolveAttendanceSchoolDays(settings));
  const [defaultSchedule, setDefaultSchedule] = useState<Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>(() => buildDefaultSchedule(settings));
  const [sectionSchedule, setSectionSchedule] = useState<Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>>(
    () => buildSectionSchedule(settings),
  );
  const [classSchedule, setClassSchedule] = useState<Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>(() => buildClassSchedule(settings));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);

  useEffect(() => {
    setSchoolDays(resolveAttendanceSchoolDays(settings));
    setDefaultSchedule(buildDefaultSchedule(settings));
    setSectionSchedule(buildSectionSchedule(settings));
    setClassSchedule(buildClassSchedule(settings));
  }, [settings]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const sectionLabels: Record<SchoolSection, string> = {
    maternelle: "Maternelle",
    primaire: "Primaire",
    secondaire: "Secondaire",
  };
  const sections = useMemo(() => {
    const levels = getSchoolEducationLevels(school);
    const choices = [
      levels.includes("Maternelle") ? "maternelle" : "",
      levels.includes("Primaire") ? "primaire" : "",
      levels.includes("Secondaire") ? "secondaire" : "",
    ].filter(Boolean) as SchoolSection[];
    return choices.length > 0 ? choices : (["maternelle", "primaire", "secondaire"] as SchoolSection[]);
  }, [school]);
  const classRules = useMemo(() => {
    const rules = new Map<string, { key: string; className: SchoolClass; option?: string; section: SchoolSection }>();
    students
      .filter((student) => student.schoolId === school.id && student.schoolYearId === year.id)
      .forEach((student) => {
        const key = attendanceClassRuleKey(student.className, student.option);
        if (!rules.has(key)) {
          rules.set(key, {
            key,
            className: student.className,
            option: student.option,
            section: getClassSection(student.className),
          });
        }
      });
    return Array.from(rules.values()).sort((first, second) => {
      const sectionOrder: Record<SchoolSection, number> = { maternelle: 0, primaire: 1, secondaire: 2 };
      const sectionDiff = sectionOrder[first.section] - sectionOrder[second.section];
      if (sectionDiff !== 0) return sectionDiff;
      const classDiff = CLASSES.indexOf(first.className) - CLASSES.indexOf(second.className);
      if (classDiff !== 0) return classDiff;
      return (first.option ?? "").localeCompare(second.option ?? "", "fr");
    });
  }, [school.id, students, year.id]);
  const schoolDaySet = useMemo(() => new Set(schoolDays), [schoolDays]);
  const weekMode = schoolDays.includes("saturday") ? "6" : "5";

  async function saveSettings() {
    setSaving(true);
    setFeedback("");
    try {
      const nextSettings: AttendanceSettings = {
        id: attendanceSettingsId(school.id, year.id),
        schoolId: school.id,
        schoolYearId: year.id,
        schoolDays,
        defaultSchedule: cleanSchedule(defaultSchedule, schoolDays),
        sectionSchedule: cleanSectionSchedule(sectionSchedule, schoolDays),
        classSchedule: cleanClassSchedule(classSchedule, schoolDays),
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };
      await onSave(nextSettings);
      setFeedback("Paramètres de présence enregistrés.");
    } catch (error) {
      console.warn("Enregistrement des paramètres de présence impossible.", error);
      setFeedback("Impossible d'enregistrer les paramètres de présence.");
    } finally {
      setSaving(false);
    }
  }

  async function resetSchedules() {
    setSaving(true);
    setFeedback("");
    try {
      const nextSettings: AttendanceSettings = {
        id: attendanceSettingsId(school.id, year.id),
        schoolId: school.id,
        schoolYearId: year.id,
        schoolDays,
        defaultSchedule: {},
        sectionSchedule: {},
        classSchedule: {},
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };
      await onSave(nextSettings);
      setDefaultSchedule({});
      setSectionSchedule({});
      setClassSchedule({});
      setResetConfirmationOpen(false);
      setFeedback("Horaires réinitialisés. Les heures doivent être redéfinies.");
    } catch (error) {
      console.warn("Réinitialisation des horaires de présence impossible.", error);
      setFeedback("Impossible de réinitialiser les horaires de présence.");
    } finally {
      setSaving(false);
    }
  }

  function applyWeekMode(mode: "5" | "6") {
    setSchoolDays(mode === "5" ? defaultFiveSchoolDays : defaultSixSchoolDays);
  }

  function toggleSchoolDay(day: AttendanceSchoolDay) {
    setSchoolDays((current) => {
      const next = current.includes(day) ? current.filter((item) => item !== day) : attendanceSchoolDays.filter((item) => current.includes(item) || item === day);
      return next.length > 0 ? next : current;
    });
  }

  function updateDefaultSchedule(day: AttendanceSchoolDay, field: keyof AttendanceDaySchedule, value: string) {
    setDefaultSchedule((current) => updateScheduleMap(current, day, field, value));
  }

  function updateSectionSchedule(section: SchoolSection, day: AttendanceSchoolDay, field: keyof AttendanceDaySchedule, value: string) {
    setSectionSchedule((current) => ({
      ...current,
      [section]: updateScheduleMap(current[section] ?? {}, day, field, value),
    }));
  }

  function updateClassSchedule(ruleKey: string, day: AttendanceSchoolDay, field: keyof AttendanceDaySchedule, value: string) {
    setClassSchedule((current) => ({
      ...current,
      [ruleKey]: updateScheduleMap(current[ruleKey] ?? {}, day, field, value),
    }));
  }

  return (
    <div className="grid min-w-0 gap-5">
      {feedback && (
        <p className={`rounded border p-3 text-sm font-semibold ${feedback.includes("Impossible") ? "border-red-200 bg-red-50 text-red-700" : "border-mint/30 bg-mint/10 text-mint"}`}>
          {feedback}
        </p>
      )}
      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Jours scolaires</h2>
          <p className="mt-1 text-sm text-slate-500">Cette configuration pilote la fiche hebdomadaire et l'export PDF.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => applyWeekMode("5")} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${weekMode === "5" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
            5 jours par semaine
          </button>
          <button onClick={() => applyWeekMode("6")} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${weekMode === "6" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
            6 jours par semaine
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {attendanceSchoolDays.map((day) => (
            <label key={day} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
              <input checked={schoolDaySet.has(day)} onChange={() => toggleSchoolDay(day)} type="checkbox" className="h-4 w-4 accent-mint" />
              {attendanceSchoolDayLabels[day]}
            </label>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Règle générale</h2>
          <p className="mt-1 text-sm text-slate-500">Utilisée quand aucune règle de classe ou de section ne s'applique.</p>
        </div>
        <ScheduleGrid days={schoolDays} schedule={defaultSchedule} onChange={updateDefaultSchedule} />
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Par section</h2>
          <p className="mt-1 text-sm text-slate-500">La règle de section est utilisée si aucune règle précise de classe n'existe.</p>
        </div>
        <div className="grid gap-3">
          {sections.map((section) => (
            <div key={section} className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-bold text-ink">{sectionLabels[section]}</p>
              <ScheduleGrid days={schoolDays} schedule={sectionSchedule[section] ?? {}} onChange={(day, field, value) => updateSectionSchedule(section, day, field, value)} />
            </div>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Par classe</h2>
          <p className="mt-1 text-sm text-slate-500">Une règle de classe est prioritaire sur la règle de sa section.</p>
        </div>
        {classRules.length === 0 ? (
          <p className="rounded border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">Aucune classe avec élève n'est disponible pour cette année.</p>
        ) : (
          <div className="grid gap-2">
            {classRules.map((rule) => (
              <div key={rule.key} className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                <span className="min-w-0 break-words font-bold text-ink">{rule.option ? `${rule.className} - ${rule.option}` : rule.className}</span>
                <ScheduleGrid days={schoolDays} schedule={classSchedule[rule.key] ?? {}} onChange={(day, field, value) => updateClassSchedule(rule.key, day, field, value)} />
              </div>
            ))}
          </div>
        )}
      </section>

      {resetConfirmationOpen && (
        <section className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-bold">Confirmer la réinitialisation des horaires</p>
          <p>Cette action efface uniquement les horaires généraux, par section et par classe. Les présences existantes sont conservées.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button onClick={resetSchedules} disabled={saving} className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
              Confirmer la réinitialisation
            </button>
            <button onClick={() => setResetConfirmationOpen(false)} disabled={saving} className="rounded border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-100" type="button">
              Annuler
            </button>
          </div>
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <button onClick={saveSettings} disabled={saving} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
          <CheckCircle2 className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer les paramètres"}
        </button>
        <button onClick={() => setResetConfirmationOpen(true)} disabled={saving} className="secondary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
          <RotateCcw className="h-4 w-4" /> Réinitialiser les horaires
        </button>
      </div>
    </div>
  );
}

function ScheduleGrid({
  days,
  schedule,
  onChange,
}: {
  days: AttendanceSchoolDay[];
  schedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>;
  onChange: (day: AttendanceSchoolDay, field: keyof AttendanceDaySchedule, value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {days.map((day) => (
        <div key={day} className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
          <span className="text-sm font-bold text-slate-600">{attendanceSchoolDayLabels[day]}</span>
          <input type="time" value={schedule[day]?.normalArrival ?? ""} onChange={(event) => onChange(day, "normalArrival", event.target.value)} className="input" aria-label={`Heure normale ${attendanceSchoolDayLabels[day]}`} />
          <input type="time" value={schedule[day]?.lateAfter ?? ""} onChange={(event) => onChange(day, "lateAfter", event.target.value)} className="input" aria-label={`Seuil de retard ${attendanceSchoolDayLabels[day]}`} />
        </div>
      ))}
    </div>
  );
}

function updateScheduleMap(
  current: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>,
  day: AttendanceSchoolDay,
  field: keyof AttendanceDaySchedule,
  value: string,
) {
  return {
    ...current,
    [day]: {
      ...(current[day] ?? {}),
      [field]: value,
    },
  };
}

function cleanSchedule(schedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>, activeDays: AttendanceSchoolDay[]) {
  const cleaned: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>> = {};
  (Object.entries(schedule) as [AttendanceSchoolDay, AttendanceDaySchedule][]).forEach(([day, value]) => {
    if (!activeDays.includes(day)) return;
    const nextValue: AttendanceDaySchedule = {
      ...(value.normalArrival ? { normalArrival: value.normalArrival } : {}),
      ...(value.lateAfter ? { lateAfter: value.lateAfter } : {}),
    };
    if (nextValue.normalArrival || nextValue.lateAfter) {
      cleaned[day] = nextValue;
    }
  });
  return cleaned;
}

function cleanSectionSchedule(schedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>, activeDays: AttendanceSchoolDay[]) {
  return Object.fromEntries(
    Object.entries(schedule)
      .map(([section, value]) => [section, cleanSchedule(value ?? {}, activeDays)])
      .filter(([, value]) => Object.keys(value).length > 0),
  ) as Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>;
}

function cleanClassSchedule(schedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>, activeDays: AttendanceSchoolDay[]) {
  return Object.fromEntries(
    Object.entries(schedule)
      .map(([ruleKey, value]) => [ruleKey, cleanSchedule(value, activeDays)])
      .filter(([, value]) => Object.keys(value).length > 0),
  ) as Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>;
}

function buildDefaultSchedule(settings?: AttendanceSettings): Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>> {
  if (settings?.defaultSchedule) return settings.defaultSchedule;
  if (!settings?.defaultLateAfter) return {};
  return Object.fromEntries(resolveAttendanceSchoolDays(settings).map((day) => [day, { lateAfter: settings.defaultLateAfter }])) as Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>;
}

function buildSectionSchedule(settings?: AttendanceSettings): Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>> {
  if (settings?.sectionSchedule) return settings.sectionSchedule;
  const legacy = settings?.sectionLateAfter ?? {};
  return Object.fromEntries(
    Object.entries(legacy).map(([section, lateAfter]) => [
      section,
      Object.fromEntries(resolveAttendanceSchoolDays(settings).map((day) => [day, { lateAfter }])),
    ]),
  ) as Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>;
}

function buildClassSchedule(settings?: AttendanceSettings): Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>> {
  if (settings?.classSchedule) return settings.classSchedule;
  const legacy = settings?.classLateAfter ?? {};
  return Object.fromEntries(
    Object.entries(legacy).map(([ruleKey, lateAfter]) => [
      ruleKey,
      Object.fromEntries(resolveAttendanceSchoolDays(settings).map((day) => [day, { lateAfter }])),
    ]),
  ) as Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>;
}
