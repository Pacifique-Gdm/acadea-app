import { getCurrentFirebaseIdToken } from "./auth";
import { resolveApiUrl } from "../config/apiUrl";

/** Lot 7 — modèle commun de répartition de la Coordination (serveur uniquement, pourcentages seulement). */
export type TemplateAllocation = { rubricId: string; basisPoints: number };
export type TemplateSubRubric = { id: string; name: string; basisPoints: number };
export type TemplateRubric = { id: string; name: string; subRubrics: TemplateSubRubric[] };
export type TemplateFeeType = { id: string; label: string; allocations: TemplateAllocation[] };
export type AllocationTemplate = { coordinationId: string; name: string; version: number; rubrics: TemplateRubric[]; feeTypes: TemplateFeeType[]; defaultAllocations: TemplateAllocation[]; publishedAt: string; publishedByName?: string };

/** Formulaire : pourcentages saisis en texte (« 40 », « 12,5 »), une case par rubrique. */
export type TemplateForm = {
  name: string;
  rubrics: Array<{ id: string; name: string; subRubrics: Array<{ id: string; name: string; percent: string }> }>;
  feeTypes: Array<{ id: string; label: string; percents: Record<string, string> }>;
  defaultPercents: Record<string, string>;
};

export const newTemplateId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g, "").slice(0, 24);

/** « 12,5 » → 1250 ; vide → 0 ; texte invalide → NaN (bloque la publication). */
export function percentToBasisPoints(value: string): number {
  const text = value.trim().replace(",", ".");
  if (!text) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return Number.NaN;
  return Math.round(Number(text) * 100);
}
export const basisPointsToPercent = (value: number) => (value / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const percentText = (value: number) => String(value / 100).replace(".", ",");

export function percentsTotal(percents: Record<string, string>, rubricIds: string[]): number {
  return rubricIds.reduce((sum, id) => sum + (percentToBasisPoints(percents[id] ?? "") || 0), 0);
}

export function emptyTemplateForm(): TemplateForm {
  return { name: "", rubrics: [{ id: newTemplateId(), name: "", subRubrics: [] }], feeTypes: [], defaultPercents: {} };
}

export function templateToForm(template: AllocationTemplate | null): TemplateForm {
  if (!template) return emptyTemplateForm();
  const toPercents = (lines: TemplateAllocation[]) => Object.fromEntries(lines.map((line) => [line.rubricId, percentText(line.basisPoints)]));
  return {
    name: template.name,
    rubrics: template.rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name, subRubrics: rubric.subRubrics.map((sub) => ({ id: sub.id, name: sub.name, percent: percentText(sub.basisPoints) })) })),
    feeTypes: template.feeTypes.map((feeType) => ({ id: feeType.id, label: feeType.label, percents: toPercents(feeType.allocations) })),
    defaultPercents: toPercents(template.defaultAllocations),
  };
}

/** Problèmes à corriger avant publication (le serveur revérifie tout). Liste vide = publication possible. */
export function templateFormProblems(form: TemplateForm): string[] {
  const problems: string[] = [];
  const rubricIds = form.rubrics.map((r) => r.id);
  if (!form.name.trim()) problems.push("Donnez un nom au modèle.");
  if (!form.rubrics.length) problems.push("Ajoutez au moins une rubrique.");
  if (form.rubrics.some((r) => !r.name.trim())) problems.push("Chaque rubrique doit avoir un nom.");
  for (const rubric of form.rubrics) {
    const values = rubric.subRubrics.map((s) => percentToBasisPoints(s.percent));
    if (rubric.subRubrics.some((s) => !s.name.trim())) problems.push(`Chaque sous-rubrique de « ${rubric.name || "rubrique"} » doit avoir un nom.`);
    if (values.some((v) => !Number.isFinite(v) || v <= 0)) problems.push(`Pourcentage invalide dans les sous-rubriques de « ${rubric.name || "rubrique"} ».`);
    else if (values.reduce((a, b) => a + b, 0) > 10000) problems.push(`Les sous-rubriques de « ${rubric.name || "rubrique"} » dépassent 100 %.`);
  }
  const rows: Array<[string, Record<string, string>]> = [...form.feeTypes.map((f) => [f.label.trim() || "type de frais", f.percents] as [string, Record<string, string>]), ["Tout autre frais", form.defaultPercents]];
  if (form.feeTypes.some((f) => !f.label.trim())) problems.push("Chaque type de frais doit avoir un nom.");
  for (const [label, percents] of rows) {
    if (rubricIds.some((id) => Number.isNaN(percentToBasisPoints(percents[id] ?? "")))) problems.push(`Pourcentage invalide dans « ${label} ».`);
    else if (percentsTotal(percents, rubricIds) > 10000) problems.push(`« ${label} » dépasse 100 %.`);
  }
  return [...new Set(problems)];
}

export function formToTemplateInput(form: TemplateForm) {
  const rubricIds = form.rubrics.map((r) => r.id);
  const toAllocations = (percents: Record<string, string>) => rubricIds.map((rubricId) => ({ rubricId, basisPoints: percentToBasisPoints(percents[rubricId] ?? "") })).filter((line) => line.basisPoints > 0);
  return {
    name: form.name.trim(),
    rubrics: form.rubrics.map((rubric) => ({ id: rubric.id, name: rubric.name.trim(), subRubrics: rubric.subRubrics.map((sub) => ({ id: sub.id, name: sub.name.trim(), basisPoints: percentToBasisPoints(sub.percent) })) })),
    feeTypes: form.feeTypes.map((feeType) => ({ id: feeType.id, label: feeType.label.trim(), allocations: toAllocations(feeType.percents) })),
    defaultAllocations: toAllocations(form.defaultPercents),
  };
}

async function call<T>(input: Record<string, unknown>): Promise<T> {
  const token = await getCurrentFirebaseIdToken();
  const response = await fetch(resolveApiUrl("/api/manage-coordination"), { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Opération sur le modèle de répartition impossible.");
  return payload as T;
}

export const loadAllocationTemplate = () => call<{ template: AllocationTemplate | null }>({ action: "allocation-template-read" });
export const publishAllocationTemplate = (form: TemplateForm, expectedVersion: number) => call<{ template: AllocationTemplate }>({ action: "allocation-template-publish", expectedVersion, ...formToTemplateInput(form) });
