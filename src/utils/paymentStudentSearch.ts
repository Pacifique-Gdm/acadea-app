/** « Aucun élève trouvé. » n'a de sens que pendant une recherche : jamais quand un élève est déjà sélectionné
 * (le champ affiche alors « nom | matricule », qui ne correspond à aucun élève). */
export function showNoPaymentStudentFound(query: string, resultCount: number, hasSelectedStudent: boolean) {
  return !hasSelectedStudent && query.trim() !== "" && resultCount === 0;
}
