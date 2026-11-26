import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import type { AppUser, AttendanceDaySchedule, AttendanceSchoolDay, AttendanceSettings, School, SchoolClass, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import { attendanceClassRuleKey, attendanceSchoolDayLabels, attendanceSchoolDays, attendanceSettingsId, defaultFiveSchoolDays, defaultSixSchoolDays, resolveAttendanceSchoolDays } from "../../utils/attendance";
import { getSchoolSections, schoolSectionLabels, schoolSectionOrder } from "../../utils/schoolConfig";
import { getClassSection } from "../../utils/studentClasses";
import { userSectionIds } from "../../utils/userSections";
import { ModifiedBy } from "../ui/ModifiedBy";

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

type SectionSchoolDays = Partial<Record<SchoolSection, AttendanceSchoolDay[]>>;

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
  const [sectionSchoolDays, setSectionSchoolDays] = useState<SectionSchoolDays>(() => buildSectionSchoolDays(settings));
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
    setSectionSchoolDays(buildSectionSchoolDays(settings));
  }, [settings]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(""), 3500);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Un Directeur de discipline rattaché à des sections ne modifie que celles-ci ;
  // sans section, il modifie toute l'école comme avant.
  const ownSections = useMemo(() => userSectionIds(user), [user]);
  const sectionLimited = ownSections.length > 0;
  const canEditSection = (section: SchoolSection) => !sectionLimited || ownSections.includes(section);

  function composeSettings(
    nextSchoolDays: AttendanceSchoolDay[],
    nextDefaultSchedule: Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>,
    nextSectionSchedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>,
    nextClassSchedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>,
    nextSectionSchoolDays: SectionSchoolDays,
  ) {
    if (sectionLimited) {
      return buildSectionLimitedSettings(settings, ownSections, nextSectionSchedule, nextClassSchedule, nextSectionSchoolDays, school.id, year.id, user.id);
    }
    return buildSettings(nextSchoolDays, nextDefaultSchedule, nextSectionSchedule, nextClassSchedule, nextSectionSchoolDays, school.id, year.id, user.id);
  }

  function saveErrorMessage(base: string) {
    return sectionLimited
      ? `${base} Les réglages ont peut-être été modifiés entre-temps par un autre Directeur de discipline : rechargez avec la flèche ronde de l'en-tête, puis recommencez.`
      : base;
  }

  const sections = useMemo(() => {
    const choices = getSchoolSections(school);
    return choices.length > 0 ? choices : schoolSectionOrder;
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
      const sectionDiff = schoolSectionOrder.indexOf(first.section) - schoolSectionOrder.indexOf(second.section);
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
  const sectionDays = (section: SchoolSection) => sectionSchoolDays[section]?.length ? attendanceSchoolDays.filter((day) => sectionSchoolDays[section]?.includes(day)) : displayedSchoolDays;

  async function saveSettings() {
    setSaving(true);
    setFeedback("");
    try {
      await onSave(composeSettings(schoolDays, defaultSchedule, sectionSchedule, classSchedule, sectionSchoolDays));
      setFeedback("Paramètres de présence enregistrés.");
    } catch (error) {
      console.warn("Enregistrement des paramètres de présence impossible.", error);
      setFeedback(saveErrorMessage("Impossible d'enregistrer les paramètres de présence."));
    } finally {
      setSaving(false);
    }
  }

  async function saveSchoolDaysChange() {
    if (sectionLimited || !schoolDaysChangeTarget || schoolDaysConfirmation !== schoolDaysConfirmationPhrase) return;

    setSaving(true);
    setFeedback("");
    try {
      await onSave(composeSettings(schoolDaysChangeTarget, defaultSchedule, sectionSchedule, classSchedule, sectionSchoolDays));
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
      await onSave(composeSettings(schoolDays, nextDefaultSchedule, nextSectionSchedule, nextClassSchedule, sectionSchoolDays));
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
      setFeedback(saveErrorMessage("Impossible de réinitialiser les horaires de présence."));
    } finally {
      setSaving(false);
    }
  }

  function requestSchoolDaysChange(nextDays: AttendanceSchoolDay[]) {
    if (sectionLimited) return;
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

  function updateSectionSchoolDays(section: SchoolSection, mode: string) {
    if (!canEditSection(section)) return;
    setSectionSchoolDays((current) => {
      const next = { ...current };
      if (mode === "5") next[section] = [...defaultFiveSchoolDays];
      else if (mode === "6") next[section] = [...defaultSixSchoolDays];
      else if (mode === "school") delete next[section];
      return next;
    });
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
          <p className="mt-1 text-sm text-slate-500">Cette configuration pilote la fiche hebdomadaire et l'export PDF. Elle vaut pour les sections qui n'ont pas leurs propres jours de cours.</p>
          {sectionLimited && <p className="mt-1 text-sm font-semibold text-slate-600">Lecture seule : les jours de l'école se règlent par un Directeur de discipline sans section. Vous réglez les jours de vos sections plus bas.</p>}
          {settings?.updatedBy && <ModifiedBy userId={settings.updatedBy} schoolId={school.id} at={settings.updatedAt} />}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button onClick={() => applyWeekMode("5")} disabled={sectionLimited} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${displayedWeekMode === "5" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
            5 jours par semaine
          </button>
          <button onClick={() => applyWeekMode("6")} disabled={sectionLimited} type="button" className={`rounded border px-3 py-2 text-sm font-bold transition ${displayedWeekMode === "6" ? "border-mint bg-mint/10 text-mint" : "border-slate-200 bg-white text-slate-600 hover:border-mint"}`}>
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
              <input checked={schoolDaySet.has(day)} onChange={() => toggleSchoolDay(day)} disabled={sectionLimited} type="checkbox" className="h-4 w-4 accent-mint" />
              {shortDayLabels[day]}
            </label>
          ))}
        </div>
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Règle générale</h2>
          <p className="mt-1 text-sm text-slate-500">Utilisée quand aucune règle de classe ou de section ne s'applique.</p>
          {sectionLimited && <p className="mt-1 text-sm font-semibold text-slate-600">Lecture seule : réglée par un Directeur de discipline sans section.</p>}
        </div>
        <ScheduleGrid
          days={displayedSchoolDays}
          readOnly={sectionLimited}
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
              <p className="text-sm font-bold text-ink">{schoolSectionLabels[section]}</p>
              {!canEditSection(section) && <p className="text-xs font-semibold text-slate-500">Lecture seule : section réglée par son Directeur de discipline.</p>}
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Jours de cours de la section
                <select
                  value={sectionDaysMode(sectionSchoolDays[section])}
                  onChange={(event) => updateSectionSchoolDays(section, event.target.value)}
                  disabled={!canEditSection(section)}
                  className="input"
                  aria-label={`Jours de cours ${schoolSectionLabels[section]}`}
                >
                  <option value="school">Comme l'école ({formatSchoolDayList(displayedSchoolDays)})</option>
                  <option value="5">5 jours (lundi à vendredi)</option>
                  <option value="6">6 jours (lundi à samedi)</option>
                  {sectionDaysMode(sectionSchoolDays[section]) === "custom" && <option value="custom">Autres jours ({formatSchoolDayList(sectionDays(section))})</option>}
                </select>
                <span className="font-normal">Ces jours sont repris automatiquement par l'horaire des classes de la section.</span>
              </label>
              <ScheduleGrid
                days={sectionDays(section)}
                readOnly={!canEditSection(section)}
                schedule={sectionSchedule[section] ?? {}}
                onChange={(day, field, value) => updateSectionSchedule(section, day, field, value)}
                onReset={(day) => openResetConfirmation({ scope: "section", day, section, label: `Par section - ${schoolSectionLabels[section]}` })}
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
                {!canEditSection(rule.section) && <span className="text-xs font-semibold text-slate-500">Lecture seule : section réglée par son Directeur de discipline.</span>}
                <ScheduleGrid
                  days={sectionDays(rule.section)}
                  readOnly={!canEditSection(rule.section)}
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
  readOnly = false,
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
  readOnly?: boolean;
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
              {!readOnly && <button onClick={() => onReset(day)} type="button" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-mint hover:text-mint" aria-label={`Réinitialiser ${attendanceSchoolDayLabels[day]}`}>
                <RotateCcw className="h-3.5 w-3.5" />
              </button>}
              <span>{attendanceSchoolDayLabels[day]}</span>
            </span>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Heure limite
              <input type="time" value={schedule[day]?.lateAfter ?? schedule[day]?.normalArrival ?? ""} onChange={(event) => onChange(day, "lateAfter", event.target.value)} disabled={readOnly} className="input" aria-label={`Heure limite ${attendanceSchoolDayLabels[day]}`} />
            </label>
          </div>
          {!readOnly && resetTarget?.day === day && (
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
  sectionSchoolDays: SectionSchoolDays,
  schoolId: string,
  schoolYearId: string,
  userId: string,
): AttendanceSettings {
  const cleanedSectionSchoolDays = cleanSectionSchoolDays(sectionSchoolDays);
  return {
    id: attendanceSettingsId(schoolId, schoolYearId),
    schoolId,
    schoolYearId,
    schoolDays,
    // Absent tant qu'aucune section n'a ses propres jours : le document reste comme avant.
    ...(Object.keys(cleanedSectionSchoolDays).length > 0 ? { sectionSchoolDays: cleanedSectionSchoolDays } : {}),
    defaultSchedule: cleanSchedule(defaultSchedule),
    sectionSchedule: cleanSectionSchedule(sectionSchedule),
    classSchedule: cleanClassSchedule(classSchedule),
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
}

/**
 * Enregistrement d'un Directeur de discipline rattaché à des sections : on repart
 * du document tel qu'il est, et seules SES sections (heures de section, jours de
 * section, règles des classes de ses sections) sont remplacées. Les autres
 * sections et les réglages de l'école restent strictement identiques.
 */
export function buildSectionLimitedSettings(
  settings: AttendanceSettings | undefined,
  ownSections: SchoolSection[],
  sectionSchedule: Partial<Record<SchoolSection, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>>,
  classSchedule: Record<string, Partial<Record<AttendanceSchoolDay, AttendanceDaySchedule>>>,
  sectionSchoolDays: SectionSchoolDays,
  schoolId: string,
  schoolYearId: string,
  userId: string,
): AttendanceSettings {
  const nextSectionSchedule = { ...(settings?.sectionSchedule ?? {}) };
  const nextSectionSchoolDays = { ...(settings?.sectionSchoolDays ?? {}) };
  ownSections.forEach((section) => {
    const cleaned = cleanSchedule(sectionSchedule[section] ?? {});
    if (Object.keys(cleaned).length > 0) nextSectionSchedule[section] = cleaned;
    else delete nextSectionSchedule[section];
    const days = attendanceSchoolDays.filter((day) => sectionSchoolDays[section]?.includes(day));
    if (days.length > 0) nextSectionSchoolDays[section] = days;
    else delete nextSectionSchoolDays[section];
  });
  const nextClassSchedule = { ...(settings?.classSchedule ?? {}) };
  const ownClassKey = (key: string) => ownSections.includes(getClassSection(key.split("__")[0] as SchoolClass));
  new Set([...Object.keys(nextClassSchedule), ...Object.keys(classSchedule)]).forEach((key) => {
    if (!ownClassKey(key)) return;
    const cleaned = cleanSchedule(classSchedule[key] ?? {});
    if (Object.keys(cleaned).length > 0) nextClassSchedule[key] = cleaned;
    else delete nextClassSchedule[key];
  });
  return {
    ...(settings ?? {}),
    id: settings?.id ?? attendanceSettingsId(schoolId, schoolYearId),
    schoolId: settings?.schoolId ?? schoolId,
    schoolYearId: settings?.schoolYearId ?? schoolYearId,
    sectionSchedule: nextSectionSchedule,
    sectionSchoolDays: nextSectionSchoolDays,
    classSchedule: nextClassSchedule,
    updatedAt: new Date().toISOString(),
    updatedBy: userId,
  };
}

function cleanSectionSchoolDays(value: SectionSchoolDays): SectionSchoolDays {
  return Object.fromEntries(
    Object.entries(value)
      .map(([section, days]) => [section, attendanceSchoolDays.filter((day) => days?.includes(day))] as const)
      .filter(([, days]) => days.length > 0),
  ) as SectionSchoolDays;
}

function buildSectionSchoolDays(settings?: AttendanceSettings): SectionSchoolDays {
  return cleanSectionSchoolDays(settings?.sectionSchoolDays ?? {});
}

function sectionDaysMode(days?: AttendanceSchoolDay[]) {
  if (!days?.length) return "school";
  const ordered = attendanceSchoolDays.filter((day) => days.includes(day));
  if (sameSchoolDays(ordered, defaultFiveSchoolDays)) return "5";
  if (sameSchoolDays(ordered, defaultSixSchoolDays)) return "6";
  return "custom";
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
