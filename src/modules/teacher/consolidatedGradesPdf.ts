import type { School, SchoolYear } from "../../types";
import { escapePdfHtml, pdfSection, pdfTable, renderAcadPdfPreview } from "../../utils/pdf";
import type { ConsolidatedClassReport, ConsolidatedStudent } from "./consolidatedGrades";
import { consolidatedPeriodLabels, consolidatedSelection, type ConsolidatedFilter, type ConsolidatedTab } from "./consolidatedGradesDisplay";
import { percentageRankLabel } from "./percentageRankLabel";
import type { EditableGradingSlot } from "./teacherGrading";

const semesterOneSlots: readonly EditableGradingSlot[] = ["period_1", "period_2", "semester_1_exam"];
const semesterTwoSlots: readonly EditableGradingSlot[] = ["period_3", "period_4", "semester_2_exam"];
const allYearSlots: readonly EditableGradingSlot[] = [...semesterOneSlots, ...semesterTwoSlots];
const gradePdfPeriodHeaders: Record<EditableGradingSlot, string> = {
  period_1: "1-P",
  period_2: "2-P",
  semester_1_exam: "EX-1S",
  period_3: "3-P",
  period_4: "4-P",
  semester_2_exam: "EX-2S",
};

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

/** Match the existing cotation PDF: add only recorded grades, never substitute zero for a missing grade. */
export function consolidatedCourseTotalLabel(row: ConsolidatedStudent, courseKey: string, slots: readonly EditableGradingSlot[]) {
  const recorded = slots.filter((slot) => row.statuses[courseKey]?.[slot] !== "absent"
    && typeof row.scores[courseKey]?.[slot] === "number" && Number.isFinite(row.scores[courseKey]?.[slot]));
  if (!recorded.length) return "—";
  const sum = (values: number[]) => Number(values.reduce((total, value) => total + value, 0).toFixed(10));
  const score = sum(recorded.map((slot) => row.scores[courseKey]![slot]!));
  const maxima = recorded.map((slot) => row.maxima[courseKey]?.[slot]);
  const maximumKnown = maxima.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  const maximum = maximumKnown ? String(sum(maxima as number[])) : "—";
  return `${score} / ${maximum}${recorded.length < slots.length || !maximumKnown ? "*" : ""}`;
}

export function consolidatedGradesPdfSections(report: ConsolidatedClassReport, tab: ConsolidatedTab, filter: ConsolidatedFilter, className: string) {
  const { slots, courses, students } = consolidatedSelection(report, tab, filter);
  const scope = `<p><strong>Classe :</strong> ${escapePdfHtml(className)} · <strong>Filtre :</strong> ${escapePdfHtml(filter.mode === "period" ? filter.choice ? consolidatedPeriodLabels[filter.choice as EditableGradingSlot] : "Toutes les périodes" : filter.mode === "course" ? filter.choice ? courses[0]?.name ?? "Cours indisponible" : "Tous les cours" : filter.mode === "student" ? students[0] ? consolidatedStudentName(students[0]) : "Élève non sélectionné" : `${consolidatedPeriodLabels[filter.placeSlot]} · place ${filter.choice}`)}</p>`;
  if (tab === "ranking") return [pdfSection("PALMARÈS", scope + pdfTable([
    { header: "Élève", render: consolidatedStudentName },
    ...slots.map((slot) => ({ header: consolidatedPeriodLabels[slot], render: (row: ConsolidatedStudent) => percentageRankLabel(row.evaluations[slot].percentage, row.evaluations[slot].rank) })),
  ], students, "Aucun résultat pour ce filtre."))];
  const showTotals = slots.length === allYearSlots.length && allYearSlots.every((slot) => slots.includes(slot));
  return (courses.length ? courses : [undefined]).map((course, index) => pdfSection(course?.name ?? "Tableau de cotes", scope + pdfTable([
    { header: "ÉLÈVE", render: consolidatedStudentName },
    ...slots.flatMap((slot) => [
      { header: gradePdfPeriodHeaders[slot], render: (row: ConsolidatedStudent) => course ? consolidatedScoreLabel(row, course.key, slot) : "—" },
      ...(showTotals && slot === "semester_1_exam" ? [{ header: "TOT-1S", render: (row: ConsolidatedStudent) => course ? consolidatedCourseTotalLabel(row, course.key, semesterOneSlots) : "—" }] : []),
      ...(showTotals && slot === "semester_2_exam" ? [
        { header: "TOT-2S", render: (row: ConsolidatedStudent) => course ? consolidatedCourseTotalLabel(row, course.key, semesterTwoSlots) : "—" },
        { header: "TOT GEN", render: (row: ConsolidatedStudent) => course ? consolidatedCourseTotalLabel(row, course.key, allYearSlots) : "—" },
      ] : []),
    ]),
  ], students, "Aucune cote pour ce filtre.") + (showTotals ? '<p class="pdf-grade-total-note">* Total partiel : seules les cotes enregistrées sont additionnées. Un maximum inconnu reste non calculé ; une cote manquante n’est pas zéro.</p>' : ""), {
    className: showTotals ? "consolidated-grade-totals-section" : undefined,
    pageBreakBefore: index > 0,
  }));
}

export type ConsolidatedPdfClass = { report: ConsolidatedClassReport; className: string };

/** Separate classes and courses; each course title and table start together on a new page. */
export function consolidatedGradeClassSections(classes: readonly ConsolidatedPdfClass[], filter: ConsolidatedFilter, institution?: { schoolName: string; yearName: string }) {
  return classes.map(({ report, className }, index) => `
    ${index ? '<div class="pdf-page-break" aria-hidden="true"></div>' : ""}
    <article class="consolidated-grade-class" data-class-name="${escapePdfHtml(className)}" data-school-name="${escapePdfHtml(institution?.schoolName ?? "")}" data-year-name="${escapePdfHtml(institution?.yearName ?? "")}">
      ${index && institution ? `<p class="pdf-grade-institution">${escapePdfHtml(institution.schoolName)} · ${escapePdfHtml(institution.yearName)}</p>` : ""}
      <h2>Tableau de cotes — ${escapePdfHtml(className)}</h2>
      ${consolidatedGradesPdfSections(report, "grades", filter, className).join("")}
    </article>
  `);
}

export async function exportConsolidatedGradesPdf(input: { report: ConsolidatedClassReport; tab: ConsolidatedTab; filter: ConsolidatedFilter; school: School; year: SchoolYear; className: string; classes?: readonly ConsolidatedPdfClass[] }) {
  await renderAcadPdfPreview({
    filename: `fiche-consolidee-${input.year.id}-${input.tab}.pdf`,
    title: input.tab === "grades" ? "Tableau de cotes" : "PALMARÈS",
    school: input.school,
    year: input.year,
    orientation: input.tab === "grades" ? "portrait" : "landscape",
    throwOnError: true,
    paginateConsolidatedGrades: input.tab === "grades",
    sections: input.tab === "grades"
      ? consolidatedGradeClassSections(input.classes ?? [{ report: input.report, className: input.className }], input.filter, { schoolName: input.school.name, yearName: input.year.name })
      : consolidatedGradesPdfSections(input.report, input.tab, input.filter, input.className),
  });
}
