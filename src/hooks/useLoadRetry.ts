import { useCallback, useEffect, useRef, useState } from "react";

/** Délais des relances automatiques d'un chargement en échec (réseau faible
 * sans coupure franche) ; le retour du réseau relance aussitôt. */
export const LOAD_RETRY_DELAYS_MS = Object.freeze([15_000, 30_000, 60_000]);

type RetryTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/** Arme les relances automatiques d'un chargement en échec : retour du
 * réseau (`online`) et essais espacés. Renvoie la fonction qui désarme. */
export function armLoadRetry({ target, retry, attempt, delays = LOAD_RETRY_DELAYS_MS }: {
  target: RetryTarget;
  retry: () => void;
  /** Nombre d'essais espacés déjà faits (remis à zéro au retour du réseau). */
  attempt: { current: number };
  delays?: readonly number[];
}) {
  const onOnline = () => { attempt.current = 0; retry(); };
  target.addEventListener("online", onOnline);
  const delay = delays[attempt.current];
  const timer = delay === undefined ? undefined : setTimeout(() => { attempt.current += 1; retry(); }, delay);
  return () => {
    target.removeEventListener("online", onOnline);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** Relance d'un CHARGEMENT — jamais d'un enregistrement d'argent (paiement,
 * dépense, encaissement, paie) : pour eux, seulement le bouton « Réessayer ».
 *
 * - `retry()` : à brancher sur le bouton « Réessayer » ;
 * - `token` : à ajouter aux dépendances de l'effet qui charge ;
 * - tant que `failed` est vrai, le retour de la connexion et trois essais
 *   espacés relancent seuls le chargement ;
 * - `clear` (facultatif) efface le message au départ de chaque relance : il
 *   disparaît si le chargement réussit, et revient seulement s'il échoue encore. */
export function useLoadRetry(failed: boolean, clear?: () => void) {
  const [token, setToken] = useState(0);
  const attempt = useRef(0);
  const clearRef = useRef(clear);
  useEffect(() => { clearRef.current = clear; });
  const retry = useCallback(() => { clearRef.current?.(); setToken((value) => value + 1); }, []);

  useEffect(() => {
    if (!failed || typeof window === "undefined") return;
    return armLoadRetry({ target: window, retry, attempt });
  }, [failed, retry, token]);

  return { token, retry };
}
