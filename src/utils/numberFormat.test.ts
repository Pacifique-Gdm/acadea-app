import { describe, expect, it } from "vitest";
import { formatCount } from "./numberFormat";

describe("formatCount", () => {
  it.each([
    [999, "999"],
    [1000, "1 000"],
    [1250, "1 250"],
    [12500, "12 500"],
    [1250000, "1 250 000"],
  ])("formate %i avec les séparateurs français", (value, expected) => {
    expect(formatCount(value).replace(/[\u00a0\u202f]/g, " ")).toBe(expected);
  });
});
