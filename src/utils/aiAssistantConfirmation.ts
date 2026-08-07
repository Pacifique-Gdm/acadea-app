export const AI_ASSISTANT_CONFIRMATION = {
  enable: "ACTIVER L'ASSISTANT IA",
  disable: "DESACTIVER L'ASSISTANT IA",
} as const;

export function aiAssistantConfirmationPhrase(enabled: boolean) {
  return enabled ? AI_ASSISTANT_CONFIRMATION.enable : AI_ASSISTANT_CONFIRMATION.disable;
}

export function canConfirmAiAssistantChange(value: string, enabled: boolean) {
  return value.trim() === aiAssistantConfirmationPhrase(enabled);
}
