import type { School, SchoolYear } from "../../types";
import { pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import { studyDayLabel } from "./studySchedule";
import type { PublishedTimetableRow } from "./publishedTimetableService";

export type PublishedTimetableFilterType = "class" | "teacher" | "day";
export type PublishedTimetableFilters = { type: PublishedTimetableFilterType; value: string };
export const emptyPublishedTimetableFilters: PublishedTimetableFilters = { type: "class", value: "" };

type Choice = { value: string; label: string };
const classKey = (row: PublishedTimetableRow) => row.classLabel;
const teacherKey = (row: PublishedTimetableRow) => row.teacherDisplayName;
const uniqueChoices = (choices: Choice[]) => [...new Map(choices.map((choice) => [choice.value, choice])).values()]
  .sort((a, b) => a.label.localeCompare(b.label, "fr"));

export function publishedTimetableChoices(rows: PublishedTimetableRow[]): Record<PublishedTimetableFilterType, Choice[]> {
  return {
    class: uniqueChoices(rows.map((row) => ({ value: classKey(row), label: row.classLabel }))),
    teacher: uniqueChoices(rows.map((row) => ({ value: teacherKey(row), label: row.teacherDisplayName }))),
    day: [...new Set(rows.map((row) => row.dayOfWeek).filter((day) => day !== "unknown"))]
      .map((day) => ({ value: day, label: studyDayLabel(day as Exclude<PublishedTimetableRow["dayOfWeek"], "unknown">) })),
  };
}

export function filterPublishedTimetable(rows: PublishedTimetableRow[], filters: PublishedTimetableFilters) {
  const choices = publishedTimetableChoices(rows);
  const type: PublishedTimetableFilterType = ["class", "teacher", "day"].includes(filters.type) ? filters.type : "class";
  const value = choices[type].some((choice) => choice.value === filters.value) ? filters.value : "";
  return {
    filters: { type, value },
    rows: rows.filter((row) => !value || (type === "class" ? classKey(row) : type === "teacher" ? teacherKey(row) : row.dayOfWeek) === value),
    choices,
  };
}

export function publishedTimetableFilterLabel(filters: PublishedTimetableFilters, rows: PublishedTimetableRow[]) {
  if (!filters.value) return "Tous les cours";
  const selected = publishedTimetableChoices(rows)[filters.type]?.find((choice) => choice.value === filters.value);
  const prefix = { class: "Classe", teacher: "Enseignant", day: "Jour" }[filters.type];
  return selected ? `${prefix} : ${selected.label}` : "Tous les cours";
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
    year: input.year, subtitle: publishedTimetableFilterLabel(input.filters, input.rows), sections: [pdfSection("Cours filtrés", table)], orientation: "landscape" });
}
