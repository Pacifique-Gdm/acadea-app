import { useEffect, useState } from "react";

/** Version 1.16.5 : « 1 école », « 29 écoles » (0 et 1 au singulier, comme en français). */
export function schoolCountLabel(total: number): string {
  return `${total} ${total > 1 ? "écoles" : "école"}`;
}

/** Un petit indicateur n'apparaît que si la recherche dure plus d'une seconde. */
export const SLOW_SCHOOL_SEARCH_MS = 1_000;

export function useSlowFlag(active: boolean, delayMs = SLOW_SCHOOL_SEARCH_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) { setSlow(false); return undefined; }
    const timer = window.setTimeout(() => setSlow(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return slow && active;
}
