import type { ArrearsFilter } from "../utils/arrearsFilter";

export function ArrearsFilterFields({ value, onChange }: { value: ArrearsFilter; onChange: (value: ArrearsFilter) => void }) {
  return <div className="mb-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
    <label className="grid min-w-0 gap-1 text-sm">Arriérés ≥<input className="input min-w-0 w-full" aria-label="Arriérés ≥" type="number" min="0" value={value.minimum} onChange={(event) => onChange({ ...value, minimum: event.target.value })}/></label>
    <label className="grid min-w-0 gap-1 text-sm">Arriérés &lt;<input className="input min-w-0 w-full" aria-label="Arriérés <" type="number" min="0" value={value.maximum} onChange={(event) => onChange({ ...value, maximum: event.target.value })}/></label>
    <label className="grid min-w-0 gap-1 text-sm">Devise des arriérés<select className="input min-w-0 w-full" aria-label="Devise des arriérés" value={value.currency} onChange={(event) => onChange({ ...value, currency: event.target.value as ArrearsFilter["currency"] })}><option value="USD">USD</option><option value="CDF">CDF</option></select></label>
  </div>;
}
