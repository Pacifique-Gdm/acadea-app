import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";

export type ValveAttachmentViewerItem = {
  name: string;
  type?: string;
  url?: string;
};

function getAttachmentKind(attachment: ValveAttachmentViewerItem) {
  const lowerName = attachment.name.toLowerCase();
  if (attachment.type?.startsWith("image/")) return "image";
  if (attachment.type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
  if (attachment.type === "text/plain" || lowerName.endsWith(".txt")) return "text";
  return "unsupported";
}

export function AttachmentViewer({
  attachment,
  onClose,
}: {
  attachment: ValveAttachmentViewerItem | null;
  onClose: () => void;
}) {
  const [textContent, setTextContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const kind = attachment ? getAttachmentKind(attachment) : "unsupported";

  useEffect(() => {
    let cancelled = false;
    setTextContent("");
    setError("");

    if (!attachment || kind !== "text" || !attachment.url) return;

    setLoading(true);
    fetch(attachment.url)
      .then((response) => {
        if (!response.ok) throw new Error("Lecture impossible.");
        return response.text();
      })
      .then((content) => {
        if (!cancelled) setTextContent(content);
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger ce fichier texte.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [attachment, kind]);

  if (!attachment) return null;

  const pdfSource = attachment.url ? `${attachment.url}#toolbar=0&navpanes=0&scrollbar=1` : "";

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
          {kind === "pdf" && attachment.url && (
            <iframe title={attachment.name} src={pdfSource} className="h-[72vh] w-full rounded border border-slate-200 bg-white" />
          )}

          {kind === "image" && attachment.url && (
            <div className="flex min-h-[60vh] items-center justify-center">
              <img src={attachment.url} alt={attachment.name} className="max-h-[72vh] max-w-full rounded object-contain" />
            </div>
          )}

          {kind === "text" && (
            <div className="rounded border border-slate-200 bg-white p-4">
              {loading && <p className="text-sm font-semibold text-slate-600">Chargement...</p>}
              {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
              {!loading && !error && <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{textContent}</pre>}
            </div>
          )}

          {kind === "unsupported" && (
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
