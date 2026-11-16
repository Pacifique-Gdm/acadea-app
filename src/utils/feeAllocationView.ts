import type { AllocationWorkspace } from "../services/feeAllocation";
import type { FeeAllocationConfig, FeeAllocationRubric } from "../types/feeAllocation";

export type AllocationFilter = { kind: "fee" | "class" | "period"; value: string; from: string; to: string };
export type AllocationRow = { key: string; schoolId: string; schoolName: string; yearName: string; feeName: string;
  classLabel: string; currency: "USD" | "CDF"; rubricName: string; rubric?: FeeAllocationRubric;
  amountMinor: number; percent: number; config: FeeAllocationConfig; stale: boolean;
  financial?: { receivedMinor: number; spentMinor: number; availableMinor: number; openingMinor: number; arrearsMinor: number;
    cumulativeReceivedMinor: number; cumulativeSpentMinor: number } };
export type AllocationFinancialField = keyof NonNullable<AllocationRow["financial"]>;
export const unavailableAllocation = "Indisponible — répartition en préparation";
export const allocationFeeKey = (schoolId: string, feeId: string) => JSON.stringify([schoolId, feeId]);
export const allocationClassKey = (schoolId: string, classKey: string) => JSON.stringify([schoolId, classKey]);
export const allocationClassLabel = (value: string) => value.replace("::option::", " — ");
export function allocationFilterChoices(workspaces: AllocationWorkspace[], kind: AllocationFilter['kind']) {
  const multiple = workspaces.length > 1;
  const pairs = workspaces.flatMap(w => w.fees.map(f => [
    kind === 'class' ? allocationClassKey(w.school.id, f.classOptionKey || f.className) : allocationFeeKey(w.school.id, f.id),
    `${multiple ? w.school.name + ' · ' : ''}${kind === 'class' ? '' : f.name + ' — '}${allocationClassLabel(f.classOptionKey || f.className)}`,
  ] as const));
  return [...new Map(pairs)];
}
const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function allocationPeriod(value: string, from: string, to: string, now = new Date()): { from: string; to: string } {
  const today = date(now);
  if (value === "today") return { from: today, to: today };
  if (value === "week") { const start = new Date(now); start.setDate(start.getDate() - (start.getDay() + 6) % 7); return { from: date(start), to: today }; }
  if (value === "month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (value === "custom") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to
      || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))
      || new Date(from).toISOString().slice(0, 10) !== from || new Date(to).toISOString().slice(0, 10) !== to) throw new Error("Choisissez des dates valides et ordonnées.");
    return { from, to };
  }
  return { from: "", to: "" };
}
export function projectAllocations(workspaces: AllocationWorkspace[], filter: AllocationFilter, now = new Date()): AllocationRow[] {
  const period = filter.kind === "period" ? allocationPeriod(filter.value, filter.from, filter.to, now) : null;
  return workspaces.flatMap((workspace) => {
    if (workspace.ledger) return projectOperational(workspace, filter, period);
    return projectAnnual(workspace, filter);
  });
}

function projectAnnual(workspace: AllocationWorkspace, filter: AllocationFilter): AllocationRow[] {
  if (workspace.forecast?.status !== 'complete') throw new Error('Prévu annuel non confirmé : aucun total partiel ne peut être affiché.');
  const rows = new Map<string, AllocationRow>();
  for (const item of workspace.forecast.rows) {
    if (filter.kind === 'fee' && filter.value && filter.value !== allocationFeeKey(workspace.school.id, item.feeTypeId)) continue;
    if (filter.kind === 'class' && filter.value && filter.value !== allocationClassKey(workspace.school.id, item.classOptionKey || item.className)) continue;
    // A period constrains receipts, never the annual net obligation.
    const existing = rows.get(item.rubricId);
    if (existing) { existing.amountMinor += item.amountMinor; existing.feeName = 'Frais du périmètre'; existing.classLabel = 'Classes du périmètre'; }
    else {
      const config = workspace.configs.find(c => c.feeTypeId === item.feeTypeId) ?? { id: '', schoolId: workspace.school.id, schoolYearId: workspace.year.id,
        feeTypeId: item.feeTypeId, className: item.className, currency: workspace.currency, draftRevision: 0 };
      rows.set(item.rubricId, { key: `${workspace.school.id}/${workspace.year.id}/${item.rubricId}`, schoolId: workspace.school.id, schoolName: workspace.school.name,
        yearName: workspace.year.name, feeName: workspace.fees.find(f => f.id === item.feeTypeId)?.name ?? 'Libellé du frais indisponible',
        classLabel: allocationClassLabel(item.classOptionKey || item.className), currency: workspace.currency, rubricName: item.rubricName,
        rubric: config.draft?.rubrics.find(r => r.id === item.rubricId), amountMinor: item.amountMinor, percent: 0, config, stale: false });
    }
    if (!Number.isSafeInteger(rows.get(item.rubricId)!.amountMinor)) throw new Error('Prévu annuel hors limites.');
  }
  return [...rows.values()];
}

