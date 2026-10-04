import { expect, it } from "vitest";
import { controlArrearsPdfSections } from "./controlArrearsPdf";
import type { HistoricalDebt } from "../services/financialTransactions";

it("imprime uniquement les dettes historiques restantes dans la devise de l'école", () => {
  const student = { id: "s", nom: "Finance", postnom: "", prenom: "Élève", matricule: "M-1" };
  const debt = (feeName: string, expected: number, paid: number, currency: "USD" | "CDF", yearName: string): HistoricalDebt => ({
    studentId: "s", schoolYearId: yearName, yearName, feeTypeId: feeName, feeName, expected, paid, remaining: Math.max(expected - paid, 0), currency,
  });
  const sections = controlArrearsPdfSections([student], { s: [
    debt("Dette historique A", 100, 60, "USD", "2024-2025"),
    debt("Dette historique B", 30, 5, "USD", "2025-2026"),
    debt("Dette soldée", 20, 20, "USD", "2025-2026"),
    debt("Dette autre devise", 10000, 1000, "CDF", "2023-2024"),
  ] }, "USD").join(" ");
  expect(sections).toContain("65,00");
  expect(sections).toContain("Dette historique A");
  expect(sections).toContain("Dette historique B");
  expect(sections).not.toContain("Dette soldée");
  expect(sections).not.toContain("Dette autre devise");
  expect(sections).not.toContain("10 000,00");
});
