import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { calculateDropdownPosition, type FloatingDropdownPosition } from "./ui/dropdownPosition";
import { ArrearsFilterFields } from "./ArrearsFilterFields";
import type { ArrearsFilter } from "../utils/arrearsFilter";

export function PaidAmountDropdown({ arrearsFilter, onArrearsChange, children, className = "" }: { arrearsFilter: ArrearsFilter; onArrearsChange: (value: ArrearsFilter) => void; children: ReactNode; className?: string }) {
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

  return <div className={`min-w-0 ${className}`}>
    <button ref={trigger} type="button" aria-label="Montant payé" aria-controls={id} aria-expanded={open} className="input flex h-10 min-w-0 w-full items-center justify-between gap-2 text-left" onClick={() => setOpen((value) => !value)}>
      <span>Montant payé</span><ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
    </button>
    {open && position && createPortal(<div ref={panel} id={id} role="group" aria-label="Filtres de montant payé" className="fixed z-[60] grid gap-3 overflow-x-hidden overflow-y-auto rounded border border-slate-200 bg-white p-3 shadow-lg" style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}>
      <ArrearsFilterFields value={arrearsFilter} onChange={onArrearsChange}/>
      {children}
    </div>, document.body)}
  </div>;
}
