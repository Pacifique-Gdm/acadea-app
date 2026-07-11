import { Eye, File, FileImage, FileSpreadsheet, FileText, X } from "lucide-react";
import { formatValveAttachmentSize } from "../../utils/valvesMedia";

export type ValveAttachmentListItem = {
  name: string;
  type?: string;
  size?: number;
  url?: string;
};

function getAttachmentIcon(type?: string, name = "") {
  const lowerName = name.toLowerCase();
  if (type?.startsWith("image/")) return FileImage;
  if (type === "application/pdf" || lowerName.endsWith(".pdf") || lowerName.endsWith(".txt")) return FileText;
  if (type?.includes("excel") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return FileSpreadsheet;
  return File;
}

function getAttachmentTypeLabel(type?: string, name = "") {
  const lowerName = name.toLowerCase();
  if (type?.startsWith("image/")) return "Image";
  if (type === "application/pdf" || lowerName.endsWith(".pdf")) return "PDF";
  if (type?.includes("word") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "Word";
  if (type?.includes("excel") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return "Excel";
  if (type === "text/plain" || lowerName.endsWith(".txt")) return "Texte";
  return type || "Fichier";
}

export function AttachmentsList({
  attachments,
  onRemove,
  onView,
}: {
  attachments: ValveAttachmentListItem[];
  onRemove?: (index: number) => void;
  onView?: (attachment: ValveAttachmentListItem) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="grid min-w-0 gap-2">
      {attachments.map((attachment, index) => {
        const Icon = getAttachmentIcon(attachment.type, attachment.name);
        return (
          <div key={`${attachment.name}-${attachment.size ?? 0}-${index}`} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded bg-white p-2 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <Icon className="h-4 w-4 shrink-0 text-slate-500" />
              <div className="min-w-0">
                <p className="break-words font-semibold text-slate-700">{attachment.name}</p>
                <p className="text-xs text-slate-500">
                  {getAttachmentTypeLabel(attachment.type, attachment.name)}
                  {attachment.size ? ` · ${formatValveAttachmentSize(attachment.size)}` : ""}
                </p>
              </div>
            </div>
            {onRemove ? (
              <button onClick={() => onRemove(index)} type="button" className="inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                <X className="h-4 w-4" /> Supprimer
              </button>
            ) : attachment.url && onView ? (
              <button onClick={() => onView(attachment)} type="button" className="inline-flex items-center gap-2 rounded bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200">
                <Eye className="h-4 w-4" /> Consulter
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
