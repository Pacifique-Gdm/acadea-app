export interface ReportSignatory {
  id: string;
  name: string;
  functionTitle: string;
}

export function normalizeReportSignatories(value: unknown, legacyText?: string): ReportSignatory[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { id?: unknown; name?: unknown; functionTitle?: unknown; function?: unknown; role?: unknown };
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!name) return [];
      const historicalFunction = candidate.functionTitle ?? candidate.function ?? candidate.role;
      return [{ id: typeof candidate.id === "string" && candidate.id ? candidate.id : `legacy-${index}`, name, functionTitle: typeof historicalFunction === "string" ? historicalFunction.trim() : "" }];
    });
  }
  if (!legacyText?.trim()) return [];
  return legacyText.split(/\r?\n|[,;]/).map((name) => name.trim()).filter(Boolean).map((name, index) => ({ id: `legacy-${index}`, name, functionTitle: "" }));
}

export function normalizeCorrespondenceSignatories(value: unknown, legacySigner?: { fullName?: string; functionTitle?: string }): ReportSignatory[] {
  const normalized = normalizeReportSignatories(value);
  if (normalized.length) return normalized;
  const name = legacySigner?.fullName?.trim() ?? "";
  return name ? [{ id: "legacy-signer", name, functionTitle: legacySigner?.functionTitle?.trim() ?? "" }] : [];
}

export function addReportSignatory(items: ReportSignatory[], id: string = crypto.randomUUID()) {
  return [...items, { id, name: "", functionTitle: "" }];
}

export function removeReportSignatory(items: ReportSignatory[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function prepareReportSignatories(items: ReportSignatory[]) {
  const incomplete = items.some((item) => Boolean(item.name.trim()) !== Boolean(item.functionTitle.trim()));
  if (incomplete) return { items: [], error: "Renseignez les noms et la fonction de chaque signataire." };
  const complete = items.filter((item) => item.name.trim() && item.functionTitle.trim()).map((item) => ({ ...item, name: item.name.trim(), functionTitle: item.functionTitle.trim() }));
  const identities = complete.map((item) => `${item.name}\u0000${item.functionTitle}`);
  if (new Set(identities).size !== identities.length) return { items: [], error: "Un même signataire ne peut pas être ajouté deux fois avec la même fonction." };
  return { items: complete, error: "" };
}

export function groupReportSignatories(items: ReportSignatory[]) {
  const rows: ReportSignatory[][] = [];
  for (let index = 0; index < items.length; index += 3) rows.push(items.slice(index, index + 3));
  return rows;
}

export function reportSignatoriesPdfHtml(items: ReportSignatory[]) {
  const rows = groupReportSignatories(items).map((row) => `<div class="report-signatory-row report-signatory-row--${row.length}">${row.map((item) => `<div class="report-signatory"><span class="report-signatory-name">${escapePdfHtml(item.name)}</span>${item.functionTitle ? `<span class="report-signatory-function">${escapePdfHtml(item.functionTitle)}</span>` : ""}</div>`).join("")}</div>`).join("");
  return rows ? `<section class="report-signatures-block"><div class="report-signatories">${rows}</div></section>` : "";
}
import { escapePdfHtml } from "../../utils/pdf";
