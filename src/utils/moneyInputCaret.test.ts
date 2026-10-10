import { describe, expect, it } from "vitest";
import { formatMoneyInput, parseMoneyInput } from "./currency";
import { moneyInputCaret } from "./moneyInputCaret";

describe("saisie monétaire française en temps réel", () => {
  it("groupe les milliers sans changer la valeur normalisée", () => {
    expect(formatMoneyInput("1000")).toBe("1 000");
    expect(formatMoneyInput("12500")).toBe("12 500");
    expect(formatMoneyInput("1500000")).toBe("1 500 000");
    expect(formatMoneyInput("1250000.50")).toBe("1 250 000,50");
    expect(parseMoneyInput("1 250 000,50")).toBe("1250000.50");
  });
  it("stabilise le curseur pendant la saisie au milieu, la suppression et le collage", () => {
    expect(moneyInputCaret("1234", 2, "1 234")).toBe(3);
    expect(moneyInputCaret("1 234", 3, "1 234")).toBe(3);
    expect(moneyInputCaret("1250000,50", 8, "1 250 000,50")).toBe(10);
    expect(moneyInputCaret("12", 1, "12")).toBe(1);
  });
});
