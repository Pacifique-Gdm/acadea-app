import { describe, expect, it } from "vitest";
import type { SchoolYear } from "../types";
import { orderSchoolYears } from "./schoolYears";

const year = (name: string, status: SchoolYear["status"] = "archived") => ({
  id: name, schoolId: "school-a", name, status, startsAt: `${name.slice(0, 4)}-09-01`, endsAt: `${name.slice(5)}-07-15`, currency: "USD",
}) as SchoolYear;

describe("ordre des années scolaires", () => {
  const years = [year("2028-2029"), year("2024-2025"), year("2027-2028"), year("2026-2027", "active"), year("2025-2026")];

  it("met l'active puis les futures croissantes et les passées décroissantes, sans muter l'entrée", () => {
    expect(orderSchoolYears(years, "2026-2027").map((item) => item.name)).toEqual([
      "2026-2027", "2027-2028", "2028-2029", "2025-2026", "2024-2025",
    ]);
    expect(years[0].name).toBe("2028-2029");
  });

  it("gère une seule année, une active extrême, ou aucune active", () => {
    expect(orderSchoolYears([year("2026-2027", "active")]).map((item) => item.name)).toEqual(["2026-2027"]);
    expect(orderSchoolYears(years, "2024-2025")[0].name).toBe("2026-2027");
    expect(orderSchoolYears([year("2027-2028"), year("2025-2026")]).map((item) => item.name)).toEqual(["2025-2026", "2027-2028"]);
  });
});
