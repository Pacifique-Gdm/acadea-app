import { useCallback, useEffect, useMemo, useState } from "react";
import { abandonFailedOfflineOperation, listOfflineOperations, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "../../services/offlineQueue";
import { syncOfflineOperations } from "../../services/offlineSync";
import type { OfflineAccess } from "../../services/offlineAccess";
import { OfflineDraftForms } from "./OfflineDraftForms";

const kindLabel: Record<OfflineOperationKind, string> = {
  grade: "Cote", attendance: "Présence", student_enrollment: "Inscription d'élève",
  payment_proposal: "Proposition provisoire de paiement",
};
const statusLabel: Record<OfflineOperation["status"], string> = {
  LOCAL_PENDING: "En attente", SYNCING: "Vérification serveur en cours",
  SERVER_CONFIRMED: "Confirmée par le serveur", CONFLICT: "Conflit — intervention nécessaire",
  REJECTED: "Refusée — intervention nécessaire", RETRYABLE_ERROR: "À réessayer à la reconnexion",
};

export function OfflineQueuePanel({ scope, autoSync, role }: { scope: OfflineScope; autoSync: boolean; role: OfflineAccess["role"] }) {
  const stableScope = useMemo(() => ({ userId: scope.userId, schoolId: scope.schoolId,
    schoolYearId: scope.schoolYearId }), [scope.userId, scope.schoolId, scope.schoolYearId]);
  const [open, setOpen] = useState(false);
  const [operations, setOperations] = useState<OfflineOperation[]>([]);
  const [error, setError] = useState("");
  const [abandonId, setAbandonId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const refresh = useCallback(() => {
    void listOfflineOperations(stableScope).then(setOperations).catch(() => setError("Stockage local indisponible."));
  }, [stableScope]);
  const sync = useCallback(() => {
    if (!autoSync || navigator.onLine === false) return;
    void syncOfflineOperations(stableScope, refresh).catch(() => setError("Synchronisation indisponible. Les brouillons restent conservés localement."));
  }, [autoSync, refresh, stableScope]);
  useEffect(() => {
    refresh();
    sync();
    const onOnline = () => { refresh(); sync(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onOnline);
    window.addEventListener("acadea:offline-operation-queued", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onOnline);
      window.removeEventListener("acadea:offline-operation-queued", onOnline);
    };
  }, [refresh, sync]);
  const outstanding = operations.filter((operation) => operation.status !== "SERVER_CONFIRMED").length;
  return <div className="relative">
    <button type="button" className="secondary-button justify-center text-xs" onClick={() => { refresh(); setOpen((value) => !value); }}
      aria-expanded={open} aria-label={`Opérations hors connexion : ${outstanding} à traiter`}>
      Hors connexion · {outstanding}
    </button>
    {open && <section className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(90vw,26rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-ink shadow-xl"
      aria-label="État des opérations hors connexion">
      <h2 className="font-semibold">Opérations locales</h2>
      <p className="mt-1 text-xs text-slate-600">Seul un accusé serveur confirme une opération. Un paiement provisoire ne produit jamais de reçu local.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {!operations.length && <p className="mt-3 text-sm">Aucune opération locale pour ce compte et cette année.</p>}
      <ul className="mt-3 grid gap-2">
        {operations.map((operation) => <li key={operation.id} className="rounded border border-slate-200 p-2 text-sm">
          <div className="font-semibold">{kindLabel[operation.kind]}</div>
          <div>{statusLabel[operation.status]}</div>
          <div className="text-xs text-slate-500">Créée le {new Date(operation.createdAt).toLocaleString("fr-FR")}</div>
          {operation.error && <p className="mt-1 text-xs text-amber-800">{operation.error}</p>}
          {(operation.status === "CONFLICT" || operation.status === "REJECTED") && <div className="mt-2 grid gap-1">
            <p className="text-xs">Comparez ce brouillon avec les données serveur avant de ressaisir. Aucun écrasement automatique n'a lieu.</p>
            {abandonId === operation.id ? <>
              <input className="input" aria-label="Confirmation d'abandon du brouillon" placeholder="ABANDONNER LE BROUILLON"
                value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <button type="button" className="secondary-button justify-center" onClick={() => {
                void abandonFailedOfflineOperation(stableScope, operation.id, confirmation)
                  .then(() => { setAbandonId(""); setConfirmation(""); refresh(); })
                  .catch((cause) => setError(cause instanceof Error ? cause.message : "Abandon impossible."));
              }}>Confirmer l'abandon</button>
            </> : <button type="button" className="secondary-button justify-center" onClick={() => setAbandonId(operation.id)}>Abandonner après vérification</button>}
          </div>}
        </li>)}
      </ul>
      {autoSync && <button type="button" className="primary-button mt-3 justify-center" onClick={sync}>Réessayer la synchronisation</button>}
      <OfflineDraftForms scope={stableScope} role={role} />
    </section>}
  </div>;
}
