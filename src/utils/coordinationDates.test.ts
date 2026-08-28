import { describe, expect, it } from "vitest";
import { financialDateRangeError, localDateInputValue, schoolYearDatesFromName } from "./coordinationDates";

describe("dates des formulaires Coordination", () => {
  it("produit une date locale sans conversion UTC", () => {
    expect(localDateInputValue(new Date(2026, 7, 28, 23, 30))).toBe("2026-08-28");
  });

  it("dérive la période Acadéa depuis le libellé annuel", () => {
    expect(schoolYearDatesFromName("2027-2028")).toEqual({ startsAt: "2027-09-01", endsAt: "2028-07-31" });
    expect(schoolYearDatesFromName("2027–2028")).toEqual({ startsAt: "2027-09-01", endsAt: "2028-07-31" });
    expect(schoolYearDatesFromName("2027-2029")).toBeNull();
  });

  it("refuse les dates futures et les plages inversées", () => {
    expect(financialDateRangeError("2026-08-29", "2026-08-29", "2026-08-28")).toContain("future");
    expect(financialDateRangeError("2026-08-28", "2026-08-27", "2026-08-28")).toContain("début");
    expect(financialDateRangeError("2026-08-27", "2026-08-28", "2026-08-28")).toBe("");
  });
});
