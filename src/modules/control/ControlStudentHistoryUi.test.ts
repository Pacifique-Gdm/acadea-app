import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ControlModule.tsx", import.meta.url), "utf8");

describe("Contrôle — historique financier individuel Admin/Caissier", () => {
  it("retire seulement le libellé visuel, pas l'historique ni le PDF", () => {
    expect(source).not.toContain('>Historique individuel</p>');
    expect(source).toContain('title: action === "print" ? "Historique individuel des paiements"');
    expect(source).toContain("selectedHistoryFeeSummaries.map");
  });

  it("aligne les trois montants formatés dans trois colonnes à toutes les largeurs", () => {
    const expected = source.indexOf('["Total attendu", selectedHistoryFeeTotals.expected]');
    const paid = source.indexOf('["Total payé", selectedHistoryFeeTotals.paid]');
    const remaining = source.indexOf('["Total restant", selectedHistoryFeeTotals.remaining]');
    expect(expected).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(expected);
    expect(remaining).toBeGreaterThan(paid);
    expect(source).toContain('grid-cols-3 divide-x divide-slate-200');
    expect(source).toContain('min-w-0 px-1 py-2 text-center sm:px-3');
    expect(source).toContain("{formatMoney(amount)}");
  });
});
