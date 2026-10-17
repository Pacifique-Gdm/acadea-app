import type { School, SchoolYear, Student } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { PedagogicalAssignment, StudyClass, StudySubject, StudyTeacher } from "../studies/studyTypes";
import { editableGradingSlots, type CourseGradingConfig, type GradeEntry } from "./teacherGrading";

type ExportInput = {
  school: School;
  year: SchoolYear;
  teacher: StudyTeacher;
  teacherName?: string;
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
  const schoolClass = input.schoolClass;
  const subject = input.subject;
  const sameScope = (item: { schoolId: string; schoolYearId: string }) => item.schoolId === input.school.id && item.schoolYearId === input.year.id;
  if (!sameScope(input.assignment) || !sameScope(input.schoolClass) || !sameScope(input.subject) || !sameScope(input.teacher)
    || input.assignment.teacherId !== input.teacher.id || input.students.some((item) => !sameScope(item))
    || input.entries.some((item) => !sameScope(item) || item.classId !== input.assignment.classId || item.subjectId !== input.assignment.subjectId)
    || (input.config && (!sameScope(input.config) || input.config.classId !== input.assignment.classId || input.config.subjectId !== input.assignment.subjectId))) {
    throw new Error("Données de cotation hors du périmètre autorisé.");
  }
  const teacherNames = [input.teacher.fullName, [input.teacher.firstName, input.teacher.lastName].filter(Boolean).join(" "), input.teacherName];
  const teacherName = teacherNames.map((value) => value?.trim()).find((value) => value && value !== "Nom non renseigné");
  if (!teacherName) throw new Error("Le nom de l’enseignant connecté est introuvable. Export PDF impossible.");
  const entries = new Map(input.entries.map((item) => [`${item.studentId}:${item.gradingSlot}`, item]));
  const sortedStudents = [...input.students].sort((a, b) => [a.nom, a.postnom, a.prenom].join(" ").localeCompare([b.nom, b.postnom, b.prenom].join(" "), "fr"));
  const score = (student: Student, slot: typeof editableGradingSlots[number]) => {
    const entry = entries.get(`${student.id}:${slot}`);
    return entry?.status === "graded" && typeof entry.score === "number" && Number.isFinite(entry.score) && entry.score >= 0 ? entry.score : null;
  };
  const total = (student: Student, slots: typeof editableGradingSlots[number][]) => {
    const values = slots.map((slot) => score(student, slot)).filter((value): value is number => value !== null);
    return values.length ? Number(values.reduce((sum, value) => sum + value, 0).toFixed(10)) : "";
  };
  const columns = [
    { header: "ÉLÈVE", render: (student: Student) => [student.nom, student.postnom, student.prenom].filter(Boolean).join(" ") },
    ...editableGradingSlots.slice(0, 3).map((slot, index) => ({ header: ["1-P", "2-P", "EX-1S"][index], align: "center" as const, render: (student: Student) => score(student, slot) ?? "" })),
    { header: "TOT-1S", align: "center" as const, render: (student: Student) => total(student, editableGradingSlots.slice(0, 3)) },
    ...editableGradingSlots.slice(3).map((slot, index) => ({ header: ["3-P", "4-P", "EX-2S"][index], align: "center" as const, render: (student: Student) => score(student, slot) ?? "" })),
    { header: "TOT-2S", align: "center" as const, render: (student: Student) => total(student, editableGradingSlots.slice(3)) },
    { header: "TOT GEN", align: "center" as const, render: (student: Student) => total(student, editableGradingSlots) },
  ];
  const chunks: Student[][] = [];
  if (!sortedStudents.length) chunks.push([]);
  for (let offset = 0; offset < sortedStudents.length;) {
    const pageSize = offset === 0 ? 12 : 18;
    chunks.push(sortedStudents.slice(offset, offset + pageSize));
    offset += pageSize;
  }
  return chunks.map((students, index) => pdfSection(index ? "Cotations enregistrées (suite)" : "Cotations enregistrées", `<p><strong>Classe :</strong> ${escapePdfHtml(schoolClass.name)} · <strong>Cours :</strong> ${escapePdfHtml(subject.name)} · <strong>Enseignant :</strong> ${escapePdfHtml(teacherName)}</p>${pdfTable(columns, students, "Aucun élève actif inscrit dans cette classe.")}`, { className: "grading-pdf-section", pageBreakBefore: index > 0 })).join("");
}

export async function exportTeacherGradesPdf(input: ExportInput) {
  await renderAcadPdfPreview({
    filename: `cotations-${input.year.name}-${input.assignment.id}.pdf`,
    title: "Fiche de cotation",
    school: input.school,
    year: input.year,
    orientation: "portrait",
    throwOnError: true,
    sections: [teacherGradesPdfSection(input)],
  });
}
