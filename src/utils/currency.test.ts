import { describe, expect, it } from "vitest";
import { formatSchoolMoney, resolveSchoolCurrency, schoolCurrencySymbol } from "./currency";

describe("devise d'école", () => {
  it("utilise USD comme fallback historique", () => {
    expect(resolveSchoolCurrency({})).toBe("USD");
    expect(schoolCurrencySymbol({})).toBe("$");
    expect(formatSchoolMoney(12, {})).toBe("$12.00");
  });

  it("rend le franc congolais", () => {
    expect(schoolCurrencySymbol({ currency: "CDF" })).toBe("FC");
    expect(formatSchoolMoney(12, { currency: "CDF" })).toBe("12.00 FC");
  });
});
