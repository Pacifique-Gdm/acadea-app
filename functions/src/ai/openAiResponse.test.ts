import { describe, expect, it } from "vitest";
import { buildSingleSectionWritingResponseFormat, buildStructuredWritingResponseFormat, classifyOpenAiFailure, extractOpenAiResponseText, isGeneratedContentIdentical, normalizeForComparison, normalizeOpenAiSections, OPENAI_WRITING_RESPONSE_FORMAT, readOpenAiFailure } from "./openAiResponse.js";

describe("réponse REST OpenAI", () => {
  it("normalise les espaces et détecte une copie identique", () => {
    expect(normalizeForComparison("  Une   décision\r\n précise ")).toBe("Une décision\nprécise");
    expect(isGeneratedContentIdentical({ decisions: "Une décision précise" }, { decisions: " Une  décision précise " })).toBe(true);
    expect(isGeneratedContentIdentical({ decisions: "Une décision" }, { decisions: "Une décision développée" })).toBe(false);
  });
  it("construit exactement un text.format JSON Schema strict", () => {
    const format = OPENAI_WRITING_RESPONSE_FORMAT;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("acadea_writing_response");
    expect(format.strict).toBe(true);
    expect(format.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["proposedText", "sections", "warnings", "missingInformation"],
    });
    expect(format.schema.properties.sections).toEqual({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    });
    expect(format.schema.properties.warnings.items.additionalProperties).toBe(false);
    expect(format.schema.properties.missingInformation.items.additionalProperties).toBe(false);
  });

  it("reconvertit les sections strictes en objet pour le contrat existant", () => {
    expect(normalizeOpenAiSections([{ key: "objet", value: "Réponse" }, { key: "corps", value: "Texte" }])).toEqual({ objet: "Réponse", corps: "Texte" });
    expect(normalizeOpenAiSections({ lieu: "Salle", décisions: "Suivi" })).toEqual({ lieu: "Salle", décisions: "Suivi" });
  });

  it("construit un schéma strict avec toutes les sections du rapport", () => {
    const keys = ["lieu", "objet", "participants", "points abordés", "décisions", "recommandations", "signatures"];
    const format = buildStructuredWritingResponseFormat(keys);
    expect(format.schema.properties.sections).toEqual({ type: "object", additionalProperties: false, properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])), required: keys });
    expect(format.schema.properties.scope.enum).toEqual(["full_document"]);
  });

  it("construit un schéma distinct pour une section unique", () => {
    const format = buildSingleSectionWritingResponseFormat("decisions");
    expect(format.schema.properties.scope.enum).toEqual(["decisions"]);
    expect(format.schema.properties.section.properties.key.enum).toEqual(["decisions"]);
    expect(format.schema.properties).not.toHaveProperty("sections");
  });

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
