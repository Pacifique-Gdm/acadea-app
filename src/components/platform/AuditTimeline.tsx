import { Clock3 } from "lucide-react";
import type { AuditLog } from "../../types";

export function AuditTimeline({ logs }: { logs: AuditLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="min-w-0 rounded border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
        Aucun historique pour cette école.
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-3">
      <p className="text-sm font-semibold text-ink">Historique</p>
      {logs.map((log) => (
        <div key={log.id} className="flex min-w-0 gap-3 rounded border border-slate-200 p-3">
          <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-600">
            <Clock3 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-ink">{log.action}</p>
            <p className="break-words text-xs text-slate-500">
              {log.actorName} · {new Date(log.createdAt).toLocaleString("fr-FR")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
