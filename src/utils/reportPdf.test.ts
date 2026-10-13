import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense, Payment, School, SchoolYear } from "../types";
import { totalsByRecordedCurrency } from "./operationCurrency";

const render = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({
  pdfInfoGrid: (rows: Array<{ label: string; value: string | number }>) => rows.map((row) => `${row.label}:${row.value}`).join("|"),
  pdfSection: (title: string, body: string) => `${title}|${body}`,
  pdfTable: (columns: Array<{ render: (item: Record<string, unknown>) => string }>, rows: Array<Record<string, unknown>>) =>
    rows.map((row) => columns.map((column) => column.render(row)).join("|")).join("|"),
  renderAcadPdfPreview: render,
}));

import { exportReportPdf } from "./reportPdf";

const school = { id: "school-a", name: "École fictive", currency: "USD" } as School;
const year = { id: "year-a", schoolId: "school-a", currency: "USD" } as SchoolYear;
const payment = { id: "payment-a", schoolId: "school-a", schoolYearId: "year-a", studentId: "student-a", feeTypeId: "fee-a", paidAt: "2026-10-13", amount: 500000, currency: "CDF" } as Payment;
const expense = { id: "expense-a", schoolId: "school-a", schoolYearId: "year-a", spentAt: "2026-10-13", amount: 200000, currency: "CDF" } as Expense;

describe("rapport financier PDF — devise historique", () => {
  beforeEach(() => render.mockClear());

  it("préserve CDF dans la synthèse et chaque ligne après changement du défaut en USD", async () => {
    await exportReportPdf(school, year, "2026-10-01", "2026-10-31", "Toutes", false,
      totalsByRecordedCurrency([payment]), totalsByRecordedCurrency([expense]), null, [payment], [expense], []);
    const sections = render.mock.calls[0]?.[0]?.sections.join(" ") ?? "";
    expect(sections).toContain("500 000,00 FC");
    expect(sections).toContain("200 000,00 FC");
    expect(sections).toContain("300 000,00 FC");
    expect(sections).not.toContain("$500");
  });

  it("refuse l'export si une dépense historique n'a pas de devise", async () => {
    const unknownExpense = { ...expense, currency: undefined };
    await expect(exportReportPdf(school, year, "2026-10-01", "2026-10-31", "Toutes", false,
      totalsByRecordedCurrency([payment]), totalsByRecordedCurrency([unknownExpense]), null, [payment], [unknownExpense], []))
      .rejects.toThrow("devise historique inconnue");
    expect(render).not.toHaveBeenCalled();
  });
});
