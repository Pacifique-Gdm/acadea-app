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
