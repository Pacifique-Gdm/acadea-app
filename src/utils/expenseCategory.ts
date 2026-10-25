/** Presentation only: the historical Firestore category remains "Salaire". */
export function expenseCategoryLabel(category: string): string {
  return category === "Salaire" ? "Main d'œuvre" : category;
}
