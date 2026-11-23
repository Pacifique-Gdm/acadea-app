import { describe, expect, it } from "vitest";
import { openingPlan, reasonReady } from "./feeAllocationOpeningPlan";

const base = { rubricIds: ["promoteur", "fonctionnement"], schoolAvailableMinor: 20000, cashExpectedMinor: 22000 };

describe("lot « 3 étapes » — calcul du solde de départ à l'écran", () => {
  it("met automatiquement le reste dans « Non affecté » et demande alors une justification (point 6)", () => {
    const plan = openingPlan({ ...base, amounts: { promoteur: "80", fonctionnement: "100" }, cash: "220" });
    expect(plan.unallocatedMinor).toBe(2000);
    expect(plan.needsUnallocatedReason).toBe(true);
    expect(plan.lines).toEqual([{ rubricId: "promoteur", amountMinor: 8000 }, { rubricId: "fonctionnement", amountMinor: 10000 }, { rubricId: "UNALLOCATED", amountMinor: 2000 }]);
    expect(plan.cashGapMinor).toBe(0);
  });
  it("tout partagé : « Non affecté » à zéro, sans justification", () => {
    const plan = openingPlan({ ...base, amounts: { promoteur: "80", fonctionnement: "120" }, cash: "220" });
    expect(plan).toMatchObject({ unallocatedMinor: 0, needsUnallocatedReason: false, error: null });
    expect(plan.lines.some(l => l.rubricId === "UNALLOCATED")).toBe(false);
  });
  it("refuse de donner aux rubriques plus que les fonds justifiés", () => {
    expect(openingPlan({ ...base, amounts: { promoteur: "150", fonctionnement: "100" }, cash: "220" }).error).toMatch("plus que les fonds");
  });
  it("calcule l'écart de caisse (point 4) et demande son motif", () => {
    const plan = openingPlan({ ...base, amounts: { promoteur: "200" }, cash: "215" });
    expect(plan).toMatchObject({ cashGapMinor: -500, needsCashGapReason: true });
  });
  it("déficit (point 2) : rubriques à zéro, tout le négatif dans « Non affecté », motif demandé", () => {
    const plan = openingPlan({ ...base, schoolAvailableMinor: -2000, cashExpectedMinor: 2000, amounts: { promoteur: "50" }, cash: "20" });
    expect(plan).toMatchObject({ deficit: true, needsDeficitReason: true, unallocatedMinor: -2000, needsUnallocatedReason: false, error: null });
    expect(plan.lines).toEqual([{ rubricId: "UNALLOCATED", amountMinor: -2000 }]);
  });
  it("un motif compte 10 caractères au moins", () => {
    expect(reasonReady("court")).toBe(false);
    expect(reasonReady("Billet manquant au comptage")).toBe(true);
  });
});
