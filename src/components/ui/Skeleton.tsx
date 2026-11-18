/** Squelettes gris : ils gardent la place d'une donnée pas encore prête, pour
 * que la page ne saute pas quand la valeur arrive. Aucun texte visible. */

/** Remplace une valeur de carte (même hauteur qu'une ligne de chiffre en text-2xl). */
export function ValueSkeleton({ className = "w-32" }: { className?: string }) {
  return <span data-testid="value-skeleton" aria-hidden="true" className={`inline-block h-8 max-w-full animate-pulse rounded bg-slate-200 align-middle ${className}`} />;
}

/** Remplace un bloc entier (carte « KPI financier », bande, graphique). */
export function BlockSkeleton({ className = "h-24", label, height }: { className?: string; label?: string; height?: number }) {
  return <div data-testid="block-skeleton" aria-busy="true" aria-label={label} style={height ? { height } : undefined} className={`min-w-0 animate-pulse rounded border border-slate-200 bg-slate-100 ${className}`} />;
}

/** Place gardée pour la carte « KPI financier » : en-tête, barre, 6 indicateurs et 2 frais. */
export function FinancialKpiSkeleton() {
  return (
    <div data-testid="financial-kpi-skeleton" aria-busy="true" aria-label="KPI financier" className="min-w-0 animate-pulse rounded border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3"><span className="h-10 w-48 rounded bg-slate-200" /><span className="h-9 w-28 rounded bg-slate-200" /></div>
      <div className="mt-4 h-3 rounded bg-slate-200" />
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, index) => <span key={index} className="h-14 rounded bg-slate-100" />)}</div>
      <div className="mt-5 grid gap-3">{Array.from({ length: 2 }, (_, index) => <span key={index} className="h-28 rounded bg-slate-100" />)}</div>
      <div className="mt-5 h-52 rounded bg-slate-100" />
    </div>
  );
}
