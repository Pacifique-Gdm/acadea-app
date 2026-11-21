/**
 * Vignette du logo pour les listes (écoles, coordinations).
 *
 * Le logo complet (souvent 30 à 300 Ko) reste pour le drawer et les PDF. Les
 * listes n'affichent qu'une petite image carrée d'environ 4 Ko, rangée dans le
 * document lui-même (`logoThumbUrl`) : aucune lecture en plus pour l'afficher.
 *
 * La même limite est vérifiée par le serveur et par les règles Firestore.
 */
export const LOGO_THUMB_MAX_CHARS = 8000;
/** Taille visée : environ 4 Ko. */
export const LOGO_THUMB_TARGET_CHARS = 5500;
const LOGO_THUMB_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** Essais successifs, du plus net au plus léger. */
export const LOGO_THUMB_ATTEMPTS: ReadonlyArray<{ size: number; quality: number }> = [
  { size: 96, quality: 0.8 },
  { size: 96, quality: 0.6 },
  { size: 80, quality: 0.5 },
  { size: 64, quality: 0.5 },
  { size: 48, quality: 0.4 },
];

export function isValidLogoThumbnail(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= LOGO_THUMB_MAX_CHARS && LOGO_THUMB_PATTERN.test(value);
}

/**
 * Choisit le premier essai assez léger. `encode` dessine le logo à la taille
 * demandée et renvoie l'image encodée (ou "" si impossible).
 */
export async function pickLogoThumbnail(encode: (size: number, quality: number) => Promise<string> | string): Promise<string> {
  let lightest = "";
  for (const attempt of LOGO_THUMB_ATTEMPTS) {
    const encoded = await encode(attempt.size, attempt.quality);
    if (!isValidLogoThumbnail(encoded)) continue;
    if (encoded.length <= LOGO_THUMB_TARGET_CHARS) return encoded;
    if (!lightest || encoded.length < lightest.length) lightest = encoded;
  }
  return lightest;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Logo illisible."));
    image.src = source;
  });
}

/**
 * Fabrique la vignette d'un logo dans le navigateur ("" si impossible : la
 * liste affichera alors le logo complet, comme avant).
 */
export async function createLogoThumbnail(logoUrl: string): Promise<string> {
  if (!logoUrl || typeof document === "undefined") return "";
  try {
    const image = await loadImage(logoUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight) return "";
    return await pickLogoThumbnail((size, quality) => {
      canvas.width = size;
      canvas.height = size;
      context.clearRect(0, 0, size, size);
      // Le logo entier tient dans le carré, sans être déformé.
      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const webp = canvas.toDataURL("image/webp", quality);
      if (webp.startsWith("data:image/webp")) return webp;
      // Navigateur sans WebP : JPEG sur fond blanc.
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size, size);
      context.globalCompositeOperation = "source-over";
      return canvas.toDataURL("image/jpeg", quality);
    });
  } catch {
    return "";
  }
}
