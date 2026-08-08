export type ValveAttachment = {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
};

const MAX_IMAGE_SIZE = 1600;
const MIN_COMPRESSIBLE_SIZE = 350 * 1024;
const IMAGE_QUALITY = 0.82;
export const MAX_VALVE_ATTACHMENTS = 5;
export const MAX_VALVE_ATTACHMENTS_TOTAL_SIZE = 20 * 1024 * 1024;
export const MAX_VALVE_ATTACHMENT_SIZE = 10 * 1024 * 1024;

export const VALVE_ATTACHMENT_POLICY = [
  { extension: ".pdf", mimeType: "application/pdf" },
  { extension: ".jpg", mimeType: "image/jpeg" },
  { extension: ".jpeg", mimeType: "image/jpeg" },
  { extension: ".png", mimeType: "image/png" },
  { extension: ".docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
] as const;

export const VALVE_ATTACHMENT_ACCEPT = VALVE_ATTACHMENT_POLICY.map(({ extension }) => extension).join(",");

export type ValveAttachmentReferenceKind = "internal" | "firebase_legacy" | "external_legacy" | "blocked";

export function getValveAttachmentStoragePrefix(schoolId: string, schoolYearId: string, publicationId: string) {
  return `valves/${schoolId}/${schoolYearId}/${publicationId}/`;
}

export function isCanonicalValveAttachmentPath(path: string | undefined, schoolId: string, schoolYearId: string, publicationId: string) {
  if (!path) return false;
  const prefix = getValveAttachmentStoragePrefix(schoolId, schoolYearId, publicationId);
  const fileName = path.slice(prefix.length);
  return path.startsWith(prefix)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|jpe?g|png|docx)$/i.test(fileName);
}

export function isFirebaseStorageDownloadUrl(url: string | undefined, expectedPath?: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname === "firebasestorage.googleapis.com") {
      const encodedObject = parsed.pathname.match(/^\/v0\/b\/[^/]+\/o\/(.+)$/)?.[1];
      if (!encodedObject) return false;
      return !expectedPath || decodeURIComponent(encodedObject) === expectedPath;
    }
    if (parsed.hostname === "storage.googleapis.com") {
      const objectPath = parsed.pathname.split("/").slice(2).join("/");
      return Boolean(objectPath) && (!expectedPath || decodeURIComponent(objectPath) === expectedPath);
    }
    return false;
  } catch {
    return false;
  }
}

export function classifyValveAttachmentReference(reference: { url?: string; path?: string }, scope?: { schoolId: string; schoolYearId: string; publicationId: string }): ValveAttachmentReferenceKind {
  const { url, path } = reference;
  if (scope && path && isCanonicalValveAttachmentPath(path, scope.schoolId, scope.schoolYearId, scope.publicationId) && isFirebaseStorageDownloadUrl(url, path)) return "internal";
  if (!scope && path?.startsWith("valves/") && isFirebaseStorageDownloadUrl(url, path)) return "internal";
  if (!path && isFirebaseStorageDownloadUrl(url)) return "firebase_legacy";
  try {
    if (url && new URL(url).protocol === "https:") return "external_legacy";
  } catch {
    // URL invalide : bloquée ci-dessous.
  }
  return "blocked";
}

export function formatValveAttachmentSize(size = 0) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  }
  return `${Math.max(1, Math.ceil(size / 1024))} Ko`;
}

export function getValveAttachmentExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

export function isValveAttachmentTypeAllowed(file: Pick<File, "name" | "type">) {
  const extension = getValveAttachmentExtension(file.name);
  return VALVE_ATTACHMENT_POLICY.some((entry) => entry.extension === extension && entry.mimeType === file.type);
}

function getDataUrlSize(dataUrl: string) {
  const base64Data = dataUrl.split(",")[1] ?? "";
  return Math.floor((base64Data.length * 3) / 4);
}

export function validateValveAttachments(attachments: Array<Pick<ValveAttachment, "name" | "type" | "size">>) {
  if (attachments.length > MAX_VALVE_ATTACHMENTS) {
    return `Vous pouvez joindre au maximum ${MAX_VALVE_ATTACHMENTS} fichiers par publication.`;
  }

  const totalSize = attachments.reduce((sum, item) => sum + (item.size ?? 0), 0);
  if (totalSize > MAX_VALVE_ATTACHMENTS_TOTAL_SIZE) {
    return `La taille totale des pièces jointes dépasse ${formatValveAttachmentSize(MAX_VALVE_ATTACHMENTS_TOTAL_SIZE)}.`;
  }

  for (const attachment of attachments) {
    const allowedType = isValveAttachmentTypeAllowed(attachment as Pick<File, "name" | "type">);
    if (!allowedType) {
      return `${attachment.name} n'est pas un type de fichier autorisé.`;
    }
    if ((attachment.size ?? 0) <= 0 || (attachment.size ?? 0) > MAX_VALVE_ATTACHMENT_SIZE) {
      return `${attachment.name} dépasse la limite autorisée de ${formatValveAttachmentSize(MAX_VALVE_ATTACHMENT_SIZE)}.`;
    }
  }

  return "";
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Lecture du fichier impossible."));
    };
    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Optimisation de l'image impossible."));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, IMAGE_QUALITY);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Optimisation du fichier impossible."));
    };
    reader.onerror = () => reject(new Error("Optimisation du fichier impossible."));
    reader.readAsDataURL(blob);
  });
}

function isCompressibleImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function getOptimizedDimensions(width: number, height: number) {
  if (width <= MAX_IMAGE_SIZE && height <= MAX_IMAGE_SIZE) {
    return { width, height };
  }
  const ratio = Math.min(MAX_IMAGE_SIZE / width, MAX_IMAGE_SIZE / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export async function prepareValveAttachment(file: File): Promise<ValveAttachment> {
  const originalDataUrl = await readFileAsDataUrl(file);
  const type = file.type || "application/octet-stream";
  const originalAttachment = {
    name: file.name,
    type,
    dataUrl: originalDataUrl,
    size: file.size,
  };

  if (!isCompressibleImage(file) || file.size <= MIN_COMPRESSIBLE_SIZE) {
    return originalAttachment;
  }

  const image = await loadImage(originalDataUrl);
  const dimensions = getOptimizedDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d");
  if (!context) return originalAttachment;

  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
  const blob = await canvasToBlob(canvas, type);
  if (!blob || blob.size >= file.size) {
    return originalAttachment;
  }

  const optimizedDataUrl = await blobToDataUrl(blob);
  return {
    name: file.name,
    type,
    dataUrl: optimizedDataUrl,
    size: blob.size || getDataUrlSize(optimizedDataUrl),
  };
}

export async function prepareValveAttachments(files: File[]): Promise<ValveAttachment[]> {
  const preparedAttachments = await Promise.all(files.map((file) => prepareValveAttachment(file)));
  const validationError = validateValveAttachments(preparedAttachments);
  if (validationError) {
    throw new Error(validationError);
  }
  return preparedAttachments;
}
