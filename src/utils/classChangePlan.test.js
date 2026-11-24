import { describe, expect, it } from "vitest";
import { planClassChangePayments } from "./classChangePlan.js";

const oldFees = [
  { id: "min-1a", name: "Minerval" }, { id: "exa-1a", name: "Frais d'examen" }, { id: "tenue", name: "Tenue" },
];
const pay = (id, feeTypeId, amountMinor, createdAt = `2026-10-0${id.slice(-1)}T08:00:00.000Z`) => ({ id, feeTypeId, amountMinor, createdAt });

describe("plan de rattachement lors d'un changement de classe (lot E)", () => {
  it("rattache Minerval → Minerval : 1ère A (100 $, payé 60 $) vers 2e A (120 $) → solde 60 $, aucun trop-perçu", () => {
    const plan = planClassChangePayments({ payments: [pay("p1", "min-1a", 6000)], oldFees, newFees: [{ id: "min-2a", name: "Minerval", netMinor: 12000 }] });
    expect(plan).toEqual({ stays: [], moves: [{ paymentId: "p1", fromFeeTypeId: "min-1a", pieces: [{ feeTypeId: "min-2a", amountMinor: 6000 }], overpaidMinor: 0 }], overpaidMinor: 0 });
  });

  it("met le surplus sur les autres frais impayés, puis compte le reste comme trop-perçu", () => {
    const plan = planClassChangePayments({
      payments: [pay("p1", "min-1a", 15000)], oldFees,
      newFees: [{ id: "min-2a", name: "Minerval", netMinor: 10000 }, { id: "exa-2a", name: "Frais d'examen", netMinor: 3000 }],
    });
    expect(plan.moves[0].pieces).toEqual([{ feeTypeId: "min-2a", amountMinor: 10000 }, { feeTypeId: "exa-2a", amountMinor: 3000 }]);
    expect(plan.overpaidMinor).toBe(2000);
  });

  it("garde en place un paiement sur un frais commun aux deux classes et en tient compte", () => {
    const plan = planClassChangePayments({
      payments: [pay("p1", "tenue", 2000), pay("p2", "exa-1a", 3000)], oldFees,
      newFees: [{ id: "tenue", name: "Tenue", netMinor: 2000 }, { id: "exa-2a", name: "Frais d'examen", netMinor: 2500 }],
    });
    expect(plan.stays).toEqual(["p1"]);
    expect(plan.moves).toEqual([{ paymentId: "p2", fromFeeTypeId: "exa-1a", pieces: [{ feeTypeId: "exa-2a", amountMinor: 2500 }], overpaidMinor: 500 }]);
  });

  it("traite les paiements du plus ancien au plus récent et ne dépasse jamais le net d'un frais", () => {
    const plan = planClassChangePayments({
      payments: [pay("p2", "min-1a", 5000), pay("p1", "min-1a", 5000)], oldFees,
      newFees: [{ id: "min-2a", name: "Minerval", netMinor: 8000 }],
    });
    expect(plan.moves.map((move) => [move.paymentId, move.pieces[0]?.amountMinor ?? 0, move.overpaidMinor])).toEqual([["p1", 5000, 0], ["p2", 3000, 2000]]);
  });

  it("refuse des montants invalides", () => {
    expect(() => planClassChangePayments({ payments: [pay("p1", "min-1a", -1)], oldFees, newFees: [] })).toThrow("Paiement invalide");
    expect(() => planClassChangePayments({ payments: [], oldFees, newFees: [{ id: "x", name: "X", netMinor: 1.5 }] })).toThrow("Frais de la nouvelle classe invalide");
  });
});
