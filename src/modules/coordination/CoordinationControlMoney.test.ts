import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const coordinationControl = readFileSync(new URL("./CoordinationControl.tsx", import.meta.url), "utf8");
const schoolControl = readFileSync(new URL("../control/ControlModule.tsx", import.meta.url), "utf8");

describe("formatage des montants du Contrôle", () => {
  it("conserve la devise de chaque école dans les cartes et le PDF Coordination", () => {
    expect(coordinationControl).toContain("resolveSchoolYearCurrency(");
    expect(coordinationControl).toContain("year.id === student.schoolYearId && year.schoolId === student.schoolId");
    expect(coordinationControl).toContain("rowMoney(student, balance.expected)");
    expect(coordinationControl).toContain("rowMoney(row.student, row.balance.paid)");
    expect(coordinationControl).not.toContain("balance.expected.toFixed(2)");
  });

  it("conserve le format monétaire du Contrôle Administrateur/Caissier", () => {
    expect(schoolControl).toContain("return formatSchoolMoney(value, school)");
    expect(schoolControl).toContain("formatCount(visibleRows.length)");
  });
});
