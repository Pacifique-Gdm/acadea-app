// Vignette du logo pour les listes (voir src/services/logoThumbnail.ts) :
// petite image carrée d'environ 4 Ko rangée dans le document lui-même.
// Même limite dans les règles Firestore (schoolSettingsUpdate).
export const LOGO_THUMB_MAX_CHARS = 8000;
const LOGO_THUMB_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function isValidLogoThumbnail(value) {
  return typeof value === "string" && value.length > 0 && value.length <= LOGO_THUMB_MAX_CHARS && LOGO_THUMB_PATTERN.test(value);
}

// Mêmes essais que dans l'application (vérifié par un test) : du plus net au plus léger.
export const LOGO_THUMB_TARGET_CHARS = 5500;
export const LOGO_THUMB_ATTEMPTS = [
  { size: 96, quality: 0.8 },
  { size: 96, quality: 0.6 },
  { size: 80, quality: 0.5 },
  { size: 64, quality: 0.5 },
  { size: 48, quality: 0.4 },
];
