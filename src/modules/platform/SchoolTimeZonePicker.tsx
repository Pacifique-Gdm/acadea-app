import { ChevronDown } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { filterSchoolTimeZones, schoolTimeZoneOptions } from "./schoolTimeZones";

export function SchoolTimeZonePicker({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [offsetDate, setOffsetDate] = useState(() => new Date());
  const options = useMemo(() => schoolTimeZoneOptions(offsetDate), [offsetDate]);
  const filtered = filterSchoolTimeZones(options, search);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open || !filtered[activeIndex]) return;
    const optionId = `${id}-option-${filtered[activeIndex].value.replace(/[^a-zA-Z0-9]/g, "-")}`;
    document.getElementById(optionId)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered, id, open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setSearch("");
    setActiveIndex(0);
    triggerRef.current?.focus();
  }

  function openList() {
    setOffsetDate(new Date());
    setSearch("");
    setActiveIndex(0);
    setOpen(true);
  }

  return <div ref={rootRef} className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
    <span id={`${id}-label`}>Fuseau horaire (facultatif)</span>
    <button id={`${id}-trigger`} ref={triggerRef} type="button" className="input flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} disabled={disabled} onClick={() => open ? setOpen(false) : openList()} onKeyDown={(event) => { if (event.key === "ArrowDown" && !open) { event.preventDefault(); openList(); } }}>
      <span id={`${id}-value`} className="min-w-0 break-words">{value ? selected?.label ?? value : "Aucun fuseau sélectionné"}</span>
      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
    {open && <div className="min-w-0 rounded border border-slate-200 bg-white p-2 shadow-lg">
      <input ref={searchRef} type="search" role="combobox" className="input min-w-0 w-full" placeholder="Rechercher une ville ou un pays" aria-label="Rechercher un fuseau horaire" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-options`} aria-activedescendant={filtered[activeIndex] ? `${id}-option-${filtered[activeIndex].value.replace(/[^a-zA-Z0-9]/g, "-")}` : undefined} value={search} onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((current) => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); }
        if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex].value); }
      }} />
      <p className="mt-1 text-xs font-normal text-slate-500">Décalage UTC indicatif à la date actuelle ; les changements saisonniers sont calculés automatiquement.</p>
      <div id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`} className="mt-2 max-h-64 overflow-y-auto overscroll-contain">
        <button type="button" role="option" aria-selected={!value} className="min-h-10 w-full rounded px-2 py-2 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none" onClick={() => choose("")}>Aucun fuseau (facultatif)</button>
        {filtered.map((option, index) => <button id={`${id}-option-${option.value.replace(/[^a-zA-Z0-9]/g, "-")}`} key={option.value} type="button" role="option" aria-selected={value === option.value} className={`min-h-10 w-full rounded px-2 py-2 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none ${index === activeIndex ? "bg-blue-50" : ""}`} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option.value)}>{option.label}</button>)}
        {!filtered.length && <p className="px-2 py-3 font-normal text-slate-500">Aucun fuseau trouvé.</p>}
      </div>
    </div>}
  </div>;
}
