import { describe, expect, it } from "vitest";
import { defaultFeeAmount, formatMoneyInput, parseMoneyEdit, parseMoneyInput } from "./currency";
import { toMoneyMinor } from "./money";

describe("interactive fee amounts", () => {
  it("reproduces the strict-parser failure after the first thousand", () => {
    expect(parseMoneyInput("1 0000")).toBe("1 0000");
    expect(Number.isNaN(Number(parseMoneyInput("1 0000")))).toBe(true);
  });
  it.each(["1000", "10000", "100000", "1250000", "10000,50"])("types %s without losing digits", (keys) => {
    let canonical = "";
    for (const key of keys) canonical = parseMoneyEdit(formatMoneyInput(canonical) + key, "insertText");
    expect(canonical).toBe(keys.replace(",", "."));
    expect(toMoneyMinor(Number(canonical))).toBe(Math.round(Number(keys.replace(",", ".")) * 100));
  });
  it("regroups deletion and insertion in the middle", () => {
    expect(parseMoneyEdit("12 50", "deleteContentBackward")).toBe("1250");
    expect(parseMoneyEdit("12 9500", "insertText")).toBe("129500");
  });
  it("keeps pasted malformed amounts invalid", () => {
    for (const input of ["1 25,50", "1,000", "-10", "10abc", "1.234"]) {
      expect(parseMoneyEdit(input, "insertFromPaste")).toBe(input);
    }
    expect(parseMoneyEdit("10\u202f000,50 FC", "insertFromPaste")).toBe("10000.50");
    expect(parseMoneyEdit("1 000,123", "insertText")).toBe("1 000,123");
  });
  it("uses the requested creation defaults without changing USD", () => {
    expect(defaultFeeAmount("CDF")).toBe("10000");
    expect(formatMoneyInput(defaultFeeAmount("CDF"))).toBe("10 000");
    expect(defaultFeeAmount("USD")).toBe("100");
  });
});
