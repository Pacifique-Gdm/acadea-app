import { describe, expect, it, vi } from "vitest";
import type { School } from "../types";
import type { PayrollHistoryEntry } from "../services/personnelPayroll";
import { collectPayrollHistoryForExport, MAX_PAYROLL_EXPORT_ROWS, personnelPayrollHistoryPdfSections } from "./personnelPayrollHistoryExport";

const payment = (id: string, schoolId = "school-a", currency: "CDF" | "USD" = "CDF") => ({
  id, schoolId, kind: "salary", paidAt: "2026-10-10", beneficiaryName: "Personnel fictif", reference: id,
  amount: 100, netPaid: 80, currency,
}) as PayrollHistoryEntry;
const schools = [{ id: "school-a", name: "École A" }] as School[];

describe("export sécurisé de l'historique Salaire/Prime", () => {
  it("récupère plusieurs pages filtrées sans doublon, pas seulement la page visible", async () => {
    const pages = [
      { payments: Array.from({ length: 50 }, (_, index) => payment("pay-" + index)), nextCursor: { paidAt: "2026-10-10", id: "pay-49" } },
      { payments: [payment("pay-49"), payment("pay-50")], nextCursor: null },
    ];
    const load = vi.fn(async () => pages.shift()!);
    const result = await collectPayrollHistoryForExport("school-a", "2026-10-01", "2026-10-31", load);
    expect(result).toHaveLength(51);
    expect(load).toHaveBeenNthCalledWith(2, "school-a", { paidAt: "2026-10-10", id: "pay-49" }, { startDate: "2026-10-01", endDate: "2026-10-31" });
  });
  it("refuse explicitement un volume supérieur à la limite", async () => {
    let index = 0;
    const load = vi.fn(async () => {
      const start = index++ * 50;
      return { payments: Array.from({ length: 50 }, (_, offset) => payment("pay-" + (start + offset))),
        nextCursor: { paidAt: "2026-10-10", id: "pay-" + (start + 49) } };
    });
    await expect(collectPayrollHistoryForExport("", "", "", load)).rejects.toThrow(String(MAX_PAYROLL_EXPORT_ROWS));
    expect(load).toHaveBeenCalledTimes(10);
  });
  it("sépare les devises, échappe les noms et refuse une école hors périmètre", () => {
    const sections = personnelPayrollHistoryPdfSections([payment("a"), payment("b", "school-a", "USD")], schools).join("");
    expect(sections).toContain("TOTAUX PAR DEVISE");
    expect(sections).toContain("École A");
    expect(sections).toContain("FC");
    expect(sections).toContain("USD");
    expect(() => personnelPayrollHistoryPdfSections([payment("foreign", "school-b")], schools)).toThrow("hors périmètre");
    expect(personnelPayrollHistoryPdfSections([], schools).join("")).toContain("Aucun salaire ou prime");
  });
});
