import { describe, expect, it } from "vitest";
import { sanitizeAiContext, sanitizeAiText } from "./sanitize.js";

describe("nettoyage des données avant IA", () => {
  it("masque les secrets, données médicales et financières", () => {
    const result = sanitizeAiText("Mot de passe: secret123\nToken: abcdefghijkl\nDiagnostic: information privée\nIBAN: CD001234");
    expect(result.sanitized).not.toContain("secret123");
    expect(result.sanitized).not.toContain("abcdefghijkl");
    expect(result.sanitized).not.toContain("information privée");
    expect(result.detected).toEqual(expect.arrayContaining(["password", "api_key", "medical", "financial"]));
  });

  it("retire les champs techniques et pièces jointes du contexte", () => {
    const result = sanitizeAiContext({ subject: "Objet", apiKey: "secret", payment: { amount: 20 }, medicalRecord: "privé", attachmentUrl: "https://private" });
    expect(result).toEqual({ subject: "Objet" });
  });
});
