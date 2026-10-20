import type { School, SchoolYear } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { ConsolidatedClassReport, ConsolidatedStudent } from "./consolidatedGrades";
import { consolidatedPeriodLabels, consolidatedSelection, type ConsolidatedFilter, type ConsolidatedTab } from "./consolidatedGradesDisplay";
import { percentageRankLabel } from "./percentageRankLabel";
import type { EditableGradingSlot } from "./teacherGrading";

export function consolidatedStudentName(row: ConsolidatedStudent) {
  return [row.student.nom, row.student.postnom, row.student.prenom].filter(Boolean).join(" ");
}

export function consolidatedScoreLabel(row: ConsolidatedStudent, courseKey: string, slot: EditableGradingSlot) {
  const score = row.scores[courseKey]?.[slot];
  const maximum = row.maxima[courseKey]?.[slot];
  if (row.statuses[courseKey]?.[slot] === "absent") return "Absent";
  if (score === null || score === undefined) return "—";
  return maximum === null || maximum === undefined ? String(score) : `${score} / ${maximum}`;
}

export function consolidatedGradesPdfSections(report: ConsolidatedClassReport, tab: ConsolidatedTab, filter: ConsolidatedFilter, className: string) {
  const { slots, courses, students } = consolidatedSelection(report, tab, filter);
  const scope = `<p><strong>Classe :</strong> ${escapePdfHtml(className)} · <strong>Filtre :</strong> ${escapePdfHtml(filter.mode === "period" ? filter.choice ? consolidatedPeriodLabels[filter.choice as EditableGradingSlot] : "Toutes les périodes" : filter.mode === "course" ? filter.choice ? courses[0]?.name ?? "Cours indisponible" : "Tous les cours" : filter.mode === "student" ? students[0] ? consolidatedStudentName(students[0]) : "Élève non sélectionné" : `${consolidatedPeriodLabels[filter.placeSlot]} · place ${filter.choice}`)}</p>`;
  if (tab === "ranking") return [pdfSection("PALMARÈS", scope + pdfTable([
    { header: "Élève", render: consolidatedStudentName },
    ...slots.map((slot) => ({ header: consolidatedPeriodLabels[slot], render: (row: ConsolidatedStudent) => percentageRankLabel(row.evaluations[slot].percentage, row.evaluations[slot].rank) })),
  ], students, "Aucun résultat pour ce filtre."))];
  return (courses.length ? courses : [undefined]).map((course) => pdfSection(course?.name ?? "Tableau de cotes", scope + pdfTable([
    { header: "Élève", render: consolidatedStudentName },
    ...slots.map((slot) => ({ header: consolidatedPeriodLabels[slot], render: (row: ConsolidatedStudent) => course ? consolidatedScoreLabel(row, course.key, slot) : "—" })),
  ], students, "Aucune cote pour ce filtre.")));
}

export async function exportConsolidatedGradesPdf(input: { report: ConsolidatedClassReport; tab: ConsolidatedTab; filter: ConsolidatedFilter; school: School; year: SchoolYear; className: string }) {
  await renderAcadPdfPreview({
    filename: `fiche-consolidee-${input.year.id}-${input.tab}.pdf`,
    title: input.tab === "grades" ? "Tableau de cotes" : "PALMARÈS",
    school: input.school,
    year: input.year,
    orientation: "landscape",
    throwOnError: true,
    sections: consolidatedGradesPdfSections(input.report, input.tab, input.filter, input.className),
  });
}
