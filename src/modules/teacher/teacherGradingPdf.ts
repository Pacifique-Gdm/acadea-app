import type { School, SchoolYear, Student } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { PedagogicalAssignment, StudyClass, StudySubject, StudyTeacher } from "../studies/studyTypes";
import { editableGradingSlots, gradingSlotLabels, type CourseGradingConfig, type GradeEntry } from "./teacherGrading";

type ExportInput = {
  school: School;
  year: SchoolYear;
  teacher: StudyTeacher;
  assignment: PedagogicalAssignment;
  schoolClass?: StudyClass;
  subject?: StudySubject;
  students: Student[];
  entries: GradeEntry[];
  config?: CourseGradingConfig;
};

export function teacherGradesPdfSection(input: ExportInput) {
  if (!input.schoolClass || !input.subject || input.schoolClass.id !== input.assignment.classId || input.subject.id !== input.assignment.subjectId) {
    throw new Error("Classe ou cours indisponible pour l’export des cotations.");
  }
  const sameScope = (item: { schoolId: string; schoolYearId: string }) => item.schoolId === input.school.id && item.schoolYearId === input.year.id;
  if (!sameScope(input.assignment) || !sameScope(input.schoolClass) || !sameScope(input.subject) || !sameScope(input.teacher)
    || input.assignment.teacherId !== input.teacher.id || input.students.some((item) => !sameScope(item))
    || input.entries.some((item) => !sameScope(item) || item.classId !== input.assignment.classId || item.subjectId !== input.assignment.subjectId)
    || (input.config && (!sameScope(input.config) || input.config.classId !== input.assignment.classId || input.config.subjectId !== input.assignment.subjectId))) {
    throw new Error("Données de cotation hors du périmètre autorisé.");
  }
  const entries = new Map(input.entries.map((item) => [`${item.studentId}:${item.gradingSlot}`, item]));
  const sortedStudents = [...input.students].sort((a, b) => [a.nom, a.postnom, a.prenom].join(" ").localeCompare([b.nom, b.postnom, b.prenom].join(" "), "fr"));
  const columns = [
    { header: "Élève", render: (student: Student) => [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ") },
    ...editableGradingSlots.map((slot) => ({
      header: gradingSlotLabels[slot],
      render: (student: Student) => {
        const entry = entries.get(`${student.id}:${slot}`);
        if (!entry || entry.status === "not_graded") return "Non coté";
        if (entry.status === "absent") return "Absent (historique)";
        if (entry.score === null || !Number.isFinite(entry.score)) return "Cote indisponible";
        const maximum = Number.isFinite(entry.maxScoreSnapshot) && entry.maxScoreSnapshot > 0 ? entry.maxScoreSnapshot : input.config?.maxScore;
        return maximum ? `${entry.score} / ${maximum}` : String(entry.score);
      },
    })),
  ];
  const teacherName = input.teacher.fullName?.trim() || [input.teacher.firstName, input.teacher.lastName].filter(Boolean).join(" ").trim();
  return pdfSection("Cotations enregistrées", `<p><strong>Classe :</strong> ${escapePdfHtml(input.schoolClass.name)} · <strong>Cours :</strong> ${escapePdfHtml(input.subject.name)} · <strong>Enseignant :</strong> ${escapePdfHtml(teacherName || "Nom non renseigné")}</p><p>Les cases non cotées ne sont pas des résultats. Aucun total n’est calculé dans cet export.</p>${pdfTable(columns, sortedStudents, "Aucun élève actif inscrit dans cette classe.")}`);
}

export async function exportTeacherGradesPdf(input: ExportInput) {
  await renderAcadPdfPreview({
    filename: `cotations-${input.year.name}-${input.assignment.id}.pdf`,
    title: "Fiche de cotation",
    school: input.school,
    year: input.year,
    orientation: "landscape",
    sections: [teacherGradesPdfSection(input)],
  });
}
