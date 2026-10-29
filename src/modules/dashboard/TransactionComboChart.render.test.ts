import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TransactionComboChart } from "./Dashboard";

const rows = [{
  date: "2026-10-29",
  label: "29 octobre",
  payments: 3_000_001,
  expenses: 1_500_000,
  transactions: [],
}];

function renderedAxis(currency: "CDF" | "USD") {
  return renderToStaticMarkup(createElement(TransactionComboChart, {
    rows,
    period: "today",
    onPeriodChange: () => {},
    currency,
  })).replace(/[\u00a0\u202f]/g, " ");
}

describe("rendu SVG du graphique financier partagé", () => {
  it("affiche les graduations CDF sans couper le montant maximal", () => {
    const svg = renderedAxis("CDF");
    expect(svg).toContain("0 FC");
    expect(svg).toContain("1 500 000 FC");
    expect(svg).toContain("3 000 000 FC");
    expect(svg).toContain("4 500 000 FC");
    expect(svg).toContain('viewBox="0 0 560 180"');
  });

  it("conserve les graduations USD existantes", () => {
    const svg = renderedAxis("USD");
    expect(svg).toContain(">1 500</text>");
    expect(svg).toContain(">3 000</text>");
    expect(svg).toContain(">4 500</text>");
    expect(svg).not.toContain(" FC");
  });
});
