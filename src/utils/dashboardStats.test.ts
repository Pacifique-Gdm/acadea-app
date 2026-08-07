import { describe, expect, it } from "vitest";
import { buildDashboardFeeShares } from "./dashboardStats";

describe("répartition financière du dashboard", () => {
  it("calcule les encaissements et les impayés sur le total attendu", () => {
    const shares = buildDashboardFeeShares([
      { name: "Minerval", expected: 500, paid: 300, remaining: 200, rate: 60 },
      { name: "Transport", expected: 200, paid: 100, remaining: 100, rate: 50 },
    ]);
    expect(shares).toEqual([
      { name: "Minerval", amount: 300, percentage: (300 / 700) * 100 },
      { name: "Transport", amount: 100, percentage: (100 / 700) * 100 },
      { name: "Impayés", amount: 300, percentage: (300 / 700) * 100, color: "#dc2626" },
    ]);
  });

  it("affiche uniquement les impayés en l'absence de paiement", () => {
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 500, paid: 0, remaining: 500, rate: 0 }])).toEqual([{ name: "Impayés", amount: 500, percentage: 100, color: "#dc2626" }]);
  });

  it("gère le total nul et plafonne un surpaiement sans montant négatif", () => {
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 0, paid: 100, remaining: 0, rate: 0 }])).toEqual([]);
    expect(buildDashboardFeeShares([{ name: "Minerval", expected: 100, paid: 150, remaining: 0, rate: 150 }])).toEqual([{ name: "Minerval", amount: 100, percentage: 100 }]);
  });
});
