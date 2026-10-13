import { describe, expect, it, vi } from "vitest";
import type { School, SchoolYear } from "../types";

const render = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({
  pdfInfoGrid: (rows: Array<{ label: string; value: string | number }>) => rows.map((row) => `${row.label}:${row.value}`).join("|"),
  pdfSection: (title: string, body: string) => `${title}|${body}`,
  pdfTable: (columns: Array<{ render: (item: Record<string, unknown>) => string }>, rows: Array<Record<string, unknown>>) =>
    rows.map((row) => columns.map((column) => column.render(row)).join("|")).join("|"),
  renderAcadPdfPreview: render,
}));

import { exportDashboardReportPdf } from "./dashboardPdf";

describe("Dashboard PDF — devise de l'année scolaire", () => {
  it("utilise la devise de l'année sans réétiqueter les arriérés d'une autre devise", async () => {
    const school = { id: "school-a", name: "École fictive", currency: "USD" } as School;
    const year = { id: "year-a", name: "2026-2027", schoolId: "school-a", currency: "CDF" } as SchoolYear;
    await exportDashboardReportPdf({ school, year, sectionLabel: "Toutes", dateLabel: "Année complète",
      recoveryRate: 20, totalPayments: 1000, arrearsCollections: [{ currency: "USD", amount: 12 }],
      totalExpenses: 200, expected: 5000, remaining: 4000, transactions: [{ id: "payment-a", type: "Paiement",
        label: "Test", amount: 1000, date: "2026-10-13" }], classRows: [], totalGirls: 0, totalBoys: 0, totalStudents: 0 });
    const sections = render.mock.calls.at(-1)?.[0]?.sections.join(" ") ?? "";
    expect(sections).toContain("1 000,00 FC");
    expect(sections).toContain("200,00 FC");
    expect(sections).toContain("$12,00");
    expect(sections).not.toContain("$1 000,00");
  });
});
