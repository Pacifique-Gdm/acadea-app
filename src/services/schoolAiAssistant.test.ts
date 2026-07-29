import { describe, expect, it } from "vitest";
import { isSchoolAiAssistantEnabled } from "./schoolAiAssistant";

describe("paramètre Assistant IA d’une école", () => {
  it("est activé uniquement par la valeur booléenne true", () => {
    expect(isSchoolAiAssistantEnabled({ aiAssistant: { enabled: true } })).toBe(true);
    expect(isSchoolAiAssistantEnabled({ aiAssistant: { enabled: false } })).toBe(false);
  });

  it("est désactivé par défaut pour les anciens documents", () => {
    expect(isSchoolAiAssistantEnabled({})).toBe(false);
    expect(isSchoolAiAssistantEnabled(undefined)).toBe(false);
  });
});
