import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("cohérence visuelle des boutons", () => {
  it("centralise l'état disabled des actions principales sans activer leur clic", () => {
    const styles = source("../../styles.css");
    expect(styles).toMatch(/\.primary-button\s*\{[\s\S]*disabled:cursor-not-allowed[\s\S]*disabled:opacity-50[\s\S]*disabled:hover:bg-ink/);

    const control = source("../../modules/control/ControlModule.tsx");
    expect(control).toContain("const isExpenseEntryIncomplete = !expenseCategory.trim()");
    expect(control).toContain("|| !expenseDescription.trim()");
    expect(control).toContain("|| !expenseBeneficiary.trim()");
    expect(control).toContain("|| !expensePaymentMethod.trim()");
    expect(control).toContain("disabled={isPaymentEntryDisabled || paymentSubmitting}");
    expect(control.match(/disabled=\{isExpenseEntryIncomplete \|\| expenseSubmitting\}/g)).toHaveLength(2);
  });

  it("utilise le style et l'icône partagés pour les sept boutons Exporter PDF", () => {
    const files = [
      "../../modules/dashboard/Dashboard.tsx",
      "../../modules/students/StudentsModule.tsx",
      "../../modules/control/ControlModule.tsx",
      "../../components/discipline/DisciplineAttendanceDrawer.tsx",
      "../../modules/secretary/SecretaryCorrespondenceModule.tsx",
      "../../modules/secretary/SecretaryReportsModule.tsx",
      "../../modules/secretary/SecretaryMedicalTools.tsx",
    ];

    for (const file of files) {
      const contents = source(file);
      expect(contents).toContain("pdf-export-button");
      expect(contents).toContain('<Download className="h-4 w-4" />');
      expect(contents).not.toMatch(/<button[^>]*className="[^"]*primary-button[^"]*"[^>]*>[\s\S]{0,160}Exporter PDF/);
    }
  });

  it("donne au bouton PDF partagé le rendu exact du bouton principal de référence", () => {
    const styles = source("../../styles.css");
    const primary = styles.match(/\.primary-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    const pdfExport = styles.match(/\.pdf-export-button\s*\{([\s\S]*?)\}/)?.[1] ?? "";
    for (const token of ["rounded", "bg-ink", "px-4", "py-2", "text-sm", "font-semibold", "text-white", "hover:bg-[#1f2f55]"]) {
      expect(primary).toContain(token);
      expect(pdfExport).toContain(token);
    }
    expect(pdfExport).toContain("focus-visible:ring-2");
    expect(pdfExport).toContain("disabled:cursor-not-allowed");
  });
});
