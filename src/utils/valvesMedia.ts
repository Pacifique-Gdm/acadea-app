export type ValveAttachment = {
  name: string;
  type: string;
  dataUrl: string;
};

const MAX_IMAGE_SIZE = 1600;
const MIN_COMPRESSIBLE_SIZE = 350 * 1024;
const IMAGE_QUALITY = 0.82;

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

  return {
    name: file.name,
    type,
    dataUrl: await blobToDataUrl(blob),
  };
}
