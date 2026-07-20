import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import type { AppUser, AttendanceDaySchedule, AttendanceSchoolDay, AttendanceSettings, School, SchoolClass, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import { attendanceClassRuleKey, attendanceSchoolDayLabels, attendanceSchoolDays, attendanceSettingsId, defaultFiveSchoolDays, defaultSixSchoolDays, resolveAttendanceSchoolDays } from "../../utils/attendance";
import { getSchoolEducationLevels } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";

const resetConfirmationPhrase = "REINITIALISER LES HORAIRES";
const schoolDaysConfirmationPhrase = "MODIFIER LES JOURS SCOLAIRES";
const shortDayLabels: Record<AttendanceSchoolDay, string> = {
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
  saturday: "Sam",
};

type ResetTarget =
  | { scope: "default"; day: AttendanceSchoolDay; label: string }
  | { scope: "section"; day: AttendanceSchoolDay; section: SchoolSection; label: string }
  | { scope: "class"; day: AttendanceSchoolDay; classKey: string; label: string };

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
  const [resetTarget, setResetTarget] = useState<ResetTarget | null>(null);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [schoolDaysChangeTarget, setSchoolDaysChangeTarget] = useState<AttendanceSchoolDay[] | null>(null);
  const [schoolDaysConfirmation, setSchoolDaysConfirmation] = useState("");

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
  const displayedSchoolDays = schoolDaysChangeTarget ?? schoolDays;
  const schoolDaySet = useMemo(() => new Set(displayedSchoolDays), [displayedSchoolDays]);
  const weekMode = schoolDays.includes("saturday") ? "6" : "5";
  const displayedWeekMode = displayedSchoolDays.includes("saturday") ? "6" : "5";
  const pendingWeekMode = schoolDaysChangeTarget?.includes("saturday") ? "6" : "5";

  async function saveSettings() {
    setSaving(true);
    setFeedback("");
    try {
      await onSave(buildSettings(schoolDays, defaultSchedule, sectionSchedule, classSchedule, school.id, year.id, user.id));
      setFeedback("Paramètres de présence enregistrés.");
    } catch (error) {
      console.warn("Enregistrement des paramètres de présence impossible.", error);
      setFeedback("Impossible d'enregistrer les paramètres de présence.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSchoolDaysChange() {
    if (!schoolDaysChangeTarget || schoolDaysConfirmation !== schoolDaysConfirmationPhrase) return;

    setSaving(true);
    setFeedback("");
    try {
      await onSave(buildSettings(schoolDaysChangeTarget, defaultSchedule, sectionSchedule, classSchedule, school.id, year.id, user.id));
      setSchoolDays(schoolDaysChangeTarget);
      setSchoolDaysChangeTarget(null);
      setSchoolDaysConfirmation("");
      setFeedback("Jours scolaires modifiés.");
    } catch (error) {
      console.warn("Modification des jours scolaires impossible.", error);
      setFeedback("Impossible de modifier les jours scolaires.");
    } finally {
      setSaving(false);
    }
  }

  async function resetDaySchedules() {
    if (!resetTarget || resetConfirmation !== resetConfirmationPhrase) return;

    setSaving(true);
    setFeedback("");
    try {
      const nextDefaultSchedule = resetTarget.scope === "default" ? removeScheduleDay(defaultSchedule, resetTarget.day) : defaultSchedule;
      const nextSectionSchedule = resetTarget.scope === "section" ? removeSectionScheduleDay(sectionSchedule, resetTarget.section, resetTarget.day) : sectionSchedule;
      const nextClassSchedule = resetTarget.scope === "class" ? removeClassScheduleDay(classSchedule, resetTarget.classKey, resetTarget.day) : classSchedule;
      await onSave(buildSettings(schoolDays, nextDefaultSchedule, nextSectionSchedule, nextClassSchedule, school.id, year.id, user.id));
      setDefaultSchedule(nextDefaultSchedule);
      setSectionSchedule(nextSectionSchedule);
      setClassSchedule(nextClassSchedule);
      const dayLabel = attendanceSchoolDayLabels[resetTarget.day];
      const scopeLabel = resetTarget.label;
      setResetTarget(null);
      setResetConfirmation("");
      setFeedback(`Horaires du ${dayLabel} réinitialisés dans ${scopeLabel}.`);
    } catch (error) {
      console.warn("Réinitialisation des horaires de présence impossible.", error);
      setFeedback("Impossible de réinitialiser les horaires de présence.");
    } finally {
      setSaving(false);
    }
  }

  function requestSchoolDaysChange(nextDays: AttendanceSchoolDay[]) {
    const normalizedDays = attendanceSchoolDays.filter((day) => nextDays.includes(day));
    if (normalizedDays.length === 0 || sameSchoolDays(normalizedDays, schoolDays)) return;
    setSchoolDaysChangeTarget(normalizedDays);
    setSchoolDaysConfirmation("");
    setFeedback("");
  }

  function applyWeekMode(mode: "5" | "6") {
    requestSchoolDaysChange(mode === "5" ? defaultFiveSchoolDays : defaultSixSchoolDays);
  }

  function toggleSchoolDay(day: AttendanceSchoolDay) {
    const next = displayedSchoolDays.includes(day) ? displayedSchoolDays.filter((item) => item !== day) : attendanceSchoolDays.filter((item) => displayedSchoolDays.includes(item) || item === day);
    requestSchoolDaysChange(next.length > 0 ? next : schoolDays);
  }

  function openResetConfirmation(target: ResetTarget) {
    setResetTarget(target);
    setResetConfirmation("");
    setFeedback("");
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
          <button onClick={() => applyWeekMode("5")} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${displayedWeekMode === "5" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
            5 jours par semaine
          </button>
          <button onClick={() => applyWeekMode("6")} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${displayedWeekMode === "6" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
            6 jours par semaine
          </button>
        </div>
        {schoolDaysChangeTarget && (
          <section className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">Confirmer la modification des jours scolaires</p>
            <p>Vous êtes sur le point de modifier les jours scolaires de {weekMode} jours à {pendingWeekMode} jours.</p>
            <p>
              Les jours affichés deviendront : {formatSchoolDayList(schoolDaysChangeTarget)}. Les présences historiques ne seront pas supprimées et les horaires des jours retirés resteront conservés.
            </p>
            <label className="grid gap-1 font-semibold">
              Pour confirmer, saisissez : {schoolDaysConfirmationPhrase}
              <input value={schoolDaysConfirmation} onChange={(event) => setSchoolDaysConfirmation(event.target.value)} className="input bg-white" />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={saveSchoolDaysChange} disabled={saving || schoolDaysConfirmation !== schoolDaysConfirmationPhrase} className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
                Confirmer la modification
              </button>
              <button
                onClick={() => {
                  setSchoolDaysChangeTarget(null);
                  setSchoolDaysConfirmation("");
                }}
                disabled={saving}
                className="rounded border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-100"
                type="button"
              >
                Annuler
              </button>
            </div>
          </section>
        )}
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {attendanceSchoolDays.map((day) => (
            <label key={day} className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
              <input checked={schoolDaySet.has(day)} onChange={() => toggleSchoolDay(day)} type="checkbox" className="h-4 w-4 accent-mint" />
              {shortDayLabels[day]}
            </label>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Règle générale</h2>
          <p className="mt-1 text-sm text-slate-500">Utilisée quand aucune règle de classe ou de section ne s'applique.</p>
        </div>
        <ScheduleGrid
          days={displayedSchoolDays}
          schedule={defaultSchedule}
          onChange={updateDefaultSchedule}
          onReset={(day) => openResetConfirmation({ scope: "default", day, label: "Règle générale" })}
          resetTarget={resetTarget?.scope === "default" ? resetTarget : null}
          resetConfirmation={resetConfirmation}
          saving={saving}
          onResetConfirmationChange={setResetConfirmation}
          onConfirmReset={resetDaySchedules}
          onCancelReset={() => {
            setResetTarget(null);
            setResetConfirmation("");
          }}
        />
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
              <ScheduleGrid
                days={displayedSchoolDays}
                schedule={sectionSchedule[section] ?? {}}
                onChange={(day, field, value) => updateSectionSchedule(section, day, field, value)}
                onReset={(day) => openResetConfirmation({ scope: "section", day, section, label: `Par section - ${sectionLabels[section]}` })}
                resetTarget={resetTarget?.scope === "section" && resetTarget.section === section ? resetTarget : null}
                resetConfirmation={resetConfirmation}
                saving={saving}
                onResetConfirmationChange={setResetConfirmation}
                onConfirmReset={resetDaySchedules}
                onCancelReset={() => {
                  setResetTarget(null);
                  setResetConfirmation("");
                }}
              />
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
                <ScheduleGrid
                  days={displayedSchoolDays}
                  schedule={classSchedule[rule.key] ?? {}}
                  onChange={(day, field, value) => updateClassSchedule(rule.key, day, field, value)}
                  onReset={(day) => openResetConfirmation({ scope: "class", day, classKey: rule.key, label: `Par classe - ${rule.option ? `${rule.className} - ${rule.option}` : rule.className}` })}
                  resetTarget={resetTarget?.scope === "class" && resetTarget.classKey === rule.key ? resetTarget : null}
                  resetConfirmation={resetConfirmation}
                  saving={saving}
                  onResetConfirmationChange={setResetConfirmation}
                  onConfirmReset={resetDaySchedules}
                  onCancelReset={() => {
                    setResetTarget(null);
                    setResetConfirmation("");
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </section>


      <button onClick={saveSettings} disabled={saving} className="primary-button justify-center disabled:cursor-not-allowed disabled:opacity-50" type="button">
        <CheckCircle2 className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer les paramètres"}
      </button>
    </div>
  );
}

function ScheduleGrid({
  days,
  schedule,
  onChange,
  onReset,
  resetTarget,
  resetConfirmation,
  saving,
  onResetConfirmationChange,
  onConfirmReset,
  onCancelReset,
}: {
  days: AttendanceSchoolDay[];
  schedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>;
  onChange: (day: AttendanceSchoolDay, field: keyof AttendanceDaySchedule, value: string) => void;
  onReset: (day: AttendanceSchoolDay) => void;
  resetTarget: ResetTarget | null;
  resetConfirmation: string;
  saving: boolean;
  onResetConfirmationChange: (value: string) => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
}) {
  return (
    <div className="grid gap-2">
      {days.map((day) => (
        <div key={day} className="grid gap-2">
          <div className="grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-center">
            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-bold text-slate-600">
              <button onClick={() => onReset(day)} type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-mint hover:text-mint" aria-label={`Réinitialiser ${attendanceSchoolDayLabels[day]}`}>
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <span>{shortDayLabels[day]}</span>
            </span>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Heure limite
              <input type="time" value={schedule[day]?.lateAfter ?? schedule[day]?.normalArrival ?? ""} onChange={(event) => onChange(day, "lateAfter", event.target.value)} className="input" aria-label={`Heure limite ${attendanceSchoolDayLabels[day]}`} />
            </label>
          </div>
          {resetTarget?.day === day && (
            <section className="grid gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">Réinitialiser les horaires du {attendanceSchoolDayLabels[day]} dans {resetTarget.label}</p>
              <p>Cette action ne modifie pas les autres jours, les autres niveaux de règle ni les présences existantes.</p>
              <label className="grid gap-1 font-semibold">
                Pour confirmer, saisissez : {resetConfirmationPhrase}
                <input value={resetConfirmation} onChange={(event) => onResetConfirmationChange(event.target.value)} className="input bg-white" />
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button onClick={onConfirmReset} disabled={saving || resetConfirmation !== resetConfirmationPhrase} className="rounded bg-amber-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50" type="button">
                  Confirmer
                </button>
                <button onClick={onCancelReset} disabled={saving} className="rounded border border-amber-200 bg-white px-4 py-2 text-sm font-bold text-amber-800 transition hover:bg-amber-100" type="button">
                  Annuler
                </button>
              </div>
            </section>
          )}
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
  if (field === "lateAfter") {
    return {
      ...current,
      [day]: {
        lateAfter: value,
      },
    };
  }
  return {
    ...current,
    [day]: {
      ...(current[day] ?? {}),
      [field]: value,
    },
  };
}

function removeScheduleDay(schedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>, day: AttendanceSchoolDay) {
  const nextSchedule = { ...schedule };
  delete nextSchedule[day];
  return nextSchedule;
}

function removeSectionScheduleDay(schedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>, section: SchoolSection, day: AttendanceSchoolDay) {
  const nextSectionSchedule = removeScheduleDay(schedule[section] ?? {}, day);
  const nextSchedule = { ...schedule };
  if (Object.keys(nextSectionSchedule).length > 0) {
    nextSchedule[section] = nextSectionSchedule;
  } else {
    delete nextSchedule[section];
  }
  return nextSchedule;
}

function removeClassScheduleDay(schedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>, classKey: string, day: AttendanceSchoolDay) {
  const nextClassSchedule = removeScheduleDay(schedule[classKey] ?? {}, day);
  const nextSchedule = { ...schedule };
  if (Object.keys(nextClassSchedule).length > 0) {
    nextSchedule[classKey] = nextClassSchedule;
  } else {
    delete nextSchedule[classKey];
  }
  return nextSchedule;
}

function cleanSchedule(schedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>) {
  const cleaned: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>> = {};
  (Object.entries(schedule) as [AttendanceSchoolDay, AttendanceDaySchedule][]).forEach(([day, value]) => {
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

function cleanSectionSchedule(schedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>) {
  return Object.fromEntries(
    Object.entries(schedule)
      .map(([section, value]) => [section, cleanSchedule(value ?? {})])
      .filter(([, value]) => Object.keys(value).length > 0),
  ) as Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>;
}

function cleanClassSchedule(schedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>) {
  return Object.fromEntries(
    Object.entries(schedule)
      .map(([ruleKey, value]) => [ruleKey, cleanSchedule(value)])
      .filter(([, value]) => Object.keys(value).length > 0),
  ) as Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>;
}

function buildSettings(
  schoolDays: AttendanceSchoolDay[],
  defaultSchedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>,
  sectionSchedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>,
  classSchedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>,
  schoolId: string,
  schoolYearId: string,
  userId: string,
): AttendanceSettings {
  return {
    id: attendanceSettingsId(schoolId, schoolYearId),
    schoolId,
    schoolYearId,
    schoolDays,
    defaultSchedule: cleanSchedule(defaultSchedule),
    sectionSchedule: cleanSectionSchedule(sectionSchedule),
    classSchedule: cleanClassSchedule(classSchedule),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
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

function sameSchoolDays(first: AttendanceSchoolDay[], second: AttendanceSchoolDay[]) {
  return first.length === second.length && first.every((day, index) => day === second[index]);
}

function formatSchoolDayList(days: AttendanceSchoolDay[]) {
  return days.map((day) => attendanceSchoolDayLabels[day]).join(", ");
}
