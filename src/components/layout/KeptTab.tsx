import type { ReactNode } from "react";

/** Lot 19 : onglets gardés pendant toute la session. Un onglet n'est construit qu'à sa
 * première ouverture ; ensuite il reste en place, simplement masqué, avec ses données
 * et ses écoutes : y revenir n'entraîne aucun nouveau chargement. */
export function KeptTab({ id, active, visited, children }: { id: string; active: string; visited: readonly string[]; children: ReactNode }) {
  if (!visited.includes(id)) return null;
  // Onglet visible : « contents » pour ne rien changer à la mise en page (les enfants restent
  // des éléments de la grille parente). Onglet masqué : attribut hidden seul (display: none).
  return id === active ? <div className="contents">{children}</div> : <div hidden>{children}</div>;
}