function projectOperational(workspace: AllocationWorkspace, filter: AllocationFilter, period: { from: string; to: string } | null): AllocationRow[] {
  const ledger = workspace.ledger!;
  if (!workspace.configs.length) throw new Error("Configuration active manquante.");
  const base = projectAnnual(workspace, filter);
  const expected = new Map<string, number>();
  base.forEach(row => expected.set(row.key.split('/').at(-1)!, row.amountMinor));
  const rubrics = new Map(ledger.rubrics.map(r => [r.id, r]));
  base.forEach(r => rubrics.set(r.key.split('/').at(-1)!, { id: r.key.split('/').at(-1)!, name: r.rubricName }));
  return [...rubrics.values()].map(rubric => {
    let receivedMinor = 0, spentMinor = 0, availableMinor = 0, openingMinor = 0, arrearsMinor = 0;
    let cumulativeReceivedMinor = 0, cumulativeSpentMinor = 0;
    for (const m of ledger.movements) {
      const day = m.postedAt.slice(0, 10), amount = m.lines.find(l => l.rubricId === rubric.id)?.amountMinor ?? 0;
      if (period?.to && day > period.to) continue;
      // End-of-period availability is cumulative, not the period's cash variation.
      // A rubric is shared: expenditure/availability cannot be invented per fee.
      availableMinor += amount;
      if (m.sourceType === "opening") { openingMinor += amount; continue; }
      if (m.sourceType === "expense") cumulativeSpentMinor -= amount;
      else cumulativeReceivedMinor += amount;
      if (period?.from && day < period.from) continue;
      if (m.sourceType === "expense") { spentMinor -= amount; continue; }
      if (filter.kind === "fee" && filter.value && filter.value !== allocationFeeKey(workspace.school.id, m.feeTypeId ?? "")) continue;
      if (filter.kind === "class" && filter.value && filter.value !== allocationClassKey(workspace.school.id, m.classOptionKey || m.className || "")) continue;
      receivedMinor += amount;
      if (m.originSchoolYearId !== workspace.year.id) arrearsMinor += amount;
    }
    const reserved = ledger.balances.find(b => b.rubricId === rubric.id)?.reservedMinor ?? 0;
    // This candidate does not create reservations. Fail explicitly rather than
    // display a balance that the three displayed components cannot explain.
    if (reserved) throw new Error("Réservations à rapprocher : le solde disponible ne peut pas être justifié par cette vue.");
    if (![receivedMinor, spentMinor, availableMinor, openingMinor, arrearsMinor, cumulativeReceivedMinor, cumulativeSpentMinor].every(Number.isSafeInteger)) throw new Error("Totaux financiers hors limites.");
    if (openingMinor + cumulativeReceivedMinor - cumulativeSpentMinor !== availableMinor) throw new Error("Écart dans le rapprochement de la rubrique.");
    return { key: `${workspace.school.id}/${workspace.year.id}/${rubric.id}`, schoolId: workspace.school.id, schoolName: workspace.school.name,
      yearName: workspace.year.name, feeName: "Rubrique commune · disponible global", classLabel: "Toutes les classes", currency: workspace.currency,
      rubricName: rubric.name, amountMinor: expected.get(rubric.id) ?? 0, percent: 0, config: workspace.configs[0], stale: false,
      financial: { receivedMinor, spentMinor, availableMinor, openingMinor, arrearsMinor, cumulativeReceivedMinor, cumulativeSpentMinor } };
  });
}

export function allocationFinancialTotals(rows: AllocationRow[], field: AllocationFinancialField) {
  return [...new Set(rows.map(r => r.currency))].map(currency => {
    const selected = rows.filter(r => r.currency === currency);
    if (selected.some(r => !r.financial)) return { currency, value: null };
    const value = selected.reduce((n, r) => n + r.financial![field], 0);
    if (!Number.isSafeInteger(value)) throw new Error("Total financier hors limites.");
    return { currency, value };
  });
}
export function allocationTotals(rows: AllocationRow[]) {
  const totals = new Map<"USD" | "CDF", number>();
  for (const row of rows) { const total = (totals.get(row.currency) ?? 0) + row.amountMinor;
    if (!Number.isSafeInteger(total)) throw new Error("Total trop élevé pour une synthèse exacte."); totals.set(row.currency, total); }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}
