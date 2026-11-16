/** Lot 24 : règles du bandeau d'activation des notifications. */
export const PUSH_PROMPT_SNOOZE_KEY = "acadea:push-prompt-snoozed-at";
export const PUSH_PROMPT_DELAY_MS = 3 * 24 * 60 * 60 * 1000;

/** « Plus tard » : on redemande à la prochaine connexion, au plus une fois tous les 3 jours. */
export function pushPromptDue(snoozedAt: string | null, now = Date.now()) {
  const last = snoozedAt ? Date.parse(snoozedAt) : NaN;
  return !Number.isFinite(last) || now - last >= PUSH_PROMPT_DELAY_MS;
}

export type PushDevice = { ios: boolean; android: boolean; standalone: boolean };

export function detectPushDevice(userAgent: string, standalone: boolean): PushDevice {
  const ios = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
  return { ios, android: /Android/i.test(userAgent), standalone };
}

/** Sur iPhone, aucune notification n'arrive tant qu'Acadéa n'est pas installée sur l'écran d'accueil. */
export function needsIosInstall(device: PushDevice) {
  return device.ios && !device.standalone;
}

export const IOS_INSTALL_STEPS = [
  "Ouvrez Acadéa dans Safari.",
  "Touchez le bouton Partager (carré avec une flèche vers le haut).",
  "Choisissez « Sur l'écran d'accueil », puis « Ajouter ».",
  "Ouvrez Acadéa depuis la nouvelle icône, puis touchez « Activer ».",
];
export const ANDROID_BLOCKED_STEPS = [
  "Ouvrez Chrome, touchez les trois points en haut à droite, puis « Paramètres ».",
  "Choisissez « Paramètres des sites », puis « Notifications ».",
  "Trouvez Acadéa dans « Bloqué » et choisissez « Autoriser ».",
  "Revenez dans Acadéa et touchez « Activer ».",
];
export const IOS_BLOCKED_STEPS = [
  "Ouvrez l'application Réglages de l'iPhone.",
  "Touchez « Notifications », puis « Acadéa ».",
  "Activez « Autoriser les notifications ».",
  "Revenez dans Acadéa et touchez « Activer ».",
];
