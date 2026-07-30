import { describe, expect, it } from "vitest";
import { isSchoolAiAssistantEnabled, schoolAiUsageThisMonth, validateSchoolAiMonthlyLimit } from "./schoolAiAssistant";

describe("paramètre Assistant IA d’une école", () => {
  it("est activé uniquement par la valeur booléenne true", () => {
    expect(isSchoolAiAssistantEnabled({ aiAssistant: { enabled: true } })).toBe(true);
    expect(isSchoolAiAssistantEnabled({ aiAssistant: { enabled: false } })).toBe(false);
  });

  it("est désactivé par défaut pour les anciens documents", () => {
    expect(isSchoolAiAssistantEnabled({})).toBe(false);
    expect(isSchoolAiAssistantEnabled(undefined)).toBe(false);
  });

  it("normalise le compteur du mois et les valeurs absentes", () => {
    expect(schoolAiUsageThisMonth({ enabled: true }, "2026-07")).toMatchObject({ monthlyLimit: 25, monthlyUsage: 0, remaining: 25, limitReached: false });
    expect(schoolAiUsageThisMonth({ enabled: true, monthlyLimit: 5, monthlyUsage: 5, usageMonth: "2026-07" }, "2026-07")).toMatchObject({ monthlyLimit: 5, monthlyUsage: 5, remaining: 0, limitReached: true });
    expect(schoolAiUsageThisMonth({ enabled: true, monthlyLimit: 5, monthlyUsage: 4, usageMonth: "2026-06" }, "2026-07").monthlyUsage).toBe(0);
  });

  it("valide uniquement un entier entre 1 et 1000", () => {
    expect(validateSchoolAiMonthlyLimit(1)).toBe(true);
    expect(validateSchoolAiMonthlyLimit(1000)).toBe(true);
    for (const value of [0, 1001, 1.5, Number.NaN]) expect(validateSchoolAiMonthlyLimit(value)).toBe(false);
  });
});
