import { describe, expect, it } from "vitest";
import { validateSchoolInformationPatch } from "./manage-school.js";

describe("mise à jour du fuseau scolaire côté serveur", () => {
  it("accepte un fuseau IANA explicite et la suppression facultative", () => {
    expect(validateSchoolInformationPatch({ timeZone: " Africa/Kinshasa " })).toEqual({ patch: { timeZone: "Africa/Kinshasa" } });
    expect(validateSchoolInformationPatch({ timeZone: "" })).toEqual({ patch: { timeZone: "" } });
  });
  it("refuse les valeurs non IANA sans modifier d'autres champs", () => {
    expect(validateSchoolInformationPatch({ timeZone: "Kinshasa" }).error).toBeTruthy();
    expect(validateSchoolInformationPatch({ timeZone: 123 }).error).toBeTruthy();
  });
});
