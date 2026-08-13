import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { useDismissibleDropdown } from "../../hooks/useDismissibleDropdown";

export type MultiSelectOption = { value: string; label: string };

export function MultiSelectDropdown({ label, options, values, onChange, placeholder = "Sélectionner", disabled = false }: { label: string; options: MultiSelectOption[]; values: string[]; onChange: (values: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useDismissibleDropdown(() => setOpen(false));
  const selected = options.filter((option) => values.includes(option.value));
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...new Set([...values, value])]);
  return <div ref={root} className="relative grid min-w-0 gap-1 text-sm font-medium text-slate-700">
    <span>{label}</span>
    <button type="button" className="input flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1">{selected.length ? selected.map((option) => <span key={option.value} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-800">{option.label}<span role="button" tabIndex={0} aria-label={`Retirer ${option.label}`} onClick={(event) => { event.stopPropagation(); toggle(option.value); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggle(option.value); } }}><X className="h-3 w-3" /></span></span>) : <span className="text-slate-500">{placeholder}</span>}</span>
      <ChevronDown className="h-4 w-4 shrink-0" />
    </button>
    {open && <div role="listbox" aria-multiselectable="true" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg">{options.length ? options.map((option) => <button key={option.value} role="option" aria-selected={values.includes(option.value)} type="button" className="flex w-full items-center justify-between rounded px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none" onClick={() => toggle(option.value)}><span>{option.label}</span>{values.includes(option.value) && <Check className="h-4 w-4 text-blue-700" />}</button>) : <p className="p-3 text-slate-500">Aucune option disponible.</p>}</div>}
  </div>;
}
