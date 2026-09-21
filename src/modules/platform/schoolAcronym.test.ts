import { describe, expect, it } from "vitest";
import { canSaveSchoolAcronym, schoolAcronymError } from "./schoolAcronym";

describe("modification sécurisée du sigle", () => {
  it.each(["", "...", " ", "A".repeat(64), "a".repeat(101)])("refuse un sigle ne donnant pas un domaine valide", (value) => {
    expect(schoolAcronymError(value)).not.toBe("");
  });

  it.each(["modifier le sigle", "Modifier le sigle", "MODIFIER SIGLE", " MODIFIER LE SIGLE", "MODIFIER LE SIGLE "])("refuse une confirmation non exacte : %s", (confirmation) => {
    expect(canSaveSchoolAcronym("LUMB", "CSL", confirmation, false)).toBe(false);
  });

  it("autorise un sigle normalisable et la phrase exacte, sans altérer la règle du domaine", () => {
    expect(canSaveSchoolAcronym("LÜ.M-B", "CSL", "MODIFIER LE SIGLE", false)).toBe(true);
    expect(canSaveSchoolAcronym("CSL", "CSL", "MODIFIER LE SIGLE", false)).toBe(false);
    expect(canSaveSchoolAcronym("LUMB", "CSL", "MODIFIER LE SIGLE", true)).toBe(false);
  });
});
