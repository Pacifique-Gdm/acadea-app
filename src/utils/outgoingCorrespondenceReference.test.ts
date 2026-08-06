import { describe, expect, it } from "vitest";
import { correspondenceServiceCode, generateOutgoingCorrespondenceReference, schoolInitials } from "./outgoingCorrespondenceReference";

describe("référence des courriers sortants", () => {
  it("construit les initiales de l'école sans les articles", () => {
    expect(schoolInitials("Le Complexe Scolaire La Lumière")).toBe("CSL");
  });

  it("centralise les codes de service connus", () => {
    expect(correspondenceServiceCode("Secrétariat", "secretary")).toBe("SEC");
    expect(correspondenceServiceCode("Direction", "secretary")).toBe("DIR");
    expect(correspondenceServiceCode("Discipline", "secretary")).toBe("DISC");
    expect(correspondenceServiceCode("Administration", "secretary")).toBe("ADM");
  });

  it("formate une séquence annuelle par école et service", () => {
    expect(generateOutgoingCorrespondenceReference({ schoolName: "Complexe Scolaire La Lumière", serviceCode: "SEC", order: 1, year: 2026 })).toBe("CSL / SEC / 001 / 2026");
    expect(generateOutgoingCorrespondenceReference({ schoolName: "Complexe Scolaire La Lumière", serviceCode: "SEC", order: 12, year: 2026 })).toBe("CSL / SEC / 012 / 2026");
  });
});
