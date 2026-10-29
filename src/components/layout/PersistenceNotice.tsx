import { useSyncExternalStore } from "react";
import { persistenceStatus } from "../../services/persistenceStatus";

export function PersistenceNotice() {
  const state = useSyncExternalStore(persistenceStatus.subscribe, persistenceStatus.getSnapshot);
  if (!state.pending && !state.completed) return null;
  return <div role={state.failed ? "alert" : "status"} aria-live="polite"
    className={`fixed bottom-3 right-3 z-[90] max-w-sm rounded border bg-white px-4 py-2 text-sm shadow ${state.failed ? "border-red-200 text-red-700" : "border-slate-200 text-ink"}`}>
    {state.pending ? `Enregistrement en cours (${state.pending})…` : state.failed
      ? "Échec de l’enregistrement. Les modifications affichées ne sont pas toutes confirmées par le serveur. Vérifiez les données avant de réessayer."
      : "Enregistré sur le serveur."}
  </div>;
}
