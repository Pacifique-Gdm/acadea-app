import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AttendanceSettings, Student } from "../../types";
import { hasSectionSchoolDays, resolveAllAttendanceSchoolDays, resolveAttendanceDaySchedule, resolveAttendanceSchoolDays } from "../../utils/attendance";
import { buildSectionLimitedSettings } from "../../components/discipline/AttendanceSettingsDrawer";
import { classesWithSectionSchoolDays, studyClassSchoolDays } from "./studyScope";
import { timetableSourceFingerprint } from "./scheduleSource";
import { validateTimetable, type ScheduleProblem } from "./scheduleValidation";
import { DeterministicTimetableSolver } from "./timetableSolver";
import type { PedagogicalAssignment, SchedulePeriod, StudyClass, TimetableEntry } from "./studyTypes";
// @ts-expect-error Paquet serveur généré en JavaScript, sans fichier de types.
import * as serverBundle from "../../../api/_lib/timetableValidationBundle.js";

// Lot R3 : jours de cours par section (réglés par le Directeur de discipline et repris par l'horaire).
const five = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const six = [...five, "saturday"] as const;
const settings = (overrides: Partial<AttendanceSettings> = {}): AttendanceSettings => ({ id: "settings", schoolId: "s", schoolYearId: "y", schoolDays: [...five], ...overrides });
const period = (id: string, order: number, overrides: Partial<SchedulePeriod> = {}): SchedulePeriod => ({ id, schoolId: "s", schoolYearId: "y", label: id, startTime: `${String(7 + order).padStart(2, "0")}:00`, endTime: `${String(8 + order).padStart(2, "0")}:00`, order, type: "course", active: true, createdBy: "u", createdAt: "n", updatedAt: "n", ...overrides });
const schoolClass = (id: string, name: string, overrides: Partial<StudyClass> = {}): StudyClass => ({ id, schoolId: "s", schoolYearId: "y", name, active: true, ...overrides });
const assignment = (id: string, classId: string, weeklyPeriods: number): PedagogicalAssignment => ({ id, schoolId: "s", schoolYearId: "y", teacherId: `teacher-${id}`, subjectId: `subject-${id}`, classId, weeklyPeriods, blockSize: 1, active: true, createdBy: "u", updatedBy: "u", createdAt: "n", updatedAt: "n" });

describe("jours de cours par section", () => {
  it("sans jours propres, une section reprend exactement les jours de l'école", () => {
    expect(resolveAttendanceSchoolDays(settings(), "Primaire")).toEqual([...five]);
    expect(resolveAttendanceSchoolDays(undefined, "Primaire")).toEqual([...six]);
    expect(resolveAllAttendanceSchoolDays(settings())).toEqual([...five]);
    expect(hasSectionSchoolDays(settings())).toBe(false);
    expect(hasSectionSchoolDays(settings({ sectionSchoolDays: { Primaire: [] } }))).toBe(false);
  });

  it("une section avec ses propres jours les garde, dans l'ordre de la semaine", () => {
    const value = settings({ sectionSchoolDays: { Secondaire: ["saturday", "monday", "tuesday", "wednesday", "thursday", "friday"] } });
    expect(resolveAttendanceSchoolDays(value, "Secondaire")).toEqual([...six]);
    expect(resolveAttendanceSchoolDays(value, "Primaire")).toEqual([...five]);
    expect(resolveAttendanceSchoolDays(value)).toEqual([...five]);
    expect(resolveAllAttendanceSchoolDays(value)).toEqual([...six]);
  });

  it("l'heure de retard n'est pas appliquée un jour où la section de l'élève n'a pas cours", () => {
    const value = settings({ sectionSchoolDays: { Secondaire: [...six] }, defaultSchedule: { saturday: { lateAfter: "07:30" } } });
    const saturday = new Date(2026, 10, 28);
    const pupil = (className: string) => ({ className } as Student);
    expect(resolveAttendanceDaySchedule(pupil("1ère Humanité"), value, saturday)).toEqual({ lateAfter: "07:30" });
    expect(resolveAttendanceDaySchedule(pupil("1ère Primaire"), value, saturday)).toBeUndefined();
  });

  it("sans jours par section, l'horaire voit les mêmes classes et la même empreinte", () => {
    const classes = [schoolClass("c1", "1ère Primaire"), schoolClass("c2", "1ère Humanité")];
    expect(classesWithSectionSchoolDays(classes, settings())).toBe(classes);
    const problem: ScheduleProblem = { schoolId: "s", schoolYearId: "y", assignments: [assignment("a", "c1", 2)], availabilities: [], periods: [period("p1", 1)], classes, days: resolveAttendanceSchoolDays(settings()) };
    const rebuilt: ScheduleProblem = { ...problem, classes: classesWithSectionSchoolDays(classes, settings()), days: resolveAllAttendanceSchoolDays(settings()) };
    expect(timetableSourceFingerprint(rebuilt)).toBe(timetableSourceFingerprint(problem));
  });

  it("l'horaire ne place aucun cours un jour où la section de la classe n'a pas cours", () => {
    const value = settings({ sectionSchoolDays: { Secondaire: [...six] } });
    const classes = classesWithSectionSchoolDays([schoolClass("primary", "1ère Primaire"), schoolClass("secondary", "1ère Humanité")], value);
    expect(classes[0].dayVacations).toEqual({ saturday: "none" });
    expect(classes[1].dayVacations).toBeUndefined();
    expect(studyClassSchoolDays(classes[1], value)).toEqual([...six]);
    const problem: ScheduleProblem = {
      schoolId: "s", schoolYearId: "y", classes, availabilities: [],
      assignments: [assignment("p", "primary", 6), assignment("h", "secondary", 6)],
      periods: [period("p1", 1), period("p2", 2), period("sat", 1, { dayScope: "saturday" })],
      days: resolveAllAttendanceSchoolDays(value),
    };
    const result = new DeterministicTimetableSolver().solve(problem);
    expect(result.success).toBe(true);
    expect(result.entries.filter((entry) => entry.classId === "primary").every((entry) => entry.dayOfWeek !== "saturday")).toBe(true);
    const saturdayPrimary: TimetableEntry = { ...result.entries.find((entry) => entry.classId === "primary")!, id: "forced", dayOfWeek: "saturday", periodId: "sat" };
    const report = validateTimetable(problem, [...result.entries.filter((entry) => entry.id !== saturdayPrimary.id), saturdayPrimary]);
    expect(report.errors.some((issue) => issue.code === "CLASS_VACATION" && issue.entityId === "forced")).toBe(true);
  });

  it("le serveur utilise les mêmes calculs (paquet régénéré)", () => {
    const value = settings({ sectionSchoolDays: { Primaire: ["monday", "tuesday"] } });
    expect(serverBundle.resolveAllAttendanceSchoolDays(value)).toEqual([...five]);
    expect(serverBundle.studyClassSchoolDays(schoolClass("c", "1ère Primaire"), value)).toEqual(["monday", "tuesday"]);
    expect(serverBundle.classesWithSectionSchoolDays([schoolClass("c", "1ère Humanité")], settings())).toHaveLength(1);
    const workflow = readFileSync("api/_lib/timetableWorkflow.js", "utf8");
    expect(workflow).toContain("classes: classesWithSectionSchoolDays(classes, settings[0])");
    expect(workflow).toContain("days: resolveAllAttendanceSchoolDays(settings[0])");
    const periods = readFileSync("api/_lib/studyPeriodMutations.js", "utf8");
    expect(periods).toContain("studyClassSchoolDays(schoolClass, settings[0]).includes(day)");
  });
});

