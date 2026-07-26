import { describe, expect, it } from "vitest";
import type { AttendanceSettings, Student } from "../types";
import { attendanceRecordId, parseTimeToMinutes, resolveAttendanceStatusForArrival } from "./attendance";

const student = { id: "student-a", className: "1ère Primaire" } as Student;

describe("présence", () => {
  it("produit le même identifiant pour le même élève et le même jour", () => {
    const first = attendanceRecordId("school-a", "year-a", "student-a", "2026-07-21");
    const duplicate = attendanceRecordId("school-a", "year-a", "student-a", "2026-07-21");
    expect(duplicate).toBe(first);
    expect(attendanceRecordId("school-a", "year-a", "student-a", "2026-07-22")).not.toBe(first);
  });

  it("neutralise les caractères non sûrs dans l'identifiant Firestore", () => {
    expect(attendanceRecordId("school/a", "year a", "student#a", "2026/07/21")).toBe(
      "attendance__school_a__year_a__student_a__2026_07_21",
    );
  });

  it("valide strictement les heures", () => {
    expect(parseTimeToMinutes("07:30")).toBe(450);
    expect(parseTimeToMinutes("24:00")).toBeNull();
    expect(parseTimeToMinutes("7:30")).toBeNull();
  });

  it("classe une arrivée après l'heure limite comme retard", () => {
    const settings = { defaultLateAfter: "07:30" } as AttendanceSettings;
    expect(resolveAttendanceStatusForArrival(student, "present", settings, new Date(2026, 6, 21, 7, 31))).toBe("late");
    expect(resolveAttendanceStatusForArrival(student, "present", settings, new Date(2026, 6, 21, 7, 30))).toBe("present");
  });
});
