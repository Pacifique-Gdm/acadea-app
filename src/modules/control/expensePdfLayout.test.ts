import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Justificatif de dépense", () => {
  const source = readFileSync("src/utils/pdf.ts", "utf8");
  const controlSource = readFileSync("src/modules/control/ControlModule.tsx", "utf8");

  it("conserve le titre principal et retire seulement le sous-titre Dépense", () => {
    expect(source).toContain('"Justificatif de dépense"');
    expect(source).toContain('class="pdf-section expense-details"');
    expect(source).not.toContain('pdfSection("Dépense"');
    expect(controlSource).toContain("generateExpensePdf(expense, school, year");
  });
});
