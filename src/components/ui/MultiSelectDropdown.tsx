import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { calculateDropdownPosition, type FloatingDropdownPosition } from "./dropdownPosition";

export type MultiSelectOption = { value: string; label: string };

const OPEN_EVENT = "acadea:multiselect-open";

export function MultiSelectDropdown({ label, options, values, onChange, placeholder = "Sélectionner", disabled = false }: { label: string; options: MultiSelectOption[]; values: string[]; onChange: (values: string[]) => void; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingDropdownPosition>();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.filter((option) => values.includes(option.value));
  const toggle = (value: string) => onChange(values.includes(value) ? values.filter((item) => item !== value) : [...new Set([...values, value])]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPosition(calculateDropdownPosition(rect, window.innerWidth, window.innerHeight));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setOpen(false); triggerRef.current?.focus(); } };
    const closeForSibling = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener(OPEN_EVENT, closeForSibling);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener(OPEN_EVENT, closeForSibling);
    };
  }, [id, open]);

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }));
      return next;
    });
  }

  const menu = open && position ? <div ref={menuRef} role="listbox" aria-multiselectable="true" className="fixed z-[60] overflow-x-hidden overflow-y-auto rounded border border-slate-200 bg-white p-1 shadow-lg" style={{ left: position.left, top: position.placement === "below" ? position.top : undefined, bottom: position.placement === "above" ? position.bottom : undefined, width: position.width, maxHeight: position.maxHeight }}>{options.length ? options.map((option) => <button key={option.value} role="option" aria-selected={values.includes(option.value)} type="button" className="flex w-full items-center justify-between gap-2 break-words rounded px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none" onClick={() => toggle(option.value)}><span>{option.label}</span>{values.includes(option.value) && <Check className="h-4 w-4 shrink-0 text-blue-700" />}</button>) : <p className="p-3 text-slate-500">Aucune option disponible.</p>}</div> : null;

  return <div ref={rootRef} className="grid min-w-0 gap-1 text-sm font-medium text-slate-700">
    <span>{label}</span>
    <button ref={triggerRef} type="button" className="input flex min-h-11 w-full items-center justify-between gap-2 text-left" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={toggleOpen}>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1">{selected.length ? selected.map((option) => <span key={option.value} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-800">{option.label}<span role="button" tabIndex={0} aria-label={`Retirer ${option.label}`} onClick={(event) => { event.stopPropagation(); toggle(option.value); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); toggle(option.value); } }}><X className="h-3 w-3" /></span></span>) : <span className="text-slate-500">{placeholder}</span>}</span>
      <ChevronDown className="h-4 w-4 shrink-0" />
    </button>
    {menu && createPortal(menu, document.body)}
  </div>;
}
