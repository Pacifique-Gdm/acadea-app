import { useState } from "react";
import type { School, SchoolYear } from "../../types";
import type { ConsolidatedClassReport } from "./consolidatedGrades";
import { consolidatedPeriodLabels, consolidatedSelection, rankingPlaces, type ConsolidatedFilter, type ConsolidatedFilterMode, type ConsolidatedTab } from "./consolidatedGradesDisplay";
import { consolidatedScoreLabel, consolidatedStudentName, exportConsolidatedGradesPdf } from "./consolidatedGradesPdf";
import { percentageRankLabel } from "./percentageRankLabel";
import { editableGradingSlots, type EditableGradingSlot } from "./teacherGrading";

const initialFilter = (): ConsolidatedFilter => ({ mode: "period", choice: "", placeSlot: "period_1" });
const gradeModes: Array<[ConsolidatedFilterMode, string]> = [["period", "Par période"], ["course", "Par cours"], ["student", "Par élèves"]];
const rankingModes: Array<[ConsolidatedFilterMode, string]> = [["period", "Par période"], ["student", "Par élèves"], ["place", "Par place"]];

export function ConsolidatedGradesView({ report, school, year, className }: { report: ConsolidatedClassReport; school: School; year: SchoolYear; className: string }) {
  const [tab, setTab] = useState<ConsolidatedTab>("grades");
  const [gradesFilter, setGradesFilter] = useState<ConsolidatedFilter>(initialFilter);
  const [rankingFilter, setRankingFilter] = useState<ConsolidatedFilter>(initialFilter);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const filter = tab === "grades" ? gradesFilter : rankingFilter;
  const updateFilter = tab === "grades" ? setGradesFilter : setRankingFilter;
  const { courses, students, slots } = consolidatedSelection(report, tab, filter);
  const requiresChoice = filter.mode === "student" || filter.mode === "place";

  async function exportPdf() {
    if (exporting || (requiresChoice && !filter.choice)) return;
    setExporting(true); setError("");
    try { await exportConsolidatedGradesPdf({ report, tab, filter, school, year, className }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Export PDF impossible. Réessayez."); }
    finally { setExporting(false); }
  }

  return <div className="grid min-w-0 gap-4">
    <div role="tablist" aria-label="Fiche consolidée" className="grid grid-cols-2 gap-2">
      <button type="button" role="tab" aria-selected={tab === "grades"} className={(tab === "grades" ? "primary-button" : "secondary-button") + " min-w-0 w-full justify-center text-center"} onClick={() => { setTab("grades"); setError(""); }}>Tableau de cotes</button>
      <button type="button" role="tab" aria-selected={tab === "ranking"} className={(tab === "ranking" ? "primary-button" : "secondary-button") + " min-w-0 w-full justify-center text-center"} onClick={() => { setTab("ranking"); setError(""); }}>PALMARÈS</button>
    </div>
    <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
      <select className="input min-w-0 w-full" aria-label="Type de filtre" value={filter.mode} onChange={(event) => updateFilter({ mode: event.target.value as ConsolidatedFilterMode, choice: "", placeSlot: filter.placeSlot })}>
        {(tab === "grades" ? gradeModes : rankingModes).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}
      </select>
      <select className="input min-w-0 w-full" aria-label="Choix correspondant" value={filter.choice} onChange={(event) => updateFilter({ ...filter, choice: event.target.value })}>
        {filter.mode === "period" ? <><option value="">Toutes les périodes</option>{editableGradingSlots.map((slot) => <option key={slot} value={slot}>{consolidatedPeriodLabels[slot]}</option>)}</>
          : filter.mode === "course" ? <><option value="">Tous les cours</option>{report.courses.map((course) => <option key={course.key} value={course.key}>{course.name}</option>)}</>
            : filter.mode === "student" ? <><option value="">Choisir un élève</option>{report.students.map((row) => <option key={row.student.id} value={row.student.id}>{consolidatedStudentName(row)}</option>)}</>
              : <><option value="">Choisir une place</option>{rankingPlaces(report, filter.placeSlot).map((rank) => <option key={rank} value={rank}>{rank}{rank === 1 ? "ère" : "ème"} place</option>)}</>}
      </select>
      <button type="button" className="pdf-export-button min-w-0 w-full justify-center" disabled={exporting || (requiresChoice && !filter.choice)} aria-busy={exporting} onClick={() => void exportPdf()}>{exporting ? "Export en cours…" : "Exporter PDF"}</button>
    </div>
    {tab === "ranking" && filter.mode === "place" && <label className="grid min-w-0 gap-1 text-sm font-semibold">Période de référence
      <select className="input min-w-0 w-full" value={filter.placeSlot} onChange={(event) => updateFilter({ ...filter, choice: "", placeSlot: event.target.value as EditableGradingSlot })}>{editableGradingSlots.map((slot) => <option key={slot} value={slot}>{consolidatedPeriodLabels[slot]}</option>)}</select>
    </label>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {tab === "grades" ? <section role="tabpanel" className="min-w-0" aria-label="Tableau de cotes">
      <div className="overflow-x-auto rounded border bg-white" role="region" aria-label="Tableau de cotes" tabIndex={0}>
        <table className="min-w-max text-sm"><thead><tr><th className="sticky left-0 bg-white p-2 text-left">Élève</th>{courses.flatMap((course) => slots.map((slot) => <th key={`${course.key}-${slot}`} className="whitespace-nowrap p-2 text-left">{course.name} · {consolidatedPeriodLabels[slot]}</th>))}</tr></thead>
          <tbody>{students.map((row) => <tr key={row.student.id} className="border-t"><th className="sticky left-0 bg-white p-2 text-left">{consolidatedStudentName(row)}</th>{courses.flatMap((course) => slots.map((slot) => <td key={`${course.key}-${slot}`} className="whitespace-nowrap p-2">{consolidatedScoreLabel(row, course.key, slot)}</td>))}</tr>)}</tbody>
        </table>
      </div>
      {students.length === 0 && <p role="status" className="mt-2 text-sm text-slate-600">Aucune cote pour ce filtre.</p>}
    </section> : <section role="tabpanel" className="min-w-0" aria-label="Palmarès">
      <div className="overflow-x-auto rounded border bg-white" role="region" aria-label="Palmarès" tabIndex={0}>
        <table className="min-w-max text-sm"><thead><tr><th className="sticky left-0 bg-white p-2 text-left">Élève</th>{slots.map((slot) => <th key={slot} className="whitespace-nowrap p-2 text-left">{consolidatedPeriodLabels[slot]}</th>)}</tr></thead>
          <tbody>{students.map((row) => <tr key={row.student.id} className="border-t"><th className="sticky left-0 bg-white p-2 text-left">{consolidatedStudentName(row)}</th>{slots.map((slot) => <td key={slot} className="whitespace-nowrap p-2">{percentageRankLabel(row.evaluations[slot].percentage, row.evaluations[slot].rank)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {students.length === 0 && <p role="status" className="mt-2 text-sm text-slate-600">Aucun résultat pour ce filtre.</p>}
    </section>}
  </div>;
}
