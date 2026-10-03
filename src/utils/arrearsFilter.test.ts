import { describe, expect, it } from "vitest";
import { matchesArrearsFilter, validateArrearsTotals } from "./arrearsFilter";
describe("borne des arriérés par devise", () => {
  it.each([0, 10, 30, 50, 100])("inclut >= et exclut < à %s", (amount) => {
    const total = { USD: amount, CDF: 9000 };
    expect(matchesArrearsFilter(total, { minimum: String(amount), maximum: "", currency: "USD" })).toBe(true);
    expect(matchesArrearsFilter(total, { minimum: "", maximum: String(amount), currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter(total, { minimum: String(amount), maximum: String(amount + 1), currency: "USD" })).toBe(true);
  });
  it("ne mélange pas les devises et ne convertit pas l'inconnu en zéro", () => {
    const filter = { minimum: "100", maximum: "10000", currency: "USD" as const };
    expect(matchesArrearsFilter({ USD: 65, CDF: 9000 }, filter)).toBe(false);
    expect(matchesArrearsFilter({ USD: 65, CDF: 9000 }, { ...filter, currency: "CDF" })).toBe(true);
    expect(matchesArrearsFilter(undefined, { ...filter, minimum: "", maximum: "1" })).toBe(false);
    expect(() => validateArrearsTotals({}, ["missing"])).toThrow();
  });
});
