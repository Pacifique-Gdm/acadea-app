import { describe, expect, it } from "vitest";
import { buildDashboardFeeShares } from "./dashboardStats";

describe("répartition financière du dashboard", () => {
  it("calcule les proportions à partir des montants réellement encaissés", () => {
    const shares = buildDashboardFeeShares([
      { name: "Minerval", expected: 500, paid: 300, remaining: 200, rate: 60 },
      { name: "Transport", expected: 200, paid: 100, remaining: 100, rate: 50 },
    ]);
    expect(shares).toEqual([
      { name: "Minerval", amount: 300, percentage: 75 },
      { name: "Transport", amount: 100, percentage: 25 },
    ]);
  });

  it("ne fabrique aucune proportion quand le total est nul", () => {
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 500, paid: 0, remaining: 500, rate: 0 }])).toEqual([]);
  });
});
