import { useCallback, useEffect, useRef, useState } from "react";
import { nextRetryDelay, type FailureKind } from "../services/requestFailure";

/** Nouvelles tentatives limitées et espacées, plus une relance immédiate au
 * retour du réseau. `token` change à chaque relance : l'ajouter aux
 * dépendances de l'effet qui charge les données. */
export function useAutoRetry() {
  const [token, setToken] = useState(0);
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const waiting = useRef(false);

  const clear = () => { if (timer.current !== undefined) clearTimeout(timer.current); timer.current = undefined; };

  /** Programme la tentative suivante ; renvoie false quand il n'y en aura plus. */
  const schedule = useCallback((kind: FailureKind) => {
    const delay = nextRetryDelay(kind, attempt.current);
    clear();
    waiting.current = kind === "network" || delay !== null;
    if (delay === null) return false;
    attempt.current += 1;
    timer.current = setTimeout(() => { timer.current = undefined; setToken((value) => value + 1); }, delay);
    return true;
  }, []);

  /** À appeler après un succès : les prochains échecs repartent du premier délai. */
  const succeeded = useCallback(() => { attempt.current = 0; waiting.current = false; clear(); }, []);

  useEffect(() => {
    const onOnline = () => {
      if (!waiting.current) return;
      attempt.current = 0;
      clear();
      setToken((value) => value + 1);
    };
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("online", onOnline); clear(); };
  }, []);

  return { token, schedule, succeeded };
}
