import { beforeEach, describe, expect, it, vi } from "vitest";
import type { School, SchoolYear } from "../types";

const render = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("./pdf", () => ({
  escapePdfHtml: (value: unknown) => String(value),
  pdfInfoGrid: (rows: Array<{ label: string; value: string | number }>) => rows.map((row) => `${row.label}:${row.value}`).join("|"),
  pdfSection: (title: string, body: string, options?: { pageBreakBefore?: boolean }) =>
    `${options?.pageBreakBefore ? "[PAGE_BREAK]" : ""}${title}|${body}`,
  pdfTable: (columns: Array<{ render: (item: Record<string, unknown>) => string }>, rows: Array<Record<string, unknown>>) =>
    rows.map((row) => columns.map((column) => column.render(row)).join("|")).join("|"),
  renderAcadPdfPreview: render,
}));

import { dashboardPdfTransactionChart, exportDashboardReportPdf } from "./dashboardPdf";

const school = { id: "school-a", name: "École fictive", currency: "USD" } as School;
const year = { id: "year-a", name: "2026-2027", schoolId: "school-a", currency: "CDF" } as SchoolYear;
const options = {
  school, year, sectionLabel: "Toutes", dateLabel: "Année complète", recoveryRate: 20,
  totalPayments: 1000, arrearsCollections: [{ currency: "USD" as const, amount: 12 }],
  historicalArrears: { USD: 30, CDF: 4000 }, totalExpenses: 200, official: 6000, reduction: 1000,
  expected: 5000, remaining: 4000,
  transactions: [{ id: "payment-a", type: "Paiement", label: "Test", amount: 1000, currency: "CDF" as const, date: "2026-10-13" }],
  classRows: [{ className: "1ère Humanité Sciences", girls: 1, boys: 2, total: 3 }],
  totalGirls: 1, totalBoys: 2, totalStudents: 3, totalClasses: 1, totalParents: 2,
  administrators: 1, cashiers: 1, disciplineDirectors: 1,
  feeProgressRows: [{ name: "Minerval", official: 6000, reduction: 1000, expected: 5000, paid: 1000, remaining: 4000, rate: 20 }],
  feeShares: [{ name: "Minerval", amount: 1000, percentage: 20 }, { name: "Impayés", amount: 4000, percentage: 80 }],
  transactionChartRows: [{ date: "2026-10-13", label: "13 oct.", payments: 1000, expenses: 200 }],
  transactionPeriodLabel: "5 derniers jours",
};

describe("Dashboard PDF — couverture et devises", () => {
  beforeEach(() => render.mockClear());

  it("réserve un espace lisible entre la période et la première ligne du graphique partagé", () => {
    const chart = dashboardPdfTransactionChart(options.transactionChartRows, "CDF", options.transactionPeriodLabel);
    expect(chart).toMatch(/^<p style="[^"]*margin:0 0 8px;[^"]*line-height:1\.4[^"]*">Période :/);
    expect(chart).toContain('aria-label="Graphique des transactions"');
  });

  it("reprend les indicateurs, frais, arriérés, graphiques et classes de l'écran sans mélanger USD et CDF", async () => {
    await exportDashboardReportPdf(options);
    const pdf = render.mock.calls[0]?.[0];
    const sections = pdf.sections.join(" ");
    expect(pdf.year).toBe(year);
    expect(pdf.subtitle).toContain("Toutes");
    expect(pdf.throwOnError).toBe(true);
    expect(sections).toContain("Nombre total d'élèves:3");
    expect(sections).toContain("Nombre total de parents:2");
    expect(sections).toContain("Montant officiel:6 000,00 FC");
    expect(sections).toContain("Réductions et exonérations:1 000,00 FC");
    expect(sections).toContain("Dettes historiques (CDF):4 000,00 FC");
    expect(sections).toContain("Dettes historiques (USD):$30,00");
    expect(sections).toContain("Arriérés encaissés (USD):$12,00");
    expect(sections).toContain("Minerval");
    expect(sections).toContain("Graphique des transactions");
    expect(sections).toContain("Répartition des montants");
    expect(sections).toContain("1ère Humanité Sciences");
    expect(sections).not.toContain("$1 000,00");
  });

  it("refuse l'export si une transaction a une devise différente de l'année", async () => {
    await expect(exportDashboardReportPdf({
      ...options, transactions: [{ ...options.transactions[0], currency: "USD" }],
    })).rejects.toThrow("devise différente");
    expect(render).not.toHaveBeenCalled();
  });

  it("conserve la période et omet la bande lorsqu'aucun arriéré n'est encaissé", async () => {
    await exportDashboardReportPdf({ ...options, dateLabel: "2026-09-01 au 2026-09-30",
      arrearsCollections: [] });
    const pdf = render.mock.calls[0]?.[0];
    expect(pdf.subtitle).toContain("2026-09-01 au 2026-09-30");
    expect(pdf.sections.join(" ")).not.toContain("Arriérés encaissés pendant la période");
  });

  it("n'ajoute pas une page blanche avant le graphique après un tableau déjà paginé", async () => {
    await exportDashboardReportPdf(options);
    const sections: string[] = render.mock.calls[0]?.[0].sections ?? [];
    expect(sections.find((section) => section.includes("Graphique des transactions"))).not.toContain("[PAGE_BREAK]");
    expect(sections.find((section) => section.includes("Élèves par classe"))).toContain("[PAGE_BREAK]");
  });
});
