import { describe, expect, it } from "vitest";
import { formatTransactionAxisTick, transactionChartAxis } from "./transactionChartAxis";

describe("graduations du graphique financier", () => {
  it("utilise des pas fixes de 1 500 000 FC et couvre le maximum CDF sans le tronquer", () => {
    const axis = transactionChartAxis([{ payments: 3_000_001, expenses: 1_500_000 }], "CDF");
    expect(axis.max).toBe(4_500_000);
    expect(axis.ticks).toEqual([0, 1_500_000, 3_000_000, 4_500_000]);
    expect(formatTransactionAxisTick(axis.ticks[1], "CDF").replace(/[\u00a0\u202f]/g, " ")).toBe("1 500 000 FC");
    expect(formatTransactionAxisTick(0, "CDF")).toBe("0 FC");
  });

  it("conserve le pas et l'affichage USD existants", () => {
    const axis = transactionChartAxis([{ payments: 3_001, expenses: 500 }], "USD");
    expect(axis.max).toBe(4_500);
    expect(axis.ticks).toEqual([0, 1_500, 3_000, 4_500]);
    expect(formatTransactionAxisTick(1_500, "USD").replace(/[\u00a0\u202f]/g, " ")).toBe("1 500");
  });

  it("affiche le premier pas même sans transaction", () => {
    expect(transactionChartAxis([], "CDF")).toEqual({ max: 1_500_000, ticks: [0, 1_500_000] });
    expect(transactionChartAxis([], "USD")).toEqual({ max: 1_500, ticks: [0, 1_500] });
  });
});
