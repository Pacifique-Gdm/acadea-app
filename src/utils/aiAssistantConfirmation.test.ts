import { describe, expect, it } from "vitest";
import { AI_ASSISTANT_CONFIRMATION, canConfirmAiAssistantChange } from "./aiAssistantConfirmation";

describe("confirmation renforcée de l’Assistant IA", () => {
  it("autorise les phrases exactes d'activation et de désactivation", () => {
    expect(canConfirmAiAssistantChange(AI_ASSISTANT_CONFIRMATION.enable, true)).toBe(true);
    expect(canConfirmAiAssistantChange(AI_ASSISTANT_CONFIRMATION.disable, false)).toBe(true);
  });

  it.each([
    ["texte incorrect", "ACTIVER ASSISTANT IA"],
    ["texte partiel", "ACTIVATION ASSISTANT"],
    ["casse différente", "Activation Assistant IA"],
    ["espace supplémentaire", "ACTIVATION ASSISTANT IA "],
  ])("refuse un %s", (_label, value) => {
    expect(canConfirmAiAssistantChange(value, true)).toBe(false);
  });

  it("applique la même comparaison stricte à la désactivation", () => {
    expect(canConfirmAiAssistantChange("DESACTIVATION ASSISTANT IA", false)).toBe(true);
    expect(canConfirmAiAssistantChange("desactivation assistant ia", false)).toBe(false);
    expect(canConfirmAiAssistantChange("DESACTIVATION ASSISTANT IA ", false)).toBe(false);
  });
});
