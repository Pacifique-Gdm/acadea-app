import { describe, expect, it } from "vitest";
import { arrearsFilterForCriterion, matchesArrearsFilter, validateArrearsTotals } from "./arrearsFilter";
describe("borne des arriérés par devise", () => {
  it("convertit uniquement le critère sélectionné et le champ extérieur en borne canonique", () => {
    expect(arrearsFilterForCriterion("arrears-gte", "65")).toEqual({ minimum: "65", maximum: "" });
    expect(arrearsFilterForCriterion("arrears-lt", "65.5")).toEqual({ minimum: "", maximum: "65.5" });
    expect(arrearsFilterForCriterion("school:school-a:arrears:gte", "0")).toEqual({ minimum: "0", maximum: "" });
    expect(arrearsFilterForCriterion("school:school-b:arrears:lt", "9000")).toEqual({ minimum: "", maximum: "9000" });
    for (const comparator of ["", "all-fees-gte", "school:school-a:fee:fee-a:gte"]) expect(arrearsFilterForCriterion(comparator, "65")).toEqual({ minimum: "", maximum: "" });
    for (const threshold of ["", "nope", "-1"]) expect(arrearsFilterForCriterion("arrears-gte", threshold)).toEqual({ minimum: "", maximum: "" });
  });
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
