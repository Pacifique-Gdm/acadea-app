import { useCallback, useRef, useState } from "react";

/** Immediate ref lock prevents duplicate clicks before React commits the busy state. */
export function useAsyncAction() {
  const locks = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const [error, setError] = useState("");
  const run = useCallback(async (key: string, action: () => Promise<unknown>, fallback = "Opération impossible. Veuillez réessayer.") => {
    if (locks.current.has(key)) return;
    locks.current.add(key);
    setPending([...locks.current]);
    setError("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    finally { locks.current.delete(key); setPending([...locks.current]); }
  }, []);
  return { run, error, pending, isPending: (key: string) => pending.includes(key) };
}
