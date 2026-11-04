import { useDeferredValue, useRef } from "react";
import type { Student } from "../../types";

export function SupportStudentPicker({ students, selectedIds, onChange, query, onQuery, disabled, loading }: {
  students: Student[]; selectedIds: string[]; onChange: (ids: string[]) => void;
  query: string; onQuery: (query: string) => void; disabled: boolean; loading: boolean;
}) {
  const deferred = useDeferredValue(query);
  const resultsRef = useRef<HTMLDivElement>(null);
  const results = deferred.trim() ? students.filter((student) =>
    `${student.nom} ${student.postnom} ${student.prenom} ${student.matricule} ${student.className}`.toLocaleLowerCase("fr").includes(deferred.trim().toLocaleLowerCase("fr")),
  ).slice(0, 30) : [];
  const pending = loading || deferred !== query;
  return <div className="grid min-w-0 gap-2">
    <input aria-label="Rechercher un élève" role="combobox" aria-expanded={!!query.trim()} aria-controls="support-student-results" aria-autocomplete="list"
      className="input" value={query} disabled={disabled} placeholder="Nom, prénom, matricule ou classe"
      onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); resultsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus(); }
        if (event.key === "Escape") onQuery("");
      }} />
    <p role="status">{selectedIds.length} élève(s) sélectionné(s)</p>
    <div className="flex flex-wrap gap-2">
      {selectedIds.map((id) => {
        const student = students.find((item) => item.id === id);
        return <button type="button" key={id} disabled={disabled} className="rounded border px-2 py-1 text-sm" onClick={() => onChange(selectedIds.filter((item) => item !== id))}>
          {student ? `${student.nom} ${student.prenom} — ${student.className}` : "Élève indisponible"} ×
        </button>;
      })}
    </div>
    <div id="support-student-results" role="listbox" aria-label="Résultats élèves" aria-multiselectable="true" ref={resultsRef} className="max-h-64 overflow-y-auto">
      {pending ? <p role="status">Recherche…</p> : query.trim() && !results.length ? <p>Aucun élève trouvé.</p> : !pending && results.map((student) => <button
        type="button" role="option" aria-selected={selectedIds.includes(student.id)} key={student.id} disabled={disabled}
        className="block w-full break-words rounded border p-2 text-left text-sm"
        onKeyDown={(event) => {
          const buttons = [...(resultsRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
          const index = buttons.indexOf(event.currentTarget);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); buttons[index + (event.key === "ArrowDown" ? 1 : -1)]?.focus(); }
          if (event.key === "Escape") onQuery("");
        }}
        onClick={() => { if (!selectedIds.includes(student.id)) onChange([...selectedIds, student.id]); }}>
        {student.nom} {student.postnom} {student.prenom} — {student.className} — {student.matricule}{selectedIds.includes(student.id) ? " ✓" : ""}
      </button>)}
    </div>
  </div>;
}
