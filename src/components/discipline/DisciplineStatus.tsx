import { CheckCircle2, Plus } from "lucide-react";
import type { DisciplineSanction } from "../../types";

type DisciplineStatusProps = {
  sanctions: DisciplineSanction[];
  onNewSanction: () => void;
  onCompleteSanction: (sanction: DisciplineSanction) => void;
};

function statusLabel(status: DisciplineSanction["status"]) {
  return status === "completed" ? "Purgée" : "Sanction en cours";
}

export function DisciplineStatus({ sanctions, onNewSanction, onCompleteSanction }: DisciplineStatusProps) {
  const activeSanctions = sanctions
    .filter((sanction) => sanction.status === "active")
    .sort((first, second) => second.startDate.localeCompare(first.startDate) || first.studentName.localeCompare(second.studentName, "fr"));

  return (
    <section className="grid min-w-0 gap-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-ink">Discipline</h1>
          <p className="mt-1 break-words text-sm text-slate-500">Sanctions en cours et suivi disciplinaire des élèves.</p>
        </div>
        <button onClick={onNewSanction} className="primary-button justify-center" type="button">
          <Plus className="h-4 w-4" /> Nouvelle sanction
        </button>
      </div>

      <div className="grid min-w-0 gap-3">
        {activeSanctions.length === 0 && (
          <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucune sanction en cours.</p>
        )}
        {activeSanctions.map((sanction) => (
          <article key={sanction.id} className="min-w-0 rounded border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-words text-lg font-bold text-ink">{sanction.studentName}</h2>
                  <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-700">{statusLabel(sanction.status)}</span>
                </div>
                <p className="mt-1 break-words text-sm font-semibold text-slate-500">{sanction.className}</p>
              </div>
              <button onClick={() => onCompleteSanction(sanction)} className="secondary-button justify-center" type="button">
                <CheckCircle2 className="h-4 w-4" /> Marquer comme purgée
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><span className="font-semibold text-slate-600">Motif</span><p className="break-words text-ink">{sanction.reason}</p></div>
              <div><span className="font-semibold text-slate-600">Sanction</span><p className="break-words text-ink">{sanction.sanctionType}</p></div>
              <div><span className="font-semibold text-slate-600">Date de début</span><p className="break-words text-ink">{sanction.startDate}</p></div>
              <div><span className="font-semibold text-slate-600">Durée</span><p className="break-words text-ink">{sanction.duration} jour(s)</p></div>
              <div><span className="font-semibold text-slate-600">Fin prévue</span><p className="break-words text-ink">{sanction.expectedEndDate}</p></div>
              <div><span className="font-semibold text-slate-600">Statut</span><p className="break-words text-ink">{statusLabel(sanction.status)}</p></div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
