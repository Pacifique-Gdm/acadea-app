import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { School, SchoolYear, Student } from "../../types";
import type { ConsolidatedClassReport, ConsolidatedEvaluation } from "./consolidatedGrades";
import { ConsolidatedGradesView } from "./ConsolidatedGradesView";
import { consolidatedSelection, rankingPlaces, type ConsolidatedFilter } from "./consolidatedGradesDisplay";
import { consolidatedGradesPdfSections } from "./consolidatedGradesPdf";
import { editableGradingSlots } from "./teacherGrading";

const empty: ConsolidatedEvaluation = { score: null, maximum: null, percentage: null, rank: null, complete: false };
const evaluation = (percentage: number, rank: number): ConsolidatedEvaluation => ({ score: percentage, maximum: 100, percentage, rank, complete: true });
const student = (id: string, nom: string, prenom: string): Student => ({ id, schoolId: "school", schoolYearId: "year", matricule: id, nom, postnom: "", prenom, sexe: "F", birthDate: "2010-01-01", address: "", phone: "", className: "1ère Humanité" });
const report = {
  courses: [{ key: "math", classId: "class-a", subjectId: "math", name: "Mathématiques" }, { key: "fr", classId: "class-a", subjectId: "fr", name: "Français" }],
  students: [
    { student: student("a", "Mbuyi", "Aline"), scores: { math: { period_1: 0 }, fr: { period_1: 12 } }, maxima: { math: { period_1: 20 }, fr: { period_1: 20 } }, statuses: { math: { period_1: "graded" } }, evaluations: { period_1: evaluation(50, 1), period_2: empty, semester_1_exam: empty, period_3: empty, period_4: empty, semester_2_exam: empty } },
    { student: student("b", "Kabeya", "Benoît"), scores: { math: { period_1: 9 } }, maxima: { math: { period_1: 20 } }, statuses: { math: { period_1: "graded" } }, evaluations: { period_1: evaluation(50, 1), period_2: empty, semester_1_exam: empty, period_3: empty, period_4: empty, semester_2_exam: empty } },
  ],
} as ConsolidatedClassReport;
const filter = (mode: ConsolidatedFilter["mode"], choice = "", placeSlot: ConsolidatedFilter["placeSlot"] = "period_1"): ConsolidatedFilter => ({ mode, choice, placeSlot });

describe("fiche consolidée commune", () => {
  it("présente un seul tableau, deux onglets et les choix globaux en premier", () => {
    const html = renderToStaticMarkup(createElement(ConsolidatedGradesView, { report, school: { id: "school", name: "École" } as School, year: { id: "year", name: "2027-2028" } as SchoolYear, className: "Classe A" }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Toutes les périodes");
    expect(html).not.toContain("Tous les cours");
    expect(html).toContain("0 / 20");
    expect(html).not.toContain('aria-label="Palmarès"');
    expect(html.match(/<table/g)).toHaveLength(1);
  });

  it("filtre les six périodes, les cours et les élèves sans altérer les données", () => {
    expect(consolidatedSelection(report, "grades", filter("period")).slots).toEqual([...editableGradingSlots]);
    expect(consolidatedSelection(report, "ranking", filter("period", "period_2")).slots).toEqual(["period_2"]);
    expect(consolidatedSelection(report, "grades", filter("course")).courses).toHaveLength(2);
    expect(consolidatedSelection(report, "grades", filter("course", "math")).courses.map((course) => course.key)).toEqual(["math"]);
    expect(consolidatedSelection(report, "grades", filter("student", "a")).students.map((row) => row.student.id)).toEqual(["a"]);
    expect(report.students[0].scores.math.period_1).toBe(0);
  });

  it("respecte les ex æquo et ne mélange pas les places entre périodes", () => {
    expect(rankingPlaces(report, "period_1")).toEqual([1]);
    expect(rankingPlaces(report, "period_2")).toEqual([]);
    expect(consolidatedSelection(report, "ranking", filter("place", "1")).students).toHaveLength(2);
    expect(consolidatedSelection(report, "ranking", filter("place", "1", "period_2")).students).toHaveLength(0);
  });

  it("exporte les mêmes lignes et périodes que la sélection, sans mélanger les vues", () => {
    const allGrades = consolidatedGradesPdfSections(report, "grades", filter("period"), "Classe A").join("");
    expect(allGrades).toContain("Mathématiques"); expect(allGrades).toContain("Français");
    expect(allGrades).toContain("0 / 20"); expect(allGrades).toContain("Toutes les périodes");
    const onePeriod = consolidatedGradesPdfSections(report, "grades", filter("period", "period_1"), "Classe A").join("");
    expect(onePeriod).not.toContain("2ème Période");
    const oneCourse = consolidatedGradesPdfSections(report, "grades", filter("course", "math"), "Classe A").join("");
    expect(oneCourse).not.toContain("Français");
    const ranking = consolidatedGradesPdfSections(report, "ranking", filter("place", "1"), "Classe A").join("");
    expect(ranking).toContain("PALMARÈS"); expect(ranking).toContain("Mbuyi"); expect(ranking).toContain("Kabeya");
    expect(ranking).not.toContain("Mathématiques");
  });
});
