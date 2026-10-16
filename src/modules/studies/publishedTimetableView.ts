import type { School, SchoolYear } from "../../types";
import { pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { studyDayLabel } from "./studySchedule";
import type { PublishedTimetableRow } from "./publishedTimetableService";

export type PublishedTimetableFilters = { day: string; teacher: string; subject: string };
export const emptyPublishedTimetableFilters: PublishedTimetableFilters = { day: "", teacher: "", subject: "" };

export function publishedTimetableChoices(rows: PublishedTimetableRow[]) {
  return {
    days: [...new Set(rows.map((row) => row.dayOfWeek).filter((day) => day !== "unknown"))],
    teachers: [...new Set(rows.map((row) => row.teacherDisplayName))].sort((a, b) => a.localeCompare(b, "fr")),
    subjects: [...new Set(rows.map((row) => row.subjectLabel))].sort((a, b) => a.localeCompare(b, "fr")),
  };
}

export function filterPublishedTimetable(rows: PublishedTimetableRow[], filters: PublishedTimetableFilters) {
  const choices = publishedTimetableChoices(rows);
  const valid = {
    day: choices.days.includes(filters.day as typeof choices.days[number]) ? filters.day : "",
    teacher: choices.teachers.includes(filters.teacher) ? filters.teacher : "",
    subject: choices.subjects.includes(filters.subject) ? filters.subject : "",
  };
  return {
    filters: valid,
    rows: rows.filter((row) => (!valid.day || row.dayOfWeek === valid.day)
      && (!valid.teacher || row.teacherDisplayName === valid.teacher)
      && (!valid.subject || row.subjectLabel === valid.subject)),
    choices,
  };
}

export function publishedTimetableFilterLabel(filters: PublishedTimetableFilters) {
  return [filters.day && `Jour : ${studyDayLabel(filters.day as Exclude<PublishedTimetableRow["dayOfWeek"], "unknown">)}`,
    filters.teacher && `Enseignant : ${filters.teacher}`,
    filters.subject && `Cours : ${filters.subject}`].filter(Boolean).join(" · ") || "Tous les cours";
}

export async function exportPublishedTimetablePdf(input: { school: School; year: SchoolYear; rows: PublishedTimetableRow[]; filters: PublishedTimetableFilters }) {
  const table = pdfTable<PublishedTimetableRow>([
    { header: "Jour", render: (row) => row.dayOfWeek === "unknown" ? "Jour indisponible" : studyDayLabel(row.dayOfWeek) },
    { header: "Période", render: (row) => row.periodLabel },
    { header: "Classe", render: (row) => row.classLabel },
    { header: "Cours", render: (row) => row.subjectLabel },
    { header: "Enseignant", render: (row) => row.teacherDisplayName },
  ], input.rows, "Aucun cours pour ces filtres.");
  await renderAcadPdfPreview({ filename: `horaire-publie-${input.year.name}.pdf`, title: "Horaire publié", school: input.school,
    year: input.year, subtitle: publishedTimetableFilterLabel(input.filters), sections: [pdfSection("Cours filtrés", table)], orientation: "landscape" });
}
