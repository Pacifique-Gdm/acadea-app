import { describe, expect, it } from "vitest";
import { formatCurrencyMoney, formatSchoolMoney, resolveSchoolCurrency, resolveSchoolYearCurrency, schoolCurrencySymbol, schoolWithYearCurrency } from "./currency";

describe("devise d'école", () => {
  it("utilise USD comme fallback historique", () => {
    expect(resolveSchoolCurrency({})).toBe("USD");
    expect(schoolCurrencySymbol({})).toBe("$");
    expect(formatSchoolMoney(12, {})).toBe("$12,00");
  });

  it("rend le franc congolais", () => {
    expect(schoolCurrencySymbol({ currency: "CDF" })).toBe("FC");
    expect(formatSchoolMoney(12, { currency: "CDF" })).toBe("12,00 FC");
  });

  it("formate directement une valeur dans sa devise d'origine", () => {
    expect(formatCurrencyMoney(1360, "USD").replace(/[\u00a0\u202f]/g, " ")).toBe("$1 360,00");
    expect(formatCurrencyMoney(2450000, "CDF").replace(/[\u00a0\u202f]/g, " ")).toBe("2 450 000,00 FC");
  });

  it("résout la devise annuelle avant le fallback école", () => {
    expect(resolveSchoolYearCurrency({ currency: "USD" }, { currency: "CDF" })).toBe("USD");
    expect(resolveSchoolYearCurrency({ currency: "CDF" }, { currency: "USD" })).toBe("CDF");
    expect(resolveSchoolYearCurrency({}, { currency: "CDF" })).toBe("CDF");
    expect(schoolWithYearCurrency({ id: "school", currency: "CDF" } as import("../types").School, { currency: "USD" }).currency).toBe("USD");
  });
});
