import { useId, useState } from "react";
import type { ChangeEvent } from "react";

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const acceptedImageExtensions = "JPG, JPEG, PNG, WEBP";

async function compressImageFile(file: File, maxWidth: number, maxBytes: number) {
  if (!acceptedImageTypes.has(file.type)) {
    throw new Error(`Format non pris en charge. Utilisez ${acceptedImageExtensions}.`);
  }

  const image = await loadImage(file);
  const ratio = image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Compression impossible : navigateur non compatible.");
  context.drawImage(image, 0, 0, width, height);

  const outputType = "image/webp";
  const qualities = [0.86, 0.78, 0.7, 0.62, 0.54];
  let bestBlob: Blob | null = null;

  for (const quality of qualities) {
    const blob = await canvasToBlob(canvas, outputType, quality);
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
    if (blob.size <= maxBytes) return blobToDataUrl(blob);
  }

  if (bestBlob && bestBlob.size <= maxBytes) return blobToDataUrl(bestBlob);
  throw new Error(`Image trop lourde après compression. Choisissez une image plus légère (${Math.round(maxBytes / 1024)} Ko maximum recommandé).`);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Impossible de lire cette image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Compression impossible."));
        return;
      }
      resolve(blob);
    }, type, quality);
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

export function ImageUploadField({
  label,
  value,
  onChange,
  maxWidth,
  maxBytes,
  disabled = false,
  acceptSvg = false,
  previewFit = "cover",
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  maxWidth: number;
  maxBytes: number;
  disabled?: boolean;
  acceptSvg?: boolean;
  previewFit?: "cover" | "contain";
}) {
  const inputId = useId();
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const acceptedExtensions = acceptSvg ? `${acceptedImageExtensions}, SVG` : acceptedImageExtensions;
  const acceptedMimeTypes = acceptSvg ? "image/jpeg,image/png,image/webp,image/svg+xml" : "image/jpeg,image/png,image/webp";

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      const isSvg = file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
      if (isSvg && !acceptSvg) {
        throw new Error(`Format non pris en charge. Utilisez ${acceptedExtensions}.`);
      }
      if (isSvg && file.size > maxBytes) {
        throw new Error(`Image trop lourde. Choisissez une image plus légère (${Math.round(maxBytes / 1024)} Ko maximum recommandé).`);
      }
      const dataUrl = isSvg ? await blobToDataUrl(file) : await compressImageFile(file, maxWidth, maxBytes);
      onChange(dataUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image impossible à traiter.");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-2 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <div className="grid gap-3 rounded border border-slate-200 bg-slate-50 p-3">
        {value ? (
          <div className="flex items-center gap-3">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-200 bg-white">
              <img src={value} alt="" className={`h-full w-full ${previewFit === "contain" ? "object-contain p-1" : "object-cover"}`} />
            </div>
            <p className="min-w-0 break-words text-xs font-medium text-slate-500">Image sélectionnée. Les anciennes URL restent compatibles.</p>
          </div>
        ) : (
          <div className="rounded border border-dashed border-slate-300 bg-white p-4 text-center text-xs font-medium text-slate-500">
            Aucune image sélectionnée
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <input id={inputId} type="file" accept={acceptedMimeTypes} onChange={handleFileChange} disabled={disabled || processing} className="sr-only" />
          <label htmlFor={inputId} className={`secondary-button cursor-pointer ${disabled || processing ? "pointer-events-none opacity-60" : ""}`}>
            {processing ? "Compression..." : value ? "Remplacer l'image" : "Choisir une image"}
          </label>
          {value && !disabled && (
            <button onClick={() => onChange("")} className="rounded border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50" type="button">
              Supprimer
            </button>
          )}
        </div>
        <p className="text-xs font-medium text-slate-500">{acceptedExtensions} uniquement. Largeur max {maxWidth}px, objectif {Math.round(maxBytes / 1024)} Ko.</p>
        {error && <p className="rounded bg-red-50 p-2 text-xs font-semibold text-red-700">{error}</p>}
      </div>
    </div>
  );
}
