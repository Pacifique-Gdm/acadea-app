import { Download, LoaderCircle, Paperclip } from "lucide-react";
import { getDownloadURL, ref } from "firebase/storage";
import { useState } from "react";
import { storage } from "../../firebase";
import type { Message } from "../../types";
import { formatMessageAttachmentSize } from "../../utils/messageAttachments";
import { getDisplayableMessageAttachments } from "../../utils/messageAttachmentDisplay";

export function MessageAttachments({ message, inverse = false }: { message: Message; inverse?: boolean }) {
  const attachments = getDisplayableMessageAttachments(message);
  const [loadingPath, setLoadingPath] = useState("");
  const [error, setError] = useState("");

  if (attachments.length === 0) return null;

  async function download(path: string, name: string) {
    if (!storage || loadingPath) return;
    setLoadingPath(path);
    setError("");
    try {
      const url = await getDownloadURL(ref(storage, path));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
    } catch (downloadError) {
      console.error("Téléchargement de la pièce jointe impossible.", downloadError);
      setError("Cette pièce jointe ne peut pas être téléchargée pour le moment.");
    } finally {
      setLoadingPath("");
    }
  }

  return (
    <div className="mt-3 space-y-2" aria-label="Pièces jointes">
      {attachments.map((attachment) => {
        const loading = loadingPath === attachment.path;
        return (
          <div key={attachment.path} className={`flex min-w-0 items-center justify-between gap-2 rounded border p-2 ${inverse ? "border-slate-600 bg-slate-700" : "border-slate-200 bg-white"}`}>
            <div className="flex min-w-0 items-center gap-2">
              <Paperclip aria-hidden="true" className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold" title={attachment.name}>{attachment.name}</p>
                <p className={`text-[11px] ${inverse ? "text-slate-300" : "text-slate-500"}`}>{attachment.type} · {formatMessageAttachmentSize(attachment.size)}</p>
              </div>
            </div>
            <button type="button" onClick={() => void download(attachment.path, attachment.name)} disabled={Boolean(loadingPath)} aria-label={`Télécharger ${attachment.name}`} className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded focus:outline-none focus:ring-2 focus:ring-mint disabled:opacity-50 ${inverse ? "bg-slate-600 text-white hover:bg-slate-500" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
              {loading ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Download aria-hidden="true" className="h-4 w-4" />}
            </button>
          </div>
        );
      })}
      {error && <p role="alert" className="text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}
