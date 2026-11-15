import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { loadCoordinationClassFilterChoices } from "../../services/coordinationService";
import type { SchoolClassRecord } from "../../types";

/** Lot 19 : nombre de retours sur un onglet gardé en place (0 à la première ouverture). */
export function nextReturnCount(count: number, wasActive: boolean, isActive: boolean) {
  return !wasActive && isActive ? count + 1 : count;
}

export function useReturnCount(active: boolean) {
  const [count, setCount] = useState(0);
  const previous = useRef(active);
  useEffect(() => {
    setCount((value) => nextReturnCount(value, previous.current, active));
    previous.current = active;
  }, [active]);
  return count;
}

/** Même contenu (dans le même ordre) : la liste affichée est gardée telle quelle. */
export function sameClassRecords(a: readonly SchoolClassRecord[], b: readonly SchoolClassRecord[]) {
  return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** La liste des classes vient du serveur (les règles ne permettent pas à la coordination de
 * l'écouter en temps réel) : au retour sur l'onglet, elle est relue sans effacer l'affichage,
 * et remplacée seulement si elle a changé. */
export function useSilentClassRefresh(returnCount: number, schoolIdsKey: string, setClassRecords: Dispatch<SetStateAction<SchoolClassRecord[]>>) {
  useEffect(() => {
    if (!returnCount || !schoolIdsKey) return;
    let cancelled = false;
    loadCoordinationClassFilterChoices()
      .then((next) => { if (!cancelled) setClassRecords((current) => sameClassRecords(current, next) ? current : next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [returnCount, schoolIdsKey, setClassRecords]);
}
