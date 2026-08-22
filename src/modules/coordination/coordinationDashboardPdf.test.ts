import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Coordination, School } from "../../types";
import type { CoordinationDashboardStats } from "../../utils/coordinationDashboardStats";
import { renderAcadPdfPreview } from "../../utils/pdf";
import { exportCoordinationDashboardPdf } from "./coordinationDashboardPdf";

vi.mock("../../utils/pdf", () => ({
  pdfInfoGrid: vi.fn(() => "<grid />"),
  pdfSection: vi.fn((title: string, content: string) => `<section>${title}${content}</section>`),
  pdfTable: vi.fn(() => "<table />"),
  renderAcadPdfPreview: vi.fn(async () => undefined),
}));

const coordination: Coordination = { id: "coord-a", name: "Coordination Catholique X", code: "CCX", status: "active", logoUrl: "coordination-logo", referenceSchoolYear: "2026-2027" };
const school: School = { id: "school-a", name: "École Saint Joseph", address: "Adresse école", phone: "1", email: "school@test", logoUrl: "school-logo", currency: "USD", activeSchoolYearId: "year-a", status: "active", subscriptionPlan: "Standard", subscriptionAmount: 0 };
const stats: CoordinationDashboardStats = {
  alignedSchoolIds: ["school-a"], excludedSchoolIds: [], students: [], feeTypes: [], payments: [], expenses: [], totalStudents: 3, totalClasses: 1, totalParents: 2, administrators: 1, cashiers: 1, disciplineDirectors: 1,
  classRows: [{ schoolId: "school-a", schoolName: school.name, className: "2ème Primaire", girls: 2, boys: 1, total: 3 }], totalGirls: 2, totalBoys: 1,
  financialGroups: [{ currency: "USD", expected: 100, paid: 60, expenses: 10, remaining: 40, recoveryRate: 60, feeProgressRows: [{ name: "Minerval", expected: 100, paid: 60, remaining: 40, rate: 60 }], feeShares: [{ name: "Minerval", amount: 60, percentage: 60 }, { name: "Impayés", amount: 40, percentage: 40 }], payments: [], expenseRows: [] }],
};

describe("PDF Dashboard Coordination", () => {
  beforeEach(() => vi.clearAllMocks());

  it("conserve l'identité institutionnelle Coordination avec le contexte de l'école filtrée", async () => {
    await exportCoordinationDashboardPdf({ coordination, schools: [school], selectedSchoolId: school.id, stats, sectionLabel: "Toutes les sections", dateLabel: "Année scolaire active", transactions: [] });
    expect(renderAcadPdfPreview).toHaveBeenCalledOnce();
    const options = vi.mocked(renderAcadPdfPreview).mock.calls[0][0];
    expect(options.school.name).toBe(coordination.name);
    expect(options.school.logoUrl).toBe(coordination.logoUrl);
    expect(options.subtitle).toContain(school.name);
    expect(options.sections.join(" ")).toContain("Indicateurs");
    expect(options.sections.join(" ")).toContain("KPI financier");
    expect(options.sections.join(" ")).toContain("Transactions du jour");
    expect(options.sections.join(" ")).toContain("Élèves par classe");
  });
});
