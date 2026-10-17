import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportTeacherGradesPdf, teacherGradesPdfSection } from "./teacherGradingPdf";
import { editableGradingSlots } from "./teacherGrading";
import { renderAcadPdfPreview } from "../../utils/pdf";

vi.mock("../../utils/pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/pdf")>(),
  renderAcadPdfPreview: vi.fn(),
}));

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
  beforeEach(() => vi.mocked(renderAcadPdfPreview).mockReset());

  it("respecte exactement les dix en-têtes abrégés dans l'ordre et conserve une vraie cote zéro", () => {
    const html = teacherGradesPdfSection(fixture());
    const headers = [...html.matchAll(/<th\b[^>]*><span class="cell-inner">([^<]*)<\/span><\/th>/g)].map((match) => match[1]);
    expect(headers).toEqual(["ÉLÈVE", "1-P", "2-P", "EX-1S", "TOT-1S", "3-P", "4-P", "EX-2S", "TOT-2S", "TOT GEN"]);
    expect(editableGradingSlots).toHaveLength(6);
    expect(html).toMatch(/<span class="cell-inner">0<\/span>/);
    expect(html).not.toContain("Non coté");
    expect(html).not.toContain("Les cases non cotées");
    expect(html).toContain("Émile Noël");
  });
  it("demande le portrait et remonte un échec de génération au formulaire", async () => {
    await exportTeacherGradesPdf(fixture());
    expect(renderAcadPdfPreview).toHaveBeenCalledWith(expect.objectContaining({ orientation: "portrait", throwOnError: true }));
    vi.mocked(renderAcadPdfPreview).mockRejectedValueOnce(new Error("Échec PDF de test"));
    await expect(exportTeacherGradesPdf(fixture())).rejects.toThrow("Échec PDF de test");
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
