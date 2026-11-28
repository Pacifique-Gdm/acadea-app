// Lot 9 : image de l'écran de connexion, choisie par le Super administrateur.
// L'image (déjà compressée sous 100 Ko par le navigateur) est gardée dans un document
// que seul le serveur écrit (`platform/loginImage`, écriture refusée aux appareils par
// les règles actuelles). L'écran de connexion la lit par une lecture publique du serveur.
// Sans image enregistrée, l'écran de connexion garde sa photo d'origine.

export const LOGIN_IMAGE_DOC_PATH = "platform/loginImage";
export const LOGIN_IMAGE_MAX_BYTES = 100 * 1024;
// Fond flou : petite copie floue de l'image, préparée une seule fois par le navigateur du Super administrateur.
export const LOGIN_IMAGE_BLUR_MAX_BYTES = 40 * 1024;
export const LOGIN_IMAGE_SAVE_CONFIRMATION = "ENREGISTRER LA NOUVELLE IMAGE";
export const LOGIN_IMAGE_RESET_CONFIRMATION = "REVENIR À L'IMAGE D'ORIGINE";

const LOGIN_IMAGE_DATA_URL = /^data:image\/(?:jpeg|webp|png);base64,([A-Za-z0-9+/]+={0,2})$/;
// Lecture publique gardée une minute en mémoire : peu de lectures, même si beaucoup d'écrans s'ouvrent.
const READ_CACHE_MS = 60_000;
let readCache = null;

export function resetLoginImageCacheForTests() {
  readCache = null;
}

/** Taille réelle de l'image en octets, calculée depuis le texte base64. */
export function loginImageByteSize(dataUrl) {
  const match = LOGIN_IMAGE_DATA_URL.exec(dataUrl);
  if (!match) return null;
  const base64 = match[1];
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** Vérifie la demande du Super administrateur : nouvelle image (< 100 Ko) ou retour à l'origine. */
export function validateLoginImageRequest(body) {
  const mode = body?.mode === "reset" ? "reset" : body?.mode === "save" ? "save" : null;
  if (!mode) return { error: "Demande invalide." };
  const expected = mode === "reset" ? LOGIN_IMAGE_RESET_CONFIRMATION : LOGIN_IMAGE_SAVE_CONFIRMATION;
  if (body.confirmation !== expected) return { error: "Confirmation exacte requise." };
  if (mode === "reset") return { imageDataUrl: "" };
  const imageDataUrl = body.imageDataUrl;
  if (typeof imageDataUrl !== "string" || imageDataUrl.length > 200_000) return { error: "Image invalide." };
  const size = loginImageByteSize(imageDataUrl);
  if (size === null) return { error: "Format d'image invalide (JPEG, PNG ou WEBP)." };
  if (size > LOGIN_IMAGE_MAX_BYTES) return { error: "Image trop lourde : 100 Ko maximum." };
  // Copie floue facultative : si elle est absente ou invalide, l'écran garde son fond d'aujourd'hui.
  return { imageDataUrl, blurDataUrl: validBlurDataUrl(body.blurDataUrl) };
}

/** Copie floue acceptée seulement si c'est une petite image (40 Ko au plus) ; sinon chaîne vide. */
export function validBlurDataUrl(value) {
  if (typeof value !== "string" || value.length > 60_000) return "";
  const size = loginImageByteSize(value);
  return size !== null && size <= LOGIN_IMAGE_BLUR_MAX_BYTES ? value : "";
}

/** Valeur publique : l'image et sa date ; la copie floue seulement si elle existe. */
function publicValue(imageDataUrl, updatedAt, blurDataUrl) {
  const value = { imageDataUrl, updatedAt: imageDataUrl ? updatedAt : "" };
  if (imageDataUrl && blurDataUrl) value.blurDataUrl = blurDataUrl;
  return value;
}

/** Lecture publique : seulement l'image et sa date, rien d'autre. */
export async function readLoginImage(db, { now = Date.now() } = {}) {
  if (readCache && now - readCache.at < READ_CACHE_MS) return readCache.value;
  const snapshot = await db.doc(LOGIN_IMAGE_DOC_PATH).get();
  const data = snapshot.exists ? snapshot.data() : {};
  const imageDataUrl = typeof data?.imageDataUrl === "string" && loginImageByteSize(data.imageDataUrl) !== null ? data.imageDataUrl : "";
  const value = publicValue(imageDataUrl, typeof data?.updatedAt === "string" ? data.updatedAt : "", validBlurDataUrl(data?.blurDataUrl));
  readCache = { at: now, value };
  return value;
}

export async function saveLoginImage(db, caller, imageDataUrl, { now = new Date(), blurDataUrl = "" } = {}) {
  const updatedAt = now.toISOString();
  const blur = imageDataUrl ? validBlurDataUrl(blurDataUrl) : "";
  await db.doc(LOGIN_IMAGE_DOC_PATH).set({ imageDataUrl, updatedAt, updatedBy: caller.uid, ...(blur ? { blurDataUrl: blur } : {}) });
  const value = publicValue(imageDataUrl, updatedAt, blur);
  readCache = { at: now.getTime(), value };
  return value;
}
