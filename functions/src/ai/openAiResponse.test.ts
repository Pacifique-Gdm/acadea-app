import { describe, expect, it } from "vitest";
import { classifyOpenAiFailure, extractOpenAiResponseText, readOpenAiFailure } from "./openAiResponse.js";

describe("réponse REST OpenAI", () => {
  it("extrait le texte depuis les blocs output de l'API Responses", () => {
    const value = { output: [{ type: "message", content: [{ type: "output_text", text: "{\"proposedText\":\"Bonjour\"}" }] }] };
    expect(extractOpenAiResponseText(value)).toBe('{"proposedText":"Bonjour"}');
  });

  it("conserve la compatibilité avec output_text lorsqu'il existe", () => {
    expect(extractOpenAiResponseText({ output_text: " proposition " })).toBe("proposition");
  });

  it("ne conserve que les métadonnées sûres d'une erreur fournisseur", () => {
    expect(readOpenAiFailure(429, { error: { code: "rate_limit_exceeded", type: "requests", message: "secret" } })).toEqual({ status: 429, code: "rate_limit_exceeded", type: "requests" });
  });

  it.each([
    [401, "failed-precondition"],
    [403, "failed-precondition"],
    [429, "resource-exhausted"],
    [400, "invalid-argument"],
    [500, "unavailable"],
  ] as const)("convertit HTTP %i en erreur callable %s", (status, code) => {
    expect(classifyOpenAiFailure(status).code).toBe(code);
  });
});
