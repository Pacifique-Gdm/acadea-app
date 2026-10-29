import type { CashInflow } from "../types";

export function cashInflowCategoryLabel(category: CashInflow["category"]): string {
  return category === "Frais de fonctionnement" ? "Frais de fonctionnement reçus" : category;
}
