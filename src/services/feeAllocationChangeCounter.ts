import { useEffect, useRef } from "react";
import { doc, onSnapshot, type Firestore } from "@firebase/firestore";
import { db } from "../firebase";

/** Version 1.15.2 : compteur de changements tenu par le serveur, un document par école et par année. */
export const changeCounterPath = (schoolId: string, schoolYearId: string) => `feeAllocationChangeCounters/${schoolId}__${schoolYearId}`;
export type CounterScope = { schoolId: string; schoolYearId: string };

/**
 * Décide s'il faut recharger : jamais au premier relevé d'un compteur (les montants affichés viennent d'être
 * vérifiés à l'ouverture), puis seulement quand la valeur d'un compteur change.
 */
export function counterChanged(seen: Map<string, number>, key: string, count: number): boolean {
  const previous = seen.get(key);
  seen.set(key, count);
  return previous !== undefined && previous !== count;
}

/** Écoute les compteurs des écoles affichées ; `onChange` n'est appelé que lorsqu'un compteur bouge. */
export function useAllocationChangeCounters(scopes: CounterScope[], onChange: () => void, database: unknown = db) {
  const callback = useRef(onChange);
  callback.current = onChange;
  const key = scopes.map((s) => `${s.schoolId}__${s.schoolYearId}`).sort().join("|");
  useEffect(() => {
    if (!database || !key) return;
    const seen = new Map<string, number>();
    const store = database as unknown as Firestore;
    const stops = key.split("|").map((id) => onSnapshot(doc(store, "feeAllocationChangeCounters", id), (snapshot) => {
      const count = Number(snapshot.data()?.count ?? 0);
      if (counterChanged(seen, id, count)) callback.current();
    }, () => { /* Compteur indisponible : le drawer garde ses montants et l'actualisation manuelle reste possible. */ }));
    return () => stops.forEach((stop) => stop());
  }, [key, database]);
}
