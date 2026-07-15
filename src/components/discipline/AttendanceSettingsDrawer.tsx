import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { AppUser, AttendanceSettings, School, SchoolClass, SchoolSection, SchoolYear, Student } from "../../types";
import { CLASSES } from "../../types";
import { attendanceClassRuleKey, attendanceSettingsId } from "../../utils/attendance";
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
  const [defaultLateAfter, setDefaultLateAfter] = useState(settings?.defaultLateAfter ?? "");
  const [sectionLateAfter, setSectionLateAfter] = useState<Partial<Record<SchoolSection, string>>>(settings?.sectionLateAfter ?? {});
  const [classLateAfter, setClassLateAfter] = useState<Record<string, string>>(settings?.classLateAfter ?? {});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setDefaultLateAfter(settings?.defaultLateAfter ?? "");
    setSectionLateAfter(settings?.sectionLateAfter ?? {});
    setClassLateAfter(settings?.classLateAfter ?? {});
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

  async function saveSettings() {
    setSaving(true);
    setFeedback("");
    try {
      const cleanedSections = Object.fromEntries(Object.entries(sectionLateAfter).filter(([, value]) => Boolean(value))) as Partial<Record<SchoolSection, string>>;
      const cleanedClasses = Object.fromEntries(Object.entries(classLateAfter).filter(([, value]) => Boolean(value)));
      const nextSettings: AttendanceSettings = {
        id: attendanceSettingsId(school.id, year.id),
        schoolId: school.id,
        schoolYearId: year.id,
        sectionLateAfter: cleanedSections,
        classLateAfter: cleanedClasses,
        updatedAt: new Date().toISOString(),
        updatedBy: user.id,
      };
      if (defaultLateAfter) {
        nextSettings.defaultLateAfter = defaultLateAfter;
      }
      await onSave(nextSettings);
      setFeedback("Paramètres de présence enregistrés.");
    } catch (error) {
      console.warn("Enregistrement des paramètres de présence impossible.", error);
      setFeedback("Impossible d'enregistrer les paramètres de présence.");
    } finally {
      setSaving(false);
    }
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
          <h2 className="font-bold text-ink">Règle générale</h2>
          <p className="mt-1 text-sm text-slate-500">Utilisée quand aucune règle de classe ou de section ne s'applique.</p>
        </div>
        <input type="time" value={defaultLateAfter} onChange={(event) => setDefaultLateAfter(event.target.value)} className="input max-w-xs" aria-label="Heure générale de retard" />
      </section>

      <section className="grid min-w-0 gap-3 rounded border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h2 className="font-bold text-ink">Par section</h2>
          <p className="mt-1 text-sm text-slate-500">La règle de section est utilisée si aucune règle précise de classe n'existe.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {sections.map((section) => (
            <label key={section} className="grid gap-1 text-sm font-semibold text-slate-600">
              {sectionLabels[section]}
              <input
                type="time"
                value={sectionLateAfter[section] ?? ""}
                onChange={(event) => setSectionLateAfter((current) => ({ ...current, [section]: event.target.value }))}
                className="input"
              />
            </label>
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
              <label key={rule.key} className="grid gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-600 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
                <span className="min-w-0 break-words">{rule.option ? `${rule.className} - ${rule.option}` : rule.className}</span>
                <input
                  type="time"
                  value={classLateAfter[rule.key] ?? ""}
                  onChange={(event) => setClassLateAfter((current) => ({ ...current, [rule.key]: event.target.value }))}
                  className="input"
                />
              </label>
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
