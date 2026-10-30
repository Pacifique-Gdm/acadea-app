import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { abandonFailedOfflineOperation, listOfflineOperations, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "../../services/offlineQueue";
import { syncOfflineOperations } from "../../services/offlineSync";
import type { OfflineAccess } from "../../services/offlineAccess";
import { OfflineDraftForms } from "./OfflineDraftForms";
import { useAsyncAction } from "../../hooks/useAsyncAction";

const kindLabel: Record<OfflineOperationKind, string> = {
  grade: "Cote", attendance: "Présence", student_enrollment: "Inscription d'élève",
  payment_proposal: "Proposition provisoire de paiement",
};
const statusLabel: Record<OfflineOperation["status"], string> = {
  LOCAL_PENDING: "En attente", SYNCING: "Vérification serveur en cours",
  SERVER_CONFIRMED: "Confirmée par le serveur", CONFLICT: "Conflit — intervention nécessaire",
  REJECTED: "Refusée — intervention nécessaire", RETRYABLE_ERROR: "À réessayer à la reconnexion",
};

export function OfflineQueuePanel({ scope, autoSync, role, initialOpen = false }: { scope: OfflineScope; autoSync: boolean; role: OfflineAccess["role"]; initialOpen?: boolean }) {
  const stableScope = useMemo(() => ({ userId: scope.userId, schoolId: scope.schoolId,
    schoolYearId: scope.schoolYearId }), [scope.userId, scope.schoolId, scope.schoolYearId]);
  const [open, setOpen] = useState(initialOpen);
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [operations, setOperations] = useState<OfflineOperation[]>([]);
  const [error, setError] = useState("");
  const [abandonId, setAbandonId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const scopeKey = `${stableScope.userId}/${stableScope.schoolId}/${stableScope.schoolYearId}`;
  const loading = loadedScope !== scopeKey;
  const requestVersion = useRef(0);
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const action = useAsyncAction();
  const run = action.run;
  const refresh = useCallback(() => {
    const version = ++requestVersion.current;
    void listOfflineOperations(stableScope).then((items) => {
      if (version !== requestVersion.current) return;
      setOperations(items); setLoadedScope(scopeKey); setError("");
    }).catch(() => {
      if (version !== requestVersion.current) return;
      setOperations([]); setLoadedScope(scopeKey); setError("Stockage local indisponible.");
    });
  }, [stableScope, scopeKey]);
  const sync = useCallback(() => {
    if (!autoSync || navigator.onLine === false) return;
    void run("sync", async () => {
      const before = await listOfflineOperations(stableScope);
      await syncOfflineOperations(stableScope, refresh);
      const after = await listOfflineOperations(stableScope);
      if (after.some((item) => item.status === "CONFLICT" || item.status === "REJECTED")) {
        setNotice("Des opérations nécessitent votre intervention.");
      } else if (after.some((item) => item.status === "SERVER_CONFIRMED" && before.find((old) => old.id === item.id)?.status !== "SERVER_CONFIRMED")) {
        setNotice("Opérations synchronisées et confirmées par le serveur.");
      }
      refresh();
    }, "Synchronisation indisponible. Les brouillons restent conservés localement.");
  }, [autoSync, refresh, stableScope, run]);
  useEffect(() => {
    refresh();
    sync();
    const onOnline = () => { setOnline(true); setNotice("Connexion rétablie. Synchronisation en cours."); refresh(); sync(); };
    const onOffline = () => { setOnline(false); setNotice("Connexion interrompue. Les opérations compatibles restent locales."); refresh(); };
    const onFocus = () => { refresh(); sync(); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    window.addEventListener("acadea:offline-operation-queued", onFocus);
    return () => {
      invalidateRequests();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("acadea:offline-operation-queued", onFocus);
    };
  }, [refresh, sync, invalidateRequests]);
  const needsIntervention = (!loading && operations.some((item) => item.status === "CONFLICT" || item.status === "REJECTED" || (online && item.status === "RETRYABLE_ERROR"))) || Boolean(error || action.error);
  useEffect(() => {
    if (!notice || needsIntervention || !online) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, needsIntervention, online]);
  const outstanding = loading ? 0 : operations.filter((operation) => operation.status !== "SERVER_CONFIRMED").length;
  return <div>
    {(notice || needsIntervention) && !open && <div role={needsIntervention ? "alert" : "status"} className="fixed left-3 right-3 top-4 z-[80] rounded border border-amber-200 bg-white p-3 text-sm text-ink shadow-lg sm:left-auto sm:right-4 sm:max-w-sm">
      <span>{needsIntervention ? error || action.error || `Des opérations nécessitent votre intervention (${outstanding}).` : notice}</span>
      {(needsIntervention || !online) && <button type="button" className="ml-2 font-semibold underline" onClick={() => { refresh(); setOpen(true); }}>Voir les opérations</button>}
    </div>}
    {open && <section className={initialOpen ? "w-full rounded-lg border border-slate-200 bg-white p-4 text-ink shadow-xl" : "fixed bottom-20 left-3 right-3 z-[80] max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-ink shadow-xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-[min(90vw,26rem)]"}
      aria-label="État des opérations hors connexion">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Opérations locales</h2>{!initialOpen && <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>Fermer</button>}</div>
      <p className="mt-1 text-xs text-slate-600">Seul un accusé serveur confirme une opération. Un paiement provisoire ne produit jamais de reçu local.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {action.error && <p role="alert" className="mt-2 text-sm text-red-700">{action.error}</p>}
      {loading && <p role="status">Lecture des opérations locales…</p>}
      {!loading && !error && !operations.length && <p className="mt-3 text-sm">Aucune opération locale pour ce compte et cette année.</p>}
      <ul className="mt-3 grid gap-2">
        {(loading ? [] : operations).map((operation) => <li key={operation.id} className="rounded border border-slate-200 p-2 text-sm">
          <div className="font-semibold">{kindLabel[operation.kind]}</div>
          <div>{statusLabel[operation.status]}</div>
          <div className="text-xs text-slate-500">Créée le {new Date(operation.createdAt).toLocaleString("fr-FR")}</div>
          {operation.error && <p className="mt-1 text-xs text-amber-800">{operation.error}</p>}
          {(operation.status === "CONFLICT" || operation.status === "REJECTED") && <div className="mt-2 grid gap-1">
            <p className="text-xs">Comparez ce brouillon avec les données serveur avant de ressaisir. Aucun écrasement automatique n'a lieu.</p>
            {abandonId === operation.id ? <>
              <input className="input" aria-label="Confirmation d'abandon du brouillon" placeholder="ABANDONNER LE BROUILLON"
                value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              <button type="button" className="secondary-button justify-center" disabled={action.isPending(operation.id)} onClick={() => {
                void run(operation.id, async () => { await abandonFailedOfflineOperation(stableScope, operation.id, confirmation); setAbandonId(""); setConfirmation(""); refresh(); });
              }}>{action.isPending(operation.id) ? "Traitement…" : "Confirmer l'abandon"}</button>
            </> : <button type="button" className="secondary-button justify-center" onClick={() => setAbandonId(operation.id)}>Abandonner après vérification</button>}
          </div>}
        </li>)}
      </ul>
      {autoSync && online && (outstanding > 0 || action.error) && <button type="button" className="primary-button mt-3 justify-center" disabled={action.isPending("sync")} onClick={sync}>{action.isPending("sync") ? "Synchronisation…" : "Réessayer la synchronisation"}</button>}
      <OfflineDraftForms scope={stableScope} role={role} />
    </section>}
  </div>;
}
