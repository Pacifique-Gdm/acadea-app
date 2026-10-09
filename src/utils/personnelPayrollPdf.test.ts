import { describe, expect, it } from "vitest";
import type { PersonnelPayment } from "../types";
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
});
