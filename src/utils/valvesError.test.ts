import { describe, expect, it } from "vitest";
import { getValvePublicationErrorMessage } from "./valves";

describe("erreurs de publication des Valves", () => {
  const fallback = "Publication impossible.";
  const firebaseError = (code: string, message: string) => Object.assign(new Error(message), { code });

  it.each([
    [firebaseError("storage/quota-exceeded", "Quota exceeded"), "limite de ressources"],
    [firebaseError("resource-exhausted", "Quota exceeded"), "limite de ressources"],
    [{ name: "QuotaExceededError", message: "Quota exceeded" }, "stockage local du navigateur"],
  ])("ne traduit pas une limite de ressources en fichier trop volumineux", (error, expected) => {
    const message = getValvePublicationErrorMessage(error, fallback);
    expect(message).toContain(expected);
    expect(message).not.toContain("trop volumineux");
  });

  it("signale une taille réellement supérieure à la limite", () => {
    expect(getValvePublicationErrorMessage(new Error("payload too large"), fallback)).toContain("trop volumineux");
  });

  it("préserve les messages distincts de permission et de réseau", () => {
    expect(getValvePublicationErrorMessage(firebaseError("storage/unauthorized", "Unauthorized"), fallback)).toContain("Permissions Firebase");
    expect(getValvePublicationErrorMessage(new Error("Network request failed"), fallback)).toContain("Erreur réseau");
  });
});
