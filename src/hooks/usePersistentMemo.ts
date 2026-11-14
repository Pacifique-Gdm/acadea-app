import { useMemo } from "react";

/** Comme useMemo, mais le dernier résultat survit au démontage de l'écran :
 * en revenant sur le Dashboard avec les mêmes données (mêmes tableaux, mêmes
 * filtres, même date du jour), le calcul n'est pas refait. Dès qu'une
 * dépendance change (nouveau paiement, autre année, autre filtre, y compris
 * venant d'un autre utilisateur en temps réel), il est recalculé : jamais de
 * valeur périmée. Mémoire de l'onglet navigateur uniquement. */
const store = new Map<string, { deps: readonly unknown[]; value: unknown }>();

export function persistentMemo<T>(slot: string, factory: () => T, deps: readonly unknown[]): T {
  const hit = store.get(slot);
  if (hit && hit.deps.length === deps.length && hit.deps.every((value, index) => Object.is(value, deps[index]))) return hit.value as T;
  const value = factory();
  store.set(slot, { deps: [...deps], value });
  return value;
}

/** Signature (fabrique, dépendances, nom) : la règle react-hooks/exhaustive-deps
 * vérifie les dépendances comme pour useMemo (voir `additionalHooks` dans eslint.config.js). */
export function usePersistentMemo<T>(factory: () => T, deps: readonly unknown[], slot: string): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => persistentMemo(slot, factory, deps), [slot, ...deps]);
}

export function clearPersistentMemo() {
  store.clear();
}
