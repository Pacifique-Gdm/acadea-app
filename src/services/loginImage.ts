import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";

/**
 * Lot 9 : image de l'écran de connexion choisie par le Super administrateur.
 * Sans image choisie, l'écran de connexion garde sa photo d'origine (rien ne change).
 */
export type LoginImage = { imageDataUrl: string; updatedAt: string; blurDataUrl?: string };

export const LOGIN_IMAGE_MAX_BYTES = 100 * 1024;
/** Fond flou : petite copie floue de l'image (40 Ko au plus), préparée une seule fois au choix de l'image. */
export const LOGIN_IMAGE_BLUR_MAX_BYTES = 40 * 1024;
export const LOGIN_IMAGE_BLUR_WIDTH = 480;
export const LOGIN_IMAGE_BLUR_RADIUS = 2;
export const LOGIN_IMAGE_BLUR_QUALITY = 0.7;
export const LOGIN_IMAGE_SAVE_CONFIRMATION = "ENREGISTRER LA NOUVELLE IMAGE";
export const LOGIN_IMAGE_RESET_CONFIRMATION = "REVENIR À L'IMAGE D'ORIGINE";
const CACHE_KEY = "acadea.loginImage.v1";
const BLUR_CACHE_KEY = "acadea.loginImageBlur.v1";
const DATA_URL = /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function parseLoginImage(value: unknown): LoginImage {
  const raw = value as Partial<LoginImage> | null;
  const imageDataUrl = typeof raw?.imageDataUrl === "string" && DATA_URL.test(raw.imageDataUrl) ? raw.imageDataUrl : "";
  const image: LoginImage = { imageDataUrl, updatedAt: imageDataUrl && typeof raw?.updatedAt === "string" ? raw.updatedAt : "" };
  // Copie floue gardée seulement avec une image et si elle est valide ; sinon fond d'aujourd'hui.
  const blur = imageDataUrl && typeof raw?.blurDataUrl === "string" && DATA_URL.test(raw.blurDataUrl) ? raw.blurDataUrl : "";
  if (blur) image.blurDataUrl = blur;
  return image;
}

