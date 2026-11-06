import type { CashInflow } from "../types";

export function cashInflowCategoryLabel(category: CashInflow["category"]): string {
  return category === "Frais de fonctionnement" ? "Frais de fonctionnement reçus" : category;
}

export function cashInflowNatureLabel(inflow: Pick<CashInflow, "category" | "categoryDetail">): string {
  const detail = inflow.category === "Autres" ? inflow.categoryDetail?.trim() : "";
  return detail ? `Autres — ${detail}` : cashInflowCategoryLabel(inflow.category);
}
