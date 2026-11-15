import { useState } from "react";

/** Lot 19 : un onglet n'est construit qu'à sa première ouverture, puis gardé. */
export function nextVisitedTabs<T extends string>(visited: readonly T[], active: T): readonly T[] {
  return visited.includes(active) ? visited : [...visited, active];
}

export function useVisitedTabs<T extends string>(active: T): readonly T[] {
  const [visited, setVisited] = useState<readonly T[]>([active]);
  const next = nextVisitedTabs(visited, active);
  if (next !== visited) setVisited(next);
  return next;
}

/** Valeur transmise à un onglet gardé : figée tant qu'il est caché (aucun rechargement, aucune
 * lecture ni appel serveur en arrière-plan), mise à jour dès qu'il redevient visible. */
export function frozenWhileHidden<T>(active: boolean, value: T, lastShown: T): T {
  return active ? value : lastShown;
}

export function useFrozenWhileHidden<T>(active: boolean, value: T): T {
  const [lastShown, setLastShown] = useState(value);
  if (active && !Object.is(lastShown, value)) setLastShown(value);
  return frozenWhileHidden(active, value, lastShown);
}
