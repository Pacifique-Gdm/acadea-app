import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";
import { apiErrorMessage } from "../utils/rateLimitErrors";

/**
 * Lot 9 : image de l'écran de connexion choisie par le Super administrateur.
 * Sans image choisie, l'écran de connexion garde sa photo d'origine (rien ne change).
 */
export type LoginImage = { imageDataUrl: string; updatedAt: string };

export const LOGIN_IMAGE_MAX_BYTES = 100 * 1024;
export const LOGIN_IMAGE_SAVE_CONFIRMATION = "ENREGISTRER LA NOUVELLE IMAGE";
export const LOGIN_IMAGE_RESET_CONFIRMATION = "REVENIR À L'IMAGE D'ORIGINE";
const CACHE_KEY = "acadea.loginImage.v1";
const DATA_URL = /^data:image\/(?:jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function parseLoginImage(value: unknown): LoginImage {
  const raw = value as Partial<LoginImage> | null;
  const imageDataUrl = typeof raw?.imageDataUrl === "string" && DATA_URL.test(raw.imageDataUrl) ? raw.imageDataUrl : "";
  return { imageDataUrl, updatedAt: imageDataUrl && typeof raw?.updatedAt === "string" ? raw.updatedAt : "" };
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
export async function saveLoginImage(imageDataUrl: string, confirmation: string): Promise<LoginImage> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-school"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login-image-save", mode: imageDataUrl ? "save" : "reset", imageDataUrl, confirmation }),
  });
  const payload = (await response.json().catch(() => ({}))) as { image?: unknown; error?: string; code?: string };
  if (!response.ok) throw new Error(apiErrorMessage(response.status, payload, "Enregistrement de l'image impossible."));
  const image = parseLoginImage(payload.image);
  writeCachedLoginImage(image.imageDataUrl);
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

/** Compression automatique dans le navigateur : renvoie l'image prête (texte « data: ») et son poids. */
export async function compressLoginImageFile(file: File): Promise<{ dataUrl: string; bytes: number }> {
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
  return { dataUrl: await blobToDataUrl(blob), bytes: blob.size };
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
