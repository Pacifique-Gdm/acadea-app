import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AppUser } from "../types";
import { canManageSectionStudentFinances } from "./sectionAdministratorFinance";

const actor = { role: "primary_admin", schoolId: "school-a", status: "active", active: true, sectionIds: ["Primaire"] } as AppUser;
const controlSource = readFileSync(new URL("../modules/control/ControlModule.tsx", import.meta.url), "utf8");

describe("section administrator financial interface", () => {
  it("requires an activated, active profile with valid sections in its own school", () => {
    expect(canManageSectionStudentFinances(actor, "school-a", false)).toBe(true);
    for (const invalid of [{ ...actor, active: false }, { ...actor, status: "inactive" },
      { ...actor, sectionIds: [] }, { ...actor, sectionIds: ["unknown"] }, { ...actor, schoolId: "school-b" }]) {
      expect(canManageSectionStudentFinances(invalid as AppUser, "school-a", false)).toBe(false);
    }
    expect(canManageSectionStudentFinances(actor, "school-a", true)).toBe(false);
  });

  it("separates student payments from general accounting mutations", () => {
    expect(controlSource).toContain("const canRecordStudentPayment = canPay || canManageSectionPayments");
    expect(controlSource).toContain("if (!canRecordStudentPayment) return;");
    expect(controlSource).toMatch(/\{canRecordStudentPayment && \(\s*<FormPanel title="Enregistrer un paiement">/);
    expect(controlSource).toMatch(/\{canPay && \(\s*<FormPanel title="Enregistrer une dépense">/);
    expect(controlSource).toContain('const canManageExpenses = user.role === "school_admin"');
  });
});
