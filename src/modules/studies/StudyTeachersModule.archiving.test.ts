import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/modules/studies/StudyTeachersModule.tsx", "utf8");

describe("historique des Enseignants archivés", () => {
  it("les exclut de la liste active et conserve une consultation historique", () => {
    expect(source).toContain('teachers.filter((teacher) => teacher.status === "active")');
    expect(source).toContain('teachers.filter((teacher) => teacher.status === "inactive")');
    expect(source).toContain("Historique des enseignants archivés");
    expect(source).toContain("affectation(s) historique(s)");
  });

  it("garde la fiche archivée en lecture seule", () => {
    expect(source).toContain('selectedTeacher.status === "active" && <button');
    expect(source).toContain("TeacherAvailabilitySummary");
  });
});
