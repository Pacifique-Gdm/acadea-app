import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const moduleSource = readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");
const serviceSource = readFileSync("src/modules/studies/studyService.ts", "utf8");

describe("StudyTeachers assignment editor contract", () => {
  it("uses the same enabled multi-select controls for create and edit", () => {
    expect(moduleSource).toContain('MultiSelectDropdown label="Cours"');
    expect(moduleSource).toContain('MultiSelectDropdown label="Classes"');
    expect(moduleSource).not.toContain("disabled={Boolean(editingAssignment)}");
  });

  it("pre-fills current teacher, course, class and functional values", () => {
    expect(moduleSource).toContain("setTeacherId(current?.teacherId");
    expect(moduleSource).toContain("setSubjectIds(current?.subjectId ? [current.subjectId] : [])");
    expect(moduleSource).toContain("setClassIds(current?.classId ? [current.classId] : [])");
    expect(moduleSource).toContain("setWeeklyPeriods(String(current?.weeklyPeriods ?? 1))");
  });

  it("submits every selected course/class combination through one transactional service", () => {
    expect(moduleSource).toContain("subjectIds: savedSubjectIds, classIds: savedClassIds");
    expect(moduleSource).toContain("current: editingAssignment");
    expect(serviceSource).toContain("const targetIds = new Set(combinations.map");
    expect(serviceSource).toContain("transaction.update(doc(database, \"pedagogicalAssignments\", input.current.id)");
    expect(serviceSource).toContain("combinations.forEach(({ subjectId, classId })");
  });

  it("keeps deterministic duplicate protection and the raw/canonical class distinction", () => {
    expect(moduleSource).toContain("hasActiveAssignmentDuplicate(assignments, candidate, editingAssignment?.id)");
    expect(moduleSource).toContain("!sourceClasses.some((current) => current.id === item.id)");
  });
});
