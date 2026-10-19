import { editableGradingSlots, gradingSlotLabels, type EditableGradingSlot } from "./teacherGrading";
import type { ConsolidatedClassReport, ConsolidatedStudent } from "./consolidatedGrades";
import { percentageRankLabel } from "./percentageRankLabel";

function studentName(row: ConsolidatedStudent) {
  return [row.student.nom, row.student.postnom, row.student.prenom].filter(Boolean).join(" ");
}

function scoreLabel(row: ConsolidatedStudent, courseKey: string, slot: EditableGradingSlot) {
  const score = row.scores[courseKey]?.[slot];
  const maximum = row.maxima[courseKey]?.[slot];
  if (row.statuses[courseKey]?.[slot] === "absent") return "Absent";
  if (score === null || score === undefined) return "—";
  return maximum === null || maximum === undefined ? String(score) : `${score} / ${maximum}`;
}

export function ConsolidatedGradesView({ report }: { report: ConsolidatedClassReport }) {
  return <div className="grid min-w-0 gap-5">
    <section className="min-w-0">
      <h3 className="mb-2 text-lg font-bold">Tableau de cotes</h3>
      <div className="overflow-x-auto rounded border bg-white" role="region" aria-label="Tableau de cotes" tabIndex={0}>
        <table className="min-w-max text-sm"><thead><tr><th className="sticky left-0 bg-white p-2 text-left">Élève</th>{report.courses.flatMap((course) => editableGradingSlots.map((slot) => <th key={`${course.key}-${slot}`} className="whitespace-nowrap p-2 text-left">{course.name} · {gradingSlotLabels[slot]}</th>))}</tr></thead>
          <tbody>{report.students.map((row) => <tr key={row.student.id} className="border-t"><th className="sticky left-0 bg-white p-2 text-left">{studentName(row)}</th>{report.courses.flatMap((course) => editableGradingSlots.map((slot) => <td key={`${course.key}-${slot}`} className="whitespace-nowrap p-2">{scoreLabel(row, course.key, slot)}</td>))}</tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className="min-w-0">
      <h3 className="mb-2 text-lg font-bold">PALMARÈS</h3>
      <div className="overflow-x-auto rounded border bg-white" role="region" aria-label="Palmarès" tabIndex={0}>
        <table className="min-w-max text-sm"><thead><tr><th className="sticky left-0 bg-white p-2 text-left">Élève</th>{["1ère - P", "2ème - P", "EX-1SEM", "3ème - P", "4ème - P", "EX-2SEM"].map((label) => <th key={label} className="whitespace-nowrap p-2 text-left">{label}</th>)}</tr></thead>
          <tbody>{report.students.map((row) => <tr key={row.student.id} className="border-t"><th className="sticky left-0 bg-white p-2 text-left">{studentName(row)}</th>{editableGradingSlots.map((slot) => <td key={slot} className="whitespace-nowrap p-2">{percentageRankLabel(row.evaluations[slot].percentage, row.evaluations[slot].rank)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </section>
  </div>;
}
