export const CORRESPONDENCE_DELIVERY_MODES = [
  ["hand_delivery", "Remise en main propre"],
  ["mail", "Par courrier"],
  ["email", "Par e-mail"],
  ["hierarchical", "Par voie hiérarchique"],
  ["acknowledgment", "Avec accusé de réception"],
  ["other", "Autre"],
] as const;

export function correspondenceDeliveryModeLabel(value: string) {
  return CORRESPONDENCE_DELIVERY_MODES.find(([mode]) => mode === value)?.[1] ?? value;
}
