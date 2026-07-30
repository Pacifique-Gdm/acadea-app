export interface ReportSignatory {
  id: string;
  name: string;
}

export function normalizeReportSignatories(value: unknown, legacyText?: string): ReportSignatory[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { id?: unknown; name?: unknown };
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      if (!name) return [];
      return [{ id: typeof candidate.id === "string" && candidate.id ? candidate.id : `legacy-${index}`, name }];
    });
  }
  if (!legacyText?.trim()) return [];
  return legacyText.split(/\r?\n|[,;]/).map((name) => name.trim()).filter(Boolean).map((name, index) => ({ id: `legacy-${index}`, name }));
}

export function addReportSignatory(items: ReportSignatory[], name: string, id: string = crypto.randomUUID()) {
  const normalized = name.trim();
  if (!normalized || items.some((item) => item.name === normalized)) return items;
  return [...items, { id, name: normalized }];
}

export function removeReportSignatory(items: ReportSignatory[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function groupReportSignatories(items: ReportSignatory[]) {
  const rows: ReportSignatory[][] = [];
  for (let index = 0; index < items.length; index += 3) rows.push(items.slice(index, index + 3));
  return rows;
}
