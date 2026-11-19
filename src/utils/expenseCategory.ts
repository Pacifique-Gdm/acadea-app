/** Presentation only: the historical Firestore category remains "Salaire".
 * Nature « Autre » : la précision saisie est ajoutée (« Autre — Réparation du portail »). */
export function expenseCategoryLabel(category: string, detail?: string): string {
  if (category === "Salaire") return "Main d'œuvre";
  const precision = category === "Autre" || category === "Autres" ? detail?.trim() : "";
  return precision ? `${category} — ${precision}` : category;
}
