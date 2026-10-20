import { describe, expect, it } from "vitest";
import { fromMoneyMinor, remainingMoney, sumMoney, toMoneyMinor } from "./money";

describe("calculs monétaires en centièmes USD/CDF", () => {
  it.each([
    [100.5, 100.5, 0], [150.75, 100.5, 50.25], [100, 99.99, 0.01],
  ])("calcule %s - %s = %s sans tolérance qui efface un centime", (due, paid, rest) => {
    expect(remainingMoney(due, paid)).toBe(rest);
  });
  it("additionne les paiements partiels et décimaux sans résidu flottant", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney([33.33, 33.33, 33.33])).toBe(99.99);
    expect(remainingMoney(150.75, sumMoney([100.5, 50.25]))).toBe(0);
    expect(remainingMoney(100, sumMoney([33.33, 33.33, 33.33]), 0.01)).toBe(0);
  });
  it("conserve les valeurs historiques exactes et refuse une fraction de centime", () => {
    expect(toMoneyMinor(1250.75)).toBe(125075);
    expect(fromMoneyMinor(125075)).toBe(1250.75);
    expect(toMoneyMinor(567107830.94)).toBe(56710783094);
    expect(() => toMoneyMinor(0.001)).toThrow();
    expect(() => sumMoney([Number.MAX_SAFE_INTEGER])).toThrow();
  });
});
