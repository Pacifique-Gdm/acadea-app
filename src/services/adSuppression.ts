import { useEffect, useSyncExternalStore } from "react";

/**
 * Écrans où la publicité est interdite (reçus, rapports, paiements…).
 * Tant qu'un de ces écrans est ouvert, l'en-tête normal de l'école revient.
 */
let count = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function suppressAds(): () => void {
  count += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

export function adsSuppressed(): boolean {
  return count > 0;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** À placer dans un écran sans publicité : `useAdSuppression()` ou `useAdSuppression(condition)`. */
export function useAdSuppression(active = true) {
  useEffect(() => (active ? suppressAds() : undefined), [active]);
}

export function useAdsSuppressed(): boolean {
  return useSyncExternalStore(subscribe, adsSuppressed, adsSuppressed);
}