/** Copie floue connue sur cet appareil (vide si absente). */
export function readCachedLoginImageBlur(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string {
  try {
    const value = storage?.getItem(BLUR_CACHE_KEY) ?? "";
    return DATA_URL.test(value) ? value : "";
  } catch {
    return "";
  }
}

export function writeCachedLoginImageBlur(blurDataUrl: string, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()) {
  try {
    if (blurDataUrl) storage?.setItem(BLUR_CACHE_KEY, blurDataUrl);
    else storage?.removeItem(BLUR_CACHE_KEY);
  } catch {
    // Mémoire de l'appareil pleine ou bloquée : la copie floue sera relue au prochain affichage.
  }
}

/** Dernière image connue sur cet appareil : affichée tout de suite, sans clignotement. */
export function readCachedLoginImage(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string {
  try {
    const value = storage?.getItem(CACHE_KEY) ?? "";
    return DATA_URL.test(value) ? value : "";
  } catch {
    return "";
  }
}

export function writeCachedLoginImage(imageDataUrl: string, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = safeStorage()) {
  try {
    if (imageDataUrl) storage?.setItem(CACHE_KEY, imageDataUrl);
    else storage?.removeItem(CACHE_KEY);
  } catch {
    // Mémoire de l'appareil pleine ou bloquée : l'image sera relue au prochain affichage.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** Lecture publique (avant connexion). En cas d'échec, l'appelant garde l'image déjà affichée. */
export async function loadLoginImage(fetcher: typeof fetch = fetch): Promise<LoginImage> {
  const response = await fetcher(resolveApiUrl("/api/manage-school?action=login-image"), { method: "GET" });
  if (!response.ok) throw new Error("Image de connexion indisponible.");
  return parseLoginImage(await response.json());
}

/** Super administrateur seulement (vérifié par le serveur). Chaîne vide : retour à l'image d'origine. */
export async function saveLoginImage(imageDataUrl: string, confirmation: string, blurDataUrl = ""): Promise<LoginImage> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login-image-save", mode: imageDataUrl ? "save" : "reset", imageDataUrl, confirmation, ...(imageDataUrl && blurDataUrl ? { blurDataUrl } : {}) }),
  });
  const payload = (await response.json().catch(() => ({}))) as { image?: unknown; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Enregistrement de l'image impossible."));
  const image = parseLoginImage(payload.image);
  writeCachedLoginImage(image.imageDataUrl);
  writeCachedLoginImageBlur(image.blurDataUrl ?? "");
  return image;
}

export type ImageEncoder = (width: number, quality: number) => Promise<Blob>;

// Largeurs essayées, de la plus nette à la plus légère, puis qualités décroissantes.
export const LOGIN_IMAGE_WIDTHS = [1600, 1280, 1024, 800, 640];
export const LOGIN_IMAGE_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42];

/** Cherche la version la plus nette qui pèse au plus 100 Ko. */
export async function compressUnderLimit(naturalWidth: number, encode: ImageEncoder, maxBytes = LOGIN_IMAGE_MAX_BYTES): Promise<Blob> {
  const widths = [...new Set(LOGIN_IMAGE_WIDTHS.map((width) => Math.min(width, Math.max(1, naturalWidth))))];
  for (const width of widths) {
    for (const quality of LOGIN_IMAGE_QUALITIES) {
      const blob = await encode(width, quality);
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error("Image impossible à réduire sous 100 Ko. Choisissez une autre image.");
}

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type BlurContext = Pick<CanvasRenderingContext2D, "drawImage"> & { filter?: string; imageSmoothingEnabled?: boolean };
type BlurCanvas = { width: number; height: number; getContext(type: "2d"): BlurContext | null; toDataURL(type: string, quality: number): string };

/**
 * Copie floue de l'image, faite UNE SEULE FOIS au choix de l'image (jamais à l'ouverture de l'écran de connexion).
 * 480 points de large, flou léger de 2 points (bords prolongés pour ne pas les assombrir), JPEG léger.
 * Navigateur sans flou de dessin : la petite taille agrandie donne un flou proche.
 * Échec ou image trop lourde : chaîne vide (l'écran garde alors son fond d'aujourd'hui).
 */
export function makeLoginImageBlurDataUrl(
  image: CanvasImageSource & { naturalWidth: number; naturalHeight: number },
  createCanvas: () => BlurCanvas = () => document.createElement("canvas") as unknown as BlurCanvas,
): string {
  try {
    if (!image.naturalWidth || !image.naturalHeight) return "";
    const width = LOGIN_IMAGE_BLUR_WIDTH;
    const height = Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth));
    const canvas = createCanvas();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return "";
    if (typeof context.filter === "string") {
      context.filter = `blur(${LOGIN_IMAGE_BLUR_RADIUS}px)`;
      const margin = LOGIN_IMAGE_BLUR_RADIUS * 3;
      context.drawImage(image, -margin, -margin, width + 2 * margin, height + 2 * margin);
    } else {
      const small = createCanvas();
      small.width = Math.max(1, Math.round(width / 3));
      small.height = Math.max(1, Math.round(height / 3));
      const smallContext = small.getContext("2d");
      if (!smallContext) return "";
      smallContext.drawImage(image, 0, 0, small.width, small.height);
      context.imageSmoothingEnabled = true;
      context.drawImage(small as unknown as CanvasImageSource, 0, 0, width, height);
    }
    const dataUrl = canvas.toDataURL("image/jpeg", LOGIN_IMAGE_BLUR_QUALITY);
    if (!DATA_URL.test(dataUrl)) return "";
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Math.floor((base64.length * 3) / 4);
    return bytes <= LOGIN_IMAGE_BLUR_MAX_BYTES ? dataUrl : "";
  } catch {
    return "";
  }
}

/** Compression automatique dans le navigateur : renvoie l'image prête (texte « data: »), son poids et sa copie floue. */
export async function compressLoginImageFile(file: File): Promise<{ dataUrl: string; bytes: number; blurDataUrl: string }> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error("Format non pris en charge. Utilisez JPG, PNG ou WEBP.");
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Compression impossible : navigateur non compatible.");
  let outputType = "image/webp";
  const encode: ImageEncoder = async (width, quality) => {
    const ratio = width / image.naturalWidth;
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await canvasToBlob(canvas, outputType, quality);
    // Navigateur sans WEBP : il renvoie du PNG (trop lourd), on passe au JPEG.
    if (blob.type !== outputType) {
      outputType = "image/jpeg";
      blob = await canvasToBlob(canvas, outputType, quality);
    }
    return blob;
  };
  const blob = await compressUnderLimit(image.naturalWidth, encode);
  return { dataUrl: await blobToDataUrl(blob), bytes: blob.size, blurDataUrl: makeLoginImageBlurDataUrl(image) };
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Impossible de lire cette image.")); };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Compression impossible."))), type, quality);
  });
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture de l'image compressée impossible."));
    reader.readAsDataURL(blob);
  });
}
