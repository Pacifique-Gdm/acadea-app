import { useMemo, useState } from "react";
import type { DisciplineSanction } from "../../types";

type DisciplineHistoryDrawerProps = {
  sanctions: DisciplineSanction[];
};

function statusLabel(status: DisciplineSanction["status"]) {
  return status === "completed" ? "Purgée" : "Sanction en cours";
}

export function DisciplineHistoryDrawer({ sanctions }: DisciplineHistoryDrawerProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DisciplineSanction["status"]>("all");
  const [className, setClassName] = useState("all");
  const classChoices = useMemo(() => Array.from(new Set(sanctions.map((sanction) => sanction.className).filter(Boolean))).sort((a, b) => a.localeCompare(b, "fr")), [sanctions]);
  const filteredSanctions = sanctions
    .filter((sanction) => {
      const search = query.trim().toLowerCase();
      const matchesSearch = !search || `${sanction.studentName} ${sanction.reason} ${sanction.sanctionType}`.toLowerCase().includes(search);
      const matchesStatus = status === "all" || sanction.status === status;
      const matchesClass = className === "all" || sanction.className === className;
      return matchesSearch && matchesStatus && matchesClass;
    })
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

  return (
    <div className="grid min-w-0 gap-4">
      <div className="rounded border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 break-words text-lg font-bold text-ink">Filtres</h2>
        <div className="grid gap-2 sm:grid-cols-3">
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="input" placeholder="Rechercher un élève" />
        <select value={status} onChange={(event) => setStatus(event.target.value as "all" | DisciplineSanction["status"])} className="input">
          <option value="all">Tous les statuts</option>
          <option value="active">Sanction en cours</option>
          <option value="completed">Purgée</option>
        </select>
        <select value={className} onChange={(event) => setClassName(event.target.value)} className="input">
          <option value="all">Toutes les classes</option>
          {classChoices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
        </select>
        </div>
      </div>
      <div className="grid max-h-[70vh] min-w-0 gap-3 overflow-y-auto pr-1 scrollbar-thin">
        {filteredSanctions.length === 0 && <p className="rounded border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-500">Aucune sanction ne correspond aux filtres.</p>}
        {filteredSanctions.map((sanction) => (
          <article key={sanction.id} className="min-w-0 rounded border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="break-words font-bold text-ink">{sanction.studentName}</p>
              <span className={`rounded px-2 py-1 text-xs font-bold ${sanction.status === "completed" ? "bg-mint/10 text-mint" : "bg-amber-100 text-amber-700"}`}>
                {statusLabel(sanction.status)}
              </span>
            </div>
            <p className="mt-1 break-words text-slate-500">{sanction.className} · {sanction.sanctionType}</p>
            <p className="mt-2 break-words text-slate-700">{sanction.reason}</p>
            <div className="mt-3 grid gap-2 text-xs font-semibold text-slate-500 sm:grid-cols-2">
              <span className="rounded bg-slate-50 p-2">Début : {sanction.startDate}</span>
              <span className="rounded bg-slate-50 p-2">Fin prévue : {sanction.expectedEndDate}</span>
              <span className="rounded bg-slate-50 p-2">Durée : {sanction.duration} jour(s)</span>
              <span className="rounded bg-slate-50 p-2">Récidive : {sanction.recurrenceNumber}</span>
              <span className="rounded bg-slate-50 p-2">Auteur : {sanction.createdByName}</span>
              {sanction.completedByName && <span className="rounded bg-slate-50 p-2">Clôturée par : {sanction.completedByName}</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
