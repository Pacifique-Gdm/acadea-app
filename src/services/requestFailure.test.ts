import { describe, expect, it } from "vitest";
import { failureKind, nextRetryDelay, plainFailureMessage, publicServerMessage, RETRY_DELAYS_MS } from "./requestFailure";

const apiError = (status: number, code: string, message: string) => Object.assign(new Error(message), { status, code });

describe("motif d'échec en langage simple", () => {
  it("reconnaît une coupure réseau (fetch, Firestore, réponse perdue)", () => {
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("network");
    expect(failureKind(new TypeError("Load failed"))).toBe("network");
    expect(failureKind({ code: "unavailable", message: "Client is offline" })).toBe("network");
    expect(failureKind(new Error("Réponse réseau perdue. La création peut déjà être confirmée par le serveur."))).toBe("network");
    expect(failureKind(new Error("Connexion indisponible. L'opération n'a pas été confirmée par le serveur."))).toBe("network");
  });

  it("ne confond pas une erreur interne du navigateur avec une coupure", () => {
    expect(failureKind(new TypeError("Cannot read properties of undefined (reading 'trim')"))).toBe("other");
  });

  it("reconnaît trop de demandes, y compris le quota Firestore", () => {
    expect(failureKind(apiError(429, "resource-exhausted", "Trop de tentatives."))).toBe("rate-limit");
    expect(failureKind({ code: "resource-exhausted", message: "Quota exceeded." })).toBe("rate-limit");
  });

  it("reconnaît une année scolaire non active, un refus et une panne serveur", () => {
    expect(failureKind(new Error("Année scolaire inactive ou hors périmètre."))).toBe("inactive-year");
    expect(failureKind(apiError(403, "permission-denied", "Accès non autorisé."))).toBe("permission");
    expect(failureKind({ code: "permission-denied", message: "Missing or insufficient permissions." })).toBe("permission");
    expect(failureKind(apiError(500, "internal", "Le service est temporairement indisponible."))).toBe("unavailable");
  });

  it("donne des messages simples, sans détail technique", () => {
    expect(plainFailureMessage("network", true)).toBe("Connexion interrompue, nouvel essai en cours.");
    expect(plainFailureMessage("rate-limit", true)).toBe("Trop de demandes, nouvel essai dans un instant.");
    expect(plainFailureMessage("inactive-year", false)).toBe("Cette année scolaire n'est pas active.");
    expect(plainFailureMessage("unavailable", false)).toBe("Service momentanément indisponible. Réessayez dans quelques minutes.");
    for (const kind of ["network", "rate-limit", "inactive-year", "permission", "unavailable", "other"] as const) {
      for (const retrying of [true, false]) expect(plainFailureMessage(kind, retrying)).not.toMatch(/https?:|code|429|500|error|quota/i);
    }
  });

  it("limite et espace les nouvelles tentatives, seulement pour les motifs passagers", () => {
    expect(RETRY_DELAYS_MS).toEqual([3_000, 10_000, 30_000]);
    expect([0, 1, 2, 3].map((attempt) => nextRetryDelay("network", attempt))).toEqual([3_000, 10_000, 30_000, null]);
    expect(nextRetryDelay("rate-limit", 0)).toBe(3_000);
    expect(nextRetryDelay("unavailable", 0)).toBe(3_000);
    expect(nextRetryDelay("inactive-year", 0)).toBeNull();
    expect(nextRetryDelay("permission", 0)).toBeNull();
    expect(nextRetryDelay("other", 0)).toBeNull();
  });

  it("garde le message français du serveur et retire le diagnostic ou les détails techniques", () => {
    expect(publicServerMessage(new Error("Classe hors périmètre. Détail serveur : permission-denied"))).toBe("Classe hors périmètre.");
    expect(publicServerMessage(new TypeError("Cannot read properties of undefined"))).toBe("");
    expect(publicServerMessage(new Error("Error: something at foo (bar.js:1:2)"))).toBe("");
    expect(publicServerMessage(new Error("Voir https://example.test/x"))).toBe("");
  });
});
