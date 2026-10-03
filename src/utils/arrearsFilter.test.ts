import { describe, expect, it } from "vitest";
import { matchesArrearsFilter, validateArrearsTotals } from "./arrearsFilter";
describe("borne des arriérés par devise", () => {
  it.each([0, 10, 30, 50, 100])("inclut >= et exclut < à %s", (amount) => {
    const total = { USD: amount, CDF: 9000 };
    expect(matchesArrearsFilter(total, { minimum: String(amount), maximum: "" }, { currency: "USD" })).toBe(true);
    expect(matchesArrearsFilter(total, { minimum: "", maximum: String(amount) }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter(total, { minimum: String(amount), maximum: String(amount + 1) }, { currency: "USD" })).toBe(true);
  });
  it("ne mélange pas les devises et ne convertit pas l'inconnu en zéro", () => {
    const filter = { minimum: "100", maximum: "10000" };
    expect(matchesArrearsFilter({ USD: 65, CDF: 9000 }, filter, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter({ USD: 65, CDF: 9000 }, filter, { currency: "CDF" })).toBe(true);
    expect(matchesArrearsFilter(undefined, { ...filter, minimum: "", maximum: "1" }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter({ USD: 0, CDF: 9000 }, { minimum: "1", maximum: "" }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter({ USD: 0, CDF: 9000 }, { minimum: "1", maximum: "" }, { currency: "CDF" })).toBe(true);
    expect(() => validateArrearsTotals({}, ["missing"])).toThrow();
  });
  it("gère zéro, bornes égales ou inversées et filtre vide", () => {
    const none = { USD: 0, CDF: 0 };
    expect(matchesArrearsFilter(none, { minimum: "0", maximum: "1" }, { currency: "USD" })).toBe(true);
    expect(matchesArrearsFilter(none, { minimum: "", maximum: "0" }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter(none, { minimum: "0", maximum: "0" }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter({ USD: 150, CDF: 0 }, { minimum: "500", maximum: "100" }, { currency: "USD" })).toBe(false);
    expect(matchesArrearsFilter(undefined, { minimum: "", maximum: "" }, { currency: "USD" })).toBe(true);
  });
});
