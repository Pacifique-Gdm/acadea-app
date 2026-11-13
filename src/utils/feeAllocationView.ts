import { validateFeeAllocationRubrics } from "../../api/_lib/feeAllocationMath.js";
import type { AllocationWorkspace } from "../services/feeAllocation";
import type { FeeAllocationConfig, FeeAllocationRubric } from "../types/feeAllocation";

export type AllocationFilter = { kind: "fee" | "class" | "period"; value: string; from: string; to: string };
export type AllocationRow = { key: string; schoolId: string; schoolName: string; yearName: string; feeName: string;
  classLabel: string; currency: "USD" | "CDF"; rubricName: string; rubric?: FeeAllocationRubric;
  amountMinor: number; percent: number; config: FeeAllocationConfig; stale: boolean };
export const unavailableAllocation = "Indisponible — répartition en préparation";
export const allocationFeeKey = (schoolId: string, feeId: string) => JSON.stringify([schoolId, feeId]);
export const allocationClassKey = (schoolId: string, classKey: string) => JSON.stringify([schoolId, classKey]);
export const allocationClassLabel = (value: string) => value.replace("::option::", " — ");
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
  return workspaces.flatMap((workspace) => workspace.configs.flatMap((config) => {
    if (!config.draft) return [];
    const fee = workspace.fees.find((item) => item.id === config.feeTypeId);
    if (filter.kind === "fee" && filter.value && filter.value !== allocationFeeKey(config.schoolId, config.feeTypeId)) return [];
    if (filter.kind === "class" && filter.value && filter.value !== allocationClassKey(config.schoolId, config.classOptionKey || config.className)) return [];
    const updated = config.draft.updatedAt.slice(0, 10);
    if (period && ((period.from && updated < period.from) || (period.to && updated > period.to))) return [];
    const validated = validateFeeAllocationRubrics(config.draft.rubrics, config.draft.feeAmountMinor);
    const stale = !fee || Math.round(fee.amount * 100) !== config.draft.feeAmountMinor
      || fee.className !== config.className || (fee.classOptionKey ?? "") !== (config.classOptionKey ?? "") || config.currency !== workspace.currency;
    return validated.shares.map((share) => {
      const rubric = validated.rubrics.find((item) => item.id === share.rubricId);
      return { key: `${config.id}/${share.rubricId}`, schoolId: config.schoolId, schoolName: workspace.school.name,
        yearName: workspace.year.name, feeName: fee?.name ?? `Frais historique ${config.feeTypeId}`,
        classLabel: allocationClassLabel(config.classOptionKey || config.className), currency: config.currency,
        rubricName: rubric?.name ?? "Non affecté", rubric, amountMinor: share.amountMinor,
        percent: share.amountMinor / config.draft!.feeAmountMinor * 100, config, stale };
    });
  }));
}
export function allocationTotals(rows: AllocationRow[]) {
  const totals = new Map<"USD" | "CDF", number>();
  for (const row of rows) { const total = (totals.get(row.currency) ?? 0) + row.amountMinor;
    if (!Number.isSafeInteger(total)) throw new Error("Total trop élevé pour une synthèse exacte."); totals.set(row.currency, total); }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}
