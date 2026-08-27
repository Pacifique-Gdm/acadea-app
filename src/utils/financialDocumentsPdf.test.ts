import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pdfSource = readFileSync(new URL("./pdf.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const controlSource = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");

describe("documents financiers PDF partagés", () => {
  it("expose un générateur unique de justificatif utilisé par Contrôle et Coordination", () => {
    expect(pdfSource).toContain("export async function generateExpensePdf");
    expect(pdfSource).toContain("school,");
    expect(pdfSource).toContain("formatSchoolMoney(expense.amount, school)");
    expect(pdfSource).toContain('copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE BÉNÉFICIAIRE"]');
    expect(controlSource).toContain("generateExpensePdf(expense, school, year, resolveExpenseCashierName");
    expect(controlSource).not.toContain("async function generateExpensePdf(expense: Expense)");
  });

  it("borne le reçu et le justificatif normal sur une seule page", () => {
    expect(pdfSource.match(/singlePageFit: true/g)).toHaveLength(2);
    expect(pdfSource).toContain('copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE PARENT"],\n    singlePageFit: true');
    expect(pdfSource).toContain('copyLabels: ["EXEMPLAIRE ÉCOLE", "EXEMPLAIRE BÉNÉFICIAIRE"],\n    singlePageFit: true');
  });
});
