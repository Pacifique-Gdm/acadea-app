import { describe, expect, it } from "vitest";
import { isSchoolSectionConfirmation, SCHOOL_SECTION_CONFIRMATIONS } from "./schoolSectionConfirmation";

describe("confirmation des sections école", () => {
  it.each([
    ["check", "COCHER CETTE SECTION"],
    ["uncheck", "DÉCOCHER CETTE SECTION"],
  ] as const)("accepte uniquement la phrase exacte pour %s", (action, expected) => {
    expect(SCHOOL_SECTION_CONFIRMATIONS[action]).toBe(expected);
    expect(isSchoolSectionConfirmation(action, expected)).toBe(true);
    for (const value of ["", expected.slice(0, -1), `${expected} !`, action === "check" ? SCHOOL_SECTION_CONFIRMATIONS.uncheck : SCHOOL_SECTION_CONFIRMATIONS.check]) {
      expect(isSchoolSectionConfirmation(action, value)).toBe(false);
    }
  });
});
