import type { School, SchoolYear } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { StudyClass, StudyRoom, StudySubject, StudyTeacher, TimetableEntry } from "./studyTypes";

export async function exportFilteredStudySchedulePdf(input: { school: School; year: SchoolYear; entries: TimetableEntry[]; teachers: StudyTeacher[]; classes: StudyClass[]; subjects: StudySubject[]; rooms: StudyRoom[]; filterLabel: string }) {
  const label = <T extends { id: string }>(items: T[], id: string, field: keyof T) => String(items.find((item) => item.id === id)?.[field] ?? "—");
  const table = pdfTable<TimetableEntry>([
    { header: "Jour", render: (item) => item.dayOfWeek },
    { header: "Classe", render: (item) => label(input.classes, item.classId, "name") },
    { header: "Enseignant", render: (item) => label(input.teachers, item.teacherId, "fullName") },
    { header: "Matière", render: (item) => label(input.subjects, item.subjectId, "name") },
    { header: "Période", render: (item) => item.periodId },
    { header: "Salle", render: (item) => item.roomId ? label(input.rooms, item.roomId, "name") : "—" },
  ], input.entries, "Aucun créneau pour ce filtre.");
  await renderAcadPdfPreview({ filename: `horaire-${input.year.name}.pdf`, title: "Horaire", school: input.school, year: input.year, subtitle: input.filterLabel, sections: [pdfSection("Horaire filtré", `<p><strong>Filtre :</strong> ${escapePdfHtml(input.filterLabel)}</p>${table}`)] });
}
