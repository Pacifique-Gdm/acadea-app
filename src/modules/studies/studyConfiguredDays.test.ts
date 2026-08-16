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
    expect(drawerSource).toContain("items.filter(x=>x.teacherId===teacherId&&x.dayOfWeek===day&&x.active)");
  });
});
