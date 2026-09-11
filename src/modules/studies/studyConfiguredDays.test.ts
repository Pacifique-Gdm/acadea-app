import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveAttendanceSchoolDays } from "../../utils/attendance";
import type { AttendanceSettings } from "../../types";

const drawerSource = readFileSync("src/modules/studies/TeacherAvailabilityDrawer.tsx", "utf8");
const teachersSource = readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");
const periodsSource = readFileSync("src/modules/studies/StudyPeriodsModule.tsx", "utf8");

describe("jours scolaires de la Direction des études", () => {
  it("conserve l’ordre canonique et reflète cinq ou six jours", () => {
    const weekdays: AttendanceSettings = { id: "settings", schoolId: "school", schoolYearId: "year", schoolDays: ["monday", "tuesday", "wednesday", "thursday", "friday"] };
    const sixDays: AttendanceSettings = { ...weekdays, schoolDays: [...weekdays.schoolDays!, "saturday"] };
    expect(resolveAttendanceSchoolDays(weekdays)).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday"]);
    expect(resolveAttendanceSchoolDays(sixDays)).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
  });

  it("utilise la même configuration dans le drawer, la fiche et les périodes", () => {
    expect(teachersSource).toContain("resolveAttendanceSchoolDays(data.attendanceSettings)");
    expect(teachersSource).toContain("schoolDays={schoolDays}");
    expect(drawerSource).toContain("schoolDays.map");
    expect(drawerSource).not.toContain("STUDY_DAYS.map");
    expect(periodsSource).toContain("resolveAttendanceSchoolDays(data.attendanceSettings)");
  });

  it("retire un jour de l’interface sans supprimer les disponibilités historiques", () => {
    expect(drawerSource).not.toContain("deleteTeacherDayAvailability");
    expect(drawerSource).toContain("items.filter((item) => item.teacherId === teacherId && item.dayOfWeek === day && item.active)");
  });

  it("édite toute la semaine en une sauvegarde avec seulement Disponible et Repos", () => {
    expect(drawerSource).toContain('data-testid="weekly-availability-editor"');
    expect(drawerSource).toContain("saveTeacherWeekAvailability");
    expect(drawerSource).not.toContain("saveTeacherDayAvailability");
    expect(drawerSource).toContain('<option value="available">Disponible</option>');
    expect(drawerSource).toContain('<option value="rest">Repos</option>');
    expect(drawerSource).not.toContain('<option value="unavailable">');
    expect(drawerSource.match(/onClick=\{\(\) => void save\(\)\}/g)).toHaveLength(1);
  });

  it("conserve une lecture explicite des indisponibilités historiques", () => {
    expect(drawerSource).toContain('item.status === "unavailable"');
    expect(drawerSource).toContain("Indisponible (historique)");
    expect(drawerSource).toContain("Des indisponibilités historiques existent.");
  });
});