describe("enregistrement d'un Directeur de discipline rattaché à une section", () => {
  const existing: AttendanceSettings = settings({
    defaultSchedule: { monday: { lateAfter: "07:30" } },
    sectionSchedule: { Primaire: { monday: { lateAfter: "07:15" } }, Secondaire: { monday: { lateAfter: "07:45" } } },
    classSchedule: { "1ère Primaire": { monday: { lateAfter: "07:10" } }, "1ère Humanité__Latin": { monday: { lateAfter: "07:50" } } },
    sectionSchoolDays: { Secondaire: [...six] },
    updatedBy: "other",
  });

  it("ne remplace que ses sections et garde tout le reste à l'identique", () => {
    const next = buildSectionLimitedSettings(
      existing,
      ["Primaire"],
      { Primaire: { monday: { lateAfter: "07:20" } }, Secondaire: { monday: { lateAfter: "09:00" } } },
      { "1ère Primaire": { monday: { lateAfter: "07:05" } }, "1ère Humanité__Latin": { monday: { lateAfter: "09:00" } } },
      { Primaire: [...five], Secondaire: ["monday"] },
      "s", "y", "primary",
    );
    expect(next.schoolDays).toEqual(existing.schoolDays);
    expect(next.defaultSchedule).toEqual(existing.defaultSchedule);
    expect(next.sectionSchedule).toEqual({ Primaire: { monday: { lateAfter: "07:20" } }, Secondaire: { monday: { lateAfter: "07:45" } } });
    expect(next.classSchedule).toEqual({ "1ère Primaire": { monday: { lateAfter: "07:05" } }, "1ère Humanité__Latin": { monday: { lateAfter: "07:50" } } });
    expect(next.sectionSchoolDays).toEqual({ Secondaire: [...six], Primaire: [...five] });
    expect(next.updatedBy).toBe("primary");
  });

  it("revenir à « comme l'école » retire seulement les jours de sa section", () => {
    const next = buildSectionLimitedSettings(existing, ["Secondaire"], existing.sectionSchedule!, existing.classSchedule!, {}, "s", "y", "secondary");
    expect(next.sectionSchoolDays).toEqual({});
    expect(next.sectionSchedule).toEqual(existing.sectionSchedule);
  });

  it("à la création, n'écrit aucun réglage de l'école", () => {
    const next = buildSectionLimitedSettings(undefined, ["Primaire"], { Primaire: { monday: { lateAfter: "07:20" } } }, {}, {}, "s", "y", "primary");
    expect(Object.keys(next).sort()).toEqual(["classSchedule", "id", "schoolId", "schoolYearId", "sectionSchedule", "sectionSchoolDays", "updatedAt", "updatedBy"]);
  });

  it("le tiroir met les autres sections en lecture seule et ne propose pas de bouton Actualiser", () => {
    const source = readFileSync("src/components/discipline/AttendanceSettingsDrawer.tsx", "utf8");
    expect(source).toContain("userSectionIds(user)");
    expect(source).toContain("readOnly={!canEditSection(section)}");
    expect(source).toContain("readOnly={!canEditSection(rule.section)}");
    expect(source).toContain("disabled={!canEditSection(section)}");
    expect(source).toContain("Lecture seule : section réglée par son Directeur de discipline.");
    expect(source).not.toMatch(/Actualiser/);
  });
});
