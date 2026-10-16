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
  it("inclut toutes les périodes, les trois totaux et une vraie cote zéro", () => {
    const html = teacherGradesPdfSection(fixture());
    for (const slot of editableGradingSlots) expect(html).toContain({ period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen du 1er Semestre", period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen du 2ème Semestre" }[slot]);
    expect(html).toContain("Total 1er semestre");
    expect(html).toContain("Total 2e semestre");
    expect(html).toContain("Total général");
    expect(html).toMatch(/<span class="cell-inner">0<\/span>/);
    expect(html).not.toContain("Non coté");
    expect(html).not.toContain("Les cases non cotées");
    expect(html).toContain("Émile Noël");
  });
  it("calcule uniquement les cotes existantes, sans transformer les vides en zéros", () => {
    const input = fixture();
    input.entries = [
      { ...input.entries[0], score: 12 },
      { ...input.entries[0], gradingSlot: "semester_1_exam", score: 15 },
      { ...input.entries[0], gradingSlot: "period_3", score: 0 },
      { ...input.entries[0], gradingSlot: "period_4", score: 2.5 },
      { ...input.entries[0], gradingSlot: "semester_2_exam", score: null, status: "not_graded" },
    ];
    const html = teacherGradesPdfSection(input);
    expect(html).toMatch(/12<\/span><\/td>[\s\S]*?<span class="cell-inner"><\/span>[\s\S]*?15<\/span>[\s\S]*?27<\/span>/);
    expect(html).toMatch(/0<\/span>[\s\S]*?2\.5<\/span>[\s\S]*?<span class="cell-inner"><\/span>[\s\S]*?2\.5<\/span>[\s\S]*?29\.5<\/span>/);
  });
  it("laisse les trois totaux vides sans résultat, mais conserve le semestre disponible dans le total général", () => {
    const input = fixture();
    input.entries = [];
    const empty = teacherGradesPdfSection(input);
    expect((empty.match(/<span class="cell-inner"><\/span>/g) ?? [])).toHaveLength(9);
    input.entries = [{ ...fixture().entries[0], gradingSlot: "period_4", score: 3 }];
    const oneSemester = teacherGradesPdfSection(input);
    expect(oneSemester).toMatch(/3<\/span>[\s\S]*?3<\/span>[\s\S]*?3<\/span>/);
  });
  it("prépare une classe nombreuse sans tronquer la liste et laisse les absences historiques vides", () => {
    const input = fixture();
    input.students = Array.from({ length: 85 }, (_, index) => ({ ...input.students[0], id: `student-${index}`, nom: `Élève-${index}` }));
    input.entries = [{ ...input.entries[0], studentId: "student-0", status: "absent", score: null }];
    const html = teacherGradesPdfSection(input);
    expect(html).toContain("Élève-84");
    expect(html).not.toContain("Absent (historique)");
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(86);
    expect((html.match(/<thead>/g) ?? []).length).toBeGreaterThan(1);
    expect((html.match(/class="pdf-page-break"/g) ?? []).length).toBeGreaterThan(0);
  });
  it("utilise le nom du compte lié si le profil n'a pas de nom et refuse une identité absente", () => {
    const input = fixture();
    input.teacher.fullName = "";
    input.teacherName = "Marie Kabeya";
    expect(teacherGradesPdfSection(input)).toContain("Marie Kabeya");
    input.teacherName = "";
    expect(() => teacherGradesPdfSection(input)).toThrow(/nom de l’enseignant connecté est introuvable/);
  });
  it("refuse les données d'une autre école ou année", () => {
    const input = fixture();
    input.entries = [{ ...input.entries[0], schoolId: "school-b" }];
    expect(() => teacherGradesPdfSection(input)).toThrow(/hors du périmètre/);
  });
});
