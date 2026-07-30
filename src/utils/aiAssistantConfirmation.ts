export const AI_ASSISTANT_CONFIRMATION = {
  enable: "ACTIVATION ASSISTANT IA",
  disable: "DESACTIVATION ASSISTANT IA",
} as const;

export function aiAssistantConfirmationPhrase(enabled: boolean) {
  return enabled ? AI_ASSISTANT_CONFIRMATION.enable : AI_ASSISTANT_CONFIRMATION.disable;
}

export function canConfirmAiAssistantChange(value: string, enabled: boolean) {
  return value === aiAssistantConfirmationPhrase(enabled);
}
