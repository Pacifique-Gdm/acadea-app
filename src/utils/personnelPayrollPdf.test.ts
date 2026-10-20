import { describe, expect, it } from "vitest";
import type { PersonnelPayment } from "../types";
import { formatCurrencyMoney } from "./currency";
import { personnelPaymentPdfSections } from "./personnelPayrollPdf";

const salary: PersonnelPayment = {
  id: "pay-a", schoolId: "school-a", schoolYearId: "year-a", beneficiaryId: "worker-a", beneficiaryName: "Vigile A",
  beneficiaryJobTitle: "Vigile", beneficiaryHasAccount: false, kind: "salary", periodMonth: 9, periodYear: 2026,
  paidAt: "2026-10-09", currency: "CDF", reference: "PAY-001", amount: 500000, recoveredAmount: 80000,
  recoveries: [{ advanceId: "a", reference: "A001", paidAt: "2026-09-01", amount: 50000 }, { advanceId: "b", reference: "A002", paidAt: "2026-09-15", amount: 30000 }],
  deduction: 20000, deductionReason: "Retenue validée", cnss: 15000, tax: 25000, netPaid: 360000,
  description: "", expenseId: "expense-a", createdAt: "2026-10-09T10:00:00.000Z", createdBy: "cashier-a",
};

describe("bulletin de paie", () => {
  it("détaille chaque avance, leur total, le net et les dates distinctes", () => {
    const html = personnelPaymentPdfSections(salary).join(" ");
    for (const expected of ["A001", "A002", "01/09/2026", "15/09/2026", "09/10/2026", "09/2026", "360", "Retenue validée", "CNSS", "Impôt"]) expect(html).toContain(expected);
  });
  it("produit un justificatif distinct pour une avance et un bulletin pour la prime", () => {
    const advance = personnelPaymentPdfSections({ ...salary, kind: "advance", recoveryHistory: [], recoveries: [], recoveredAmount: 0, netPaid: salary.amount }).join(" ");
    expect(advance).toContain("VERSEMENT D&#039;UNE AVANCE");
    expect(advance).not.toContain("CNSS");
    const bonus = personnelPaymentPdfSections({ ...salary, kind: "bonus" }).join(" ");
    expect(bonus).toContain("Prime");
  });
  it("dispose exactement huit cartes de paiement en deux rangées de quatre", () => {
    const section = personnelPaymentPdfSections(salary)[0];
    expect(section).toContain('grid-template-columns:repeat(4,minmax(0,1fr))');
    expect(section.match(/class="info-box"/g)).toHaveLength(8);
    expect(section.match(/class="info-grid"/g)).toHaveLength(1);
    expect(personnelPaymentPdfSections(salary)).toHaveLength(3);
  });
  it("n'affiche pas une retenue négative lorsque sa valeur est nulle", () => {
    const sections = personnelPaymentPdfSections({ ...salary, recoveredAmount: 0, recoveries: [], deduction: 0, cnss: 0, tax: 0 });
    expect(sections.join(" ")).not.toContain("−0,00 FC");
    expect(sections.join(" ")).toContain("0,00 FC");
    expect(personnelPaymentPdfSections(salary).join(" ")).toContain(`−${formatCurrencyMoney(80000, "CDF")}`);
  });
  it("affiche sans résidu le solde décimal d'une avance sur son PDF", () => {
    const sections = personnelPaymentPdfSections({ ...salary, kind: "advance", currency: "USD", amount: 150.75, recoveredAmount: 100.5, recoveries: [], netPaid: 150.75 });
    expect(sections.join(" ")).toContain("$50,25");
  });
});
