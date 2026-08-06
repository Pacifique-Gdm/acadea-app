import { describe, expect, it } from "vitest";
import { temporaryPasswordAfterPhoneChange } from "./temporaryPassword";

describe("mot de passe temporaire proposé", () => {
  it("suit le téléphone tant qu'il n'a pas été modifié manuellement", () => {
    expect(temporaryPasswordAfterPhoneChange({ nextPhone: "0991234567", currentPassword: "", manuallyEdited: false })).toBe("0991234567");
    expect(temporaryPasswordAfterPhoneChange({ nextPhone: "0812345678", currentPassword: "0991234567", manuallyEdited: false })).toBe("0812345678");
  });

  it("conserve la valeur personnalisée après une modification manuelle", () => {
    expect(temporaryPasswordAfterPhoneChange({ nextPhone: "0812345678", currentPassword: "mot-de-passe-personnalise", manuallyEdited: true })).toBe("mot-de-passe-personnalise");
  });
});
