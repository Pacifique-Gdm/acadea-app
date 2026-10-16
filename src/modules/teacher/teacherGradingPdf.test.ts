import { describe, expect, it } from "vitest";
import { teacherGradesPdfSection } from "./teacherGradingPdf";
import { editableGradingSlots } from "./teacherGrading";

function fixture() {
  const scope = { schoolId: "school-a", schoolYearId: "year-a" };
  return {
    school: { id: "school-a", name: "École de test" },
    year: { id: "year-a", name: "2026-2027" },
    teacher: { id: "teacher-a", fullName: "Émile Noël", ...scope },
    assignment: { id: "assignment-a", teacherId: "teacher-a", classId: "class-a", subjectId: "subject-a", ...scope },
    schoolClass: { id: "class-a", name: "4e Littéraire", ...scope },
    subject: { id: "subject-a", name: "Français", ...scope },
    students: [{ id: "student-a", nom: "Durand", postnom: "", prenom: "Alice", ...scope }],
    entries: [{ studentId: "student-a", classId: "class-a", subjectId: "subject-a", gradingSlot: "period_1", score: 0, status: "graded", maxScoreSnapshot: 20, ...scope }],
    config: { classId: "class-a", subjectId: "subject-a", maxScore: 25, ...scope },
  } as Parameters<typeof teacherGradesPdfSection>[0];
}

describe("export PDF des cotations", () => {
  it("inclut toutes les périodes et examens réellement définis, le zéro et le maximum historique", () => {
    const html = teacherGradesPdfSection(fixture());
    for (const slot of editableGradingSlots) expect(html).toContain({ period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen du 1er Semestre", period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen du 2ème Semestre" }[slot]);
    expect(html).toContain("0 / 20");
    expect(html).toContain("Non coté");
    expect(html).toContain("Émile Noël");
  });
  it("prépare une classe nombreuse sans tronquer la liste et conserve Absent historique", () => {
    const input = fixture();
    input.students = Array.from({ length: 85 }, (_, index) => ({ ...input.students[0], id: `student-${index}`, nom: `Élève-${index}` }));
    input.entries = [{ ...input.entries[0], studentId: "student-0", status: "absent", score: null }];
    const html = teacherGradesPdfSection(input);
    expect(html).toContain("Élève-84");
    expect(html).toContain("Absent (historique)");
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(86);
  });
  it("refuse les données d'une autre école ou année", () => {
    const input = fixture();
    input.entries = [{ ...input.entries[0], schoolId: "school-b" }];
    expect(() => teacherGradesPdfSection(input)).toThrow(/hors du périmètre/);
  });
});
