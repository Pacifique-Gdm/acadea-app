import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { calculateDropdownPosition, type FloatingDropdownPosition } from "./ui/dropdownPosition";

type Criterion = { value: string; label: string };

export function PaidAmountDropdown({ value, onChange, options, className = "" }: { value: string; onChange: (value: string) => void; options: Criterion[]; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FloatingDropdownPosition>();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition(calculateDropdownPosition({ left: rect.left, top: rect.top, bottom: rect.bottom, width: Math.max(rect.width, 320) }, innerWidth, innerHeight));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const selected = options.find((option) => option.value === value)?.label;
  return <div className={`min-w-0 ${className}`}>
    <button ref={trigger} type="button" aria-label="Montant payé" aria-controls={id} aria-expanded={open} title={selected} className="input flex h-10 min-w-0 w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((current) => !current)}>
      <span className="min-w-0 truncate">{selected ?? "Montant payé"}</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
    {open && position && createPortal(<div ref={panel} id={id} role="group" aria-label="Critères de montant payé" className="fixed z-[60] grid gap-1 overflow-y-auto rounded border border-slate-200 bg-white p-2 shadow-lg" style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      <button type="button" aria-pressed={!value} className="w-full rounded px-2 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { onChange(""); setOpen(false); }}>Tous les critères</button>
      {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} className="w-full min-w-0 break-words rounded px-2 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>, document.body)}
  </div>;
}
