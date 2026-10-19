import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConsolidatedClassReport } from "./consolidatedGrades";
import { ConsolidatedGradesView } from "./ConsolidatedGradesView";
import { percentageRankLabel } from "./percentageRankLabel";

describe("présentation de la fiche consolidée", () => {
  it("affiche deux tableaux successifs, les vraies cotes zéro et les rangs", () => {
    const empty = { score: null, maximum: null, percentage: null, rank: null, complete: false };
    const report = {
      courses: [{ key: "math", classId: "class", subjectId: "math", name: "Mathématiques" }],
      students: [{
        student: { id: "student", schoolId: "school", schoolYearId: "year", matricule: "E2E-001", nom: "Mbuyi", postnom: "", prenom: "Aline", sexe: "F", birthDate: "2010-01-01", address: "", phone: "", className: "4ème Humanité" },
        scores: { math: { period_1: 0 } }, maxima: { math: { period_1: 20 } }, statuses: { math: { period_1: "graded" } },
        evaluations: { period_1: { score: 0, maximum: 20, percentage: 0, rank: 1, complete: true }, period_2: empty,
          semester_1_exam: empty, period_3: empty, period_4: empty, semester_2_exam: empty },
      }],
    } as ConsolidatedClassReport;
    const html = renderToStaticMarkup(createElement(ConsolidatedGradesView, { report }));
    expect(html.indexOf("Tableau de cotes")).toBeLessThan(html.indexOf("PALMARÈS"));
    expect(html).toContain("0 / 20");
    expect(html).toContain("0 % / 1er");
    expect(html).toContain("overflow-x-auto");
    expect(percentageRankLabel(null, null)).toBe("—");
  });
});
