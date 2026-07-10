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

const VALVE_ATTACHMENT_LIMITS = [
  { label: "Images", extensions: [".jpg", ".jpeg", ".png", ".webp"], types: ["image/jpeg", "image/png", "image/webp"], maxSize: 5 * 1024 * 1024 },
  { label: "PDF", extensions: [".pdf"], types: ["application/pdf"], maxSize: 10 * 1024 * 1024 },
  {
    label: "Word",
    extensions: [".doc", ".docx"],
    types: ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    maxSize: 10 * 1024 * 1024,
  },
  {
    label: "Excel",
    extensions: [".xls", ".xlsx"],
    types: ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    maxSize: 10 * 1024 * 1024,
  },
  { label: "Texte", extensions: [".txt"], types: ["text/plain"], maxSize: 1024 * 1024 },
];

export function formatValveAttachmentSize(size = 0) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
  }
  return `${Math.max(1, Math.ceil(size / 1024))} Ko`;
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : "";
}

function getAttachmentLimit(file: Pick<File, "name" | "type">) {
  const extension = getFileExtension(file.name);
  return VALVE_ATTACHMENT_LIMITS.find((limit) => limit.types.includes(file.type) || limit.extensions.includes(extension));
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
    const limit = getAttachmentLimit(attachment as Pick<File, "name" | "type">);
    if (!limit) {
      return `${attachment.name} n'est pas un type de fichier autorisé.`;
    }
    if ((attachment.size ?? 0) > limit.maxSize) {
      return `${attachment.name} dépasse la limite autorisée de ${formatValveAttachmentSize(limit.maxSize)}.`;
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
