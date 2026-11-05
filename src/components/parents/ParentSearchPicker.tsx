import { useId, useState } from "react";
import type { ParentProfile } from "../../types";

const normalizeParentSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("fr");

export function ParentSearchPicker({ parents, schoolId, selectedId, pendingParent, onChange }: {
  parents: ParentProfile[]; schoolId: string; selectedId?: string;
  pendingParent?: { id: string; fullName: string; phone: string };
  onChange: (id?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const scoped = parents.filter((parent) => parent.schoolId === schoolId);
  const selected = scoped.find((parent) => parent.id === selectedId) ?? (pendingParent?.id === selectedId ? pendingParent : undefined);
  const needle = normalizeParentSearch(query);
  const matches = needle ? scoped.filter((parent) => normalizeParentSearch(`${parent.fullName} ${parent.phone}`).includes(needle)).slice(0, 30) : [];
  return <div className="grid min-w-0 gap-2 text-sm">
    <label className="grid gap-1 font-medium">Parent
      <input className="input" aria-label="Rechercher un parent" placeholder="Rechercher un parent…" value={query}
        role="combobox" aria-autocomplete="list" aria-expanded={!!needle} aria-controls={listId}
        onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if(event.key === "Escape") setQuery(""); }} />
    </label>
    {selected && <div className="flex items-center justify-between gap-2 rounded border border-blue-200 bg-blue-50 p-2">
      <span>{selected.fullName}{selected.id === pendingParent?.id ? " (création en attente)" : ""}</span>
      <button className="secondary-button" type="button" onClick={() => { onChange(undefined); setQuery(""); }} aria-label="Retirer le parent sélectionné">Retirer</button>
    </div>}
    {needle && <div id={listId} role="listbox" aria-label="Parents correspondants" className="grid max-h-52 gap-1 overflow-y-auto rounded border border-slate-200 p-1">
      {matches.map((parent) => <button key={parent.id} type="button" role="option" aria-selected={parent.id === selectedId}
        className="rounded p-2 text-left hover:bg-blue-50 focus:bg-blue-50" onClick={() => { onChange(parent.id); setQuery(""); }}>
        {parent.fullName}{parent.phone ? ` · …${parent.phone.slice(-4)}` : ""}
      </button>)}
      {!matches.length && <p role="status" className="p-2 text-slate-500">Aucun parent trouvé.</p>}
    </div>}
  </div>;
}
