import { describe, expect, it } from "vitest";
import { classifyError, ERROR_MESSAGES, isTechnicalText, userFacingError } from "./userFacingError";

describe("classement des erreurs (userFacingError)", () => {
  it("donne exactement les cinq textes demandés", () => {
    expect(ERROR_MESSAGES).toEqual({
      network: "Connexion Internet instable ou indisponible. Vérifiez votre connexion, puis réessayez.",
      timeout: "Le service met plus de temps que prévu à répondre. Veuillez réessayer dans un instant.",
      session: "Votre session a expiré. Veuillez vous reconnecter pour continuer.",
      permission: "Vous n'avez pas l'autorisation d'effectuer cette opération. Contactez votre administrateur si nécessaire.",
      other: "Une erreur est survenue. Veuillez réessayer. Si le problème persiste, contactez l'assistance Acadéa.",
    });
  });

  it("classe les coupures réseau (cas constaté sur l'onglet Écoles)", () => {
    for (const error of [
      new Error("Firebase: Error (auth/network-request-failed)."),
      new TypeError("Failed to fetch"),
      new TypeError("Load failed"),
      new TypeError("NetworkError when attempting to fetch resource."),
      Object.assign(new Error("Failed to get document because the client is offline."), { code: "unavailable" }),
      { code: "firestore/unavailable" },
      new Error("Chargement Firestore impossible pour schools : Failed to fetch"),
    ]) {
      expect(classifyError(error)).toBe("network");
      expect(userFacingError(error, "Repli")).toBe(ERROR_MESSAGES.network);
    }
  });

  it("classe délai dépassé, session expirée et refus d'autorisation", () => {
    expect(userFacingError({ code: "deadline-exceeded" }, "x")).toBe(ERROR_MESSAGES.timeout);
    expect(userFacingError(new Error("Request timed out"), "x")).toBe(ERROR_MESSAGES.timeout);
    expect(userFacingError(new Error("Firebase: Error (auth/user-token-expired)."), "x")).toBe(ERROR_MESSAGES.session);
    expect(userFacingError({ code: "unauthenticated" }, "x")).toBe(ERROR_MESSAGES.session);
    expect(userFacingError(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }), "x")).toBe(ERROR_MESSAGES.permission);
    expect(userFacingError({ code: "permission-denied" }, "x")).toBe(ERROR_MESSAGES.permission);
  });

  it("remplace toute autre erreur technique par le message général", () => {
    for (const error of [
      new Error("Firebase: Error (firestore/internal)."),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new Error("Unexpected token < in JSON at position 0"),
      { code: "failed-precondition" },
    ]) expect(userFacingError(error, "Repli")).toBe(ERROR_MESSAGES.other);
  });

  it("garde tel quel un message clair écrit par Acadéa (règle métier)", () => {
    for (const text of [
      "Le montant dépasse le reste à payer pour ce frais.",
      "Cette année scolaire n'est pas active.",
      "La Sous-coordination est déjà rattachée à cette école, c'est-à-dire qu'elle ne peut pas être ajoutée deux fois.",
      "Saisissez exactement la phrase de confirmation.",
    ]) {
      expect(classifyError(new Error(text))).toBe("business");
      expect(userFacingError(new Error(text), "Repli")).toBe(text);
    }
  });

  it("utilise le texte de secours seulement quand l'erreur n'a aucun texte", () => {
    expect(userFacingError(undefined, "Chargement impossible.")).toBe("Chargement impossible.");
    expect(userFacingError({}, "Chargement impossible.")).toBe("Chargement impossible.");
  });

  it("reconnaît les cinq textes communs déjà préparés", () => {
    for (const [kind, text] of Object.entries(ERROR_MESSAGES)) {
      expect(classifyError(text)).toBe(kind);
      expect(isTechnicalText(text)).toBe(false);
    }
  });
});
