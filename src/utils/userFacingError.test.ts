import { describe, expect, it } from "vitest";
import { userFacingError } from "./userFacingError";

describe("userFacingError", () => {
  it("masque les erreurs réseau Firebase brutes", () => {
    expect(userFacingError(new Error("Firebase: Error (auth/network-request-failed)."), "Erreur")).toContain("Connexion Internet indisponible");
    expect(userFacingError(new TypeError("Failed to fetch"), "Erreur")).toContain("Connexion Internet indisponible");
  });
  it("distingue refus, expiration et indisponibilité", () => {
    expect(userFacingError({ code: "permission-denied" }, "Erreur")).toContain("pas l'autorisation");
    expect(userFacingError({ code: "unauthenticated" }, "Erreur")).toContain("session a expiré");
    expect(userFacingError({ code: "deadline-exceeded" }, "Erreur")).toContain("trop de temps");
  });
  it("ne divulgue pas les erreurs techniques inconnues", () => {
    expect(userFacingError(new Error("Firebase: Error (firestore/internal)."), "Opération indisponible.")).toBe("Opération indisponible.");
  });
});
