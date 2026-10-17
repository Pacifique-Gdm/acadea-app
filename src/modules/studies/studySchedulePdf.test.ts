import { describe, expect, it, vi } from "vitest";
import type { School, SchoolYear } from "../../types";
import { renderAcadPdfPreview } from "../../utils/pdf";
import type { PedagogicalAssignment, StudyClass, TimetableEntry } from "./studyTypes";
import { exportFilteredStudySchedulePdf } from "./studySchedulePdf";

vi.mock("../../utils/pdf", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../utils/pdf")>(),
  renderAcadPdfPreview: vi.fn(),
}));

describe("export PDF de l'horaire filtré", () => {
  it("emploie la même classe opérationnelle que le tableau sans perdre le filtre", async () => {
    const classes = [
      { id: "base", schoolId: "school", schoolYearId: "year", name: "3ème" },
      { id: "base::commerciale et gestion", schoolId: "school", schoolYearId: "year", name: "3ème Commerciale et Gestion" },
    ] as StudyClass[];
    const entries = [{ classId: "base", assignmentId: "assignment", courseScope: "option", targetOptionIds: ["base::commerciale et gestion"], dayOfWeek: "monday", periodId: "period", teacherId: "teacher", subjectId: "subject", roomId: null }] as TimetableEntry[];
    await exportFilteredStudySchedulePdf({
      school: { id: "school", name: "École test", schoolOptions: ["Commerciale et Gestion"] } as School,
      year: { id: "year", name: "2027-2028" } as SchoolYear,
      entries,
      assignments: [{ id: "assignment", classId: "base" }] as PedagogicalAssignment[],
      classes,
      teachers: [],
      subjects: [],
      periods: [],
      rooms: [],
      filterLabel: "Par classe : 3ème Commerciale et Gestion",
    });
    const rendered = vi.mocked(renderAcadPdfPreview).mock.calls.at(-1)?.[0];
    expect(rendered?.subtitle).toBe("Par classe : 3ème Commerciale et Gestion");
    expect(rendered?.sections?.[0]).toContain("3ème Commerciale et Gestion");
    expect(rendered?.sections?.[0]).not.toContain("3ème — Commerciale et Gestion");
  });
});
