import { describe, expect, it } from "vitest";
import { feeTypeBusinessKey, normalizeFeeTypeIdentityPart } from "./feeTypeIdentity";

describe("identité métier des types de frais", () => {
  it("normalise Unicode, casse et espaces", () => {
    expect(normalizeFeeTypeIdentityPart("  MINERVAL   SCOLAIRE ")).toBe("minerval scolaire");
    expect(normalizeFeeTypeIdentityPart("Re\u0301inscription")).toBe(normalizeFeeTypeIdentityPart("Réinscription"));
  });

  it("refuse conceptuellement le même frais dans la même classe mais distingue une autre classe", () => {
    const base = { schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100 };
    expect(feeTypeBusinessKey({ ...base, className: "6ème Primaire" })).toBe(feeTypeBusinessKey({ ...base, name: "  MINERVAL ", className: "6ème Primaire" }));
    expect(feeTypeBusinessKey({ ...base, className: "6ème Primaire" })).not.toBe(feeTypeBusinessKey({ ...base, className: "5ème Primaire" }));
  });

  it("utilise classOptionKey comme cible opérationnelle lorsqu'elle existe", () => {
    const base = { schoolId: "school-a", schoolYearId: "year-a", name: "Minerval", amount: 100, className: "2ème Humanité" as const };
    expect(feeTypeBusinessKey({ ...base, classOptionKey: "2ème Humanité::Littéraire" })).not.toBe(feeTypeBusinessKey({ ...base, classOptionKey: "2ème Humanité::Scientifique" }));
  });
});
