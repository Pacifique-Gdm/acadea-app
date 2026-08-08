import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import { classifyValveAttachmentReference } from "../../utils/valvesMedia";

export type ValveAttachmentViewerItem = {
  name: string;
  type?: string;
  url?: string;
  path?: string;
};

function getAttachmentKind(attachment: ValveAttachmentViewerItem) {
  const lowerName = attachment.name.toLowerCase();
  const type = attachment.type ?? "";
  if (attachment.type?.startsWith("image/")) return "image";
  if (type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (attachment.type === "text/plain" || lowerName.endsWith(".txt")) return "text";
  if (type.includes("word") || type === "application/msword" || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "document";
  if (type.includes("excel") || type.includes("spreadsheet") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return "document";
  if (type.includes("powerpoint") || type.includes("presentation") || lowerName.endsWith(".ppt") || lowerName.endsWith(".pptx")) return "document";
  return "unsupported";
}

function isMobileDocumentContext() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const isMobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(userAgent);
  const isTouchMac = /Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1;
  const hasCoarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const hasDesktopPointer = window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
  return isMobileUserAgent || isTouchMac || (hasCoarsePointer && !hasDesktopPointer);
}

export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: ValveAttachmentViewerItem | null;
  onClose: () => void;
}) {
  const [pdfObjectUrl, setPdfObjectUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const kind = attachment ? getAttachmentKind(attachment) : "unsupported";
  const referenceKind = attachment ? classifyValveAttachmentReference(attachment) : "blocked";
  const trustedPreview = referenceKind === "internal" || referenceKind === "firebase_legacy";
  const shouldUseNativeMobileDocumentViewer = trustedPreview && Boolean(attachment?.url) && (kind === "pdf" || kind === "document") && isMobileDocumentContext();
  const mobileDocumentUrl = shouldUseNativeMobileDocumentViewer ? attachment?.url : "";

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setPdfObjectUrl("");
    setError("");

    if (!trustedPreview || !attachment?.url || shouldUseNativeMobileDocumentViewer || kind !== "pdf") {
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    if (kind === "pdf") {
      fetch(attachment.url)
        .then((response) => {
          if (!response.ok) throw new Error("Lecture impossible.");
          return response.blob();
        })
        .then((blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setPdfObjectUrl(objectUrl);
        })
        .catch(() => {
          if (!cancelled) setError("Impossible de charger ce PDF.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment, kind, shouldUseNativeMobileDocumentViewer, trustedPreview]);

  if (!attachment) return null;

  const pdfSource = pdfObjectUrl ? `${pdfObjectUrl}#toolbar=0&navpanes=0&scrollbar=1` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <p className="break-words text-base font-bold text-ink">{attachment.name}</p>
            <p className="text-xs font-semibold text-slate-500">Consultation uniquement</p>
          </div>
          <button onClick={onClose} type="button" className="inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200" title="Fermer">
            <X className="h-4 w-4" />
            Fermer
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
          {loading && <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-600">Chargement du document...</p>}
          {error && <p className="rounded border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p>}

          {referenceKind === "blocked" && <p role="alert" className="rounded border border-red-100 bg-red-50 p-4 text-sm font-semibold text-red-700">Ce lien de pièce jointe est invalide ou non sécurisé.</p>}

          {referenceKind === "external_legacy" && <div className="rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Lien externe historique</p><p className="mt-1">Ce document ancien est hébergé hors du stockage Acadéa. Vérifiez sa destination avant de l’ouvrir.</p><a href={attachment.url} target="_blank" rel="noopener noreferrer" className="secondary-button mt-3 inline-flex justify-center">Ouvrir le lien externe</a></div>}

          {shouldUseNativeMobileDocumentViewer && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-300 bg-white p-6 text-center">
              <FileText className="h-8 w-8 text-slate-400" />
              <p className="max-w-md text-sm font-semibold text-slate-600">
                Ouvrez ce document avec le lecteur disponible sur votre téléphone.
              </p>
              {mobileDocumentUrl ? (
                <a href={mobileDocumentUrl} target="_blank" rel="noopener noreferrer" className="primary-button justify-center">
                  Ouvrir le document
                </a>
              ) : (
                <p className="max-w-md rounded bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                  Cette ancienne pièce jointe intégrée ne peut pas toujours être ouverte par une application mobile.
                </p>
              )}
            </div>
          )}

          {trustedPreview && kind === "pdf" && pdfSource && !loading && !error && (
            <iframe title={attachment.name} src={pdfSource} className="h-[72vh] w-full rounded border border-slate-200 bg-white" />
          )}

          {trustedPreview && kind === "image" && attachment.url && (
            <div className="flex min-h-[60vh] items-center justify-center">
              <img src={attachment.url} alt={attachment.name} className="max-h-[72vh] max-w-full rounded object-contain" />
            </div>
          )}

          {trustedPreview && (kind === "unsupported" || (kind === "document" && !shouldUseNativeMobileDocumentViewer)) && (
            <div className="flex min-h-[45vh] flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-300 bg-white p-6 text-center">
              <FileText className="h-8 w-8 text-slate-400" />
              <p className="max-w-md text-sm font-semibold text-slate-600">La prévisualisation de ce type de fichier n'est pas disponible dans Acadéa.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
