import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { currentTimetableEntries } from "./studyScope";
import type { TimetableEntry } from "./studyTypes";

const entry = (id: string, active?: boolean): TimetableEntry => ({
  id,
  scheduleId: "schedule-1",
  schoolId: "school-1",
  schoolYearId: "year-1",
  classId: "class-1",
  teacherId: "teacher-1",
  subjectId: "subject-1",
  assignmentId: "assignment-1",
  dayOfWeek: "monday",
  periodId: "period-1",
  roomId: null,
  active,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("réinitialisation pédagogique après réactivation", () => {
  it("retire les anciennes entrées d’horaire de l’état courant sans effacer l’historique", () => {
    expect(currentTimetableEntries([entry("legacy"), entry("reset", false), entry("new", true)]).map((item) => item.id)).toEqual(["legacy", "new"]);
    const teacherPortal = readFileSync(new URL("../teacher/teacherPortalService.ts", import.meta.url), "utf8");
    const publishedReader = readFileSync(new URL("./publishedTimetableService.ts", import.meta.url), "utf8");
    expect(teacherPortal).toContain("currentTimetableEntries(docs(entries))");
    expect(publishedReader).toContain("currentTimetableEntries(entriesSnapshot.docs.map");
  });

  it("déclenche le reset uniquement dans le workflow reactivate-personnel et le limite à l’année active", () => {
    const source = readFileSync(new URL("../../../api/provision-school-account.js", import.meta.url), "utf8");
    expect(source).toContain('const teacherReset = !archive && target.role === "teacher"');
    expect(source).toContain('snapshot.data()?.schoolYearId === currentSchoolYearId');
    expect(source).toContain('"timetableEntries"');
    expect(source).toContain("assignmentLockRefs.forEach((ref) => batch.delete(ref))");
    expect(source).toContain("resetWriteCount > 500");
  });
});
