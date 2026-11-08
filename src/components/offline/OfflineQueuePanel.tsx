import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../firebase";
import { abandonFailedOfflineOperation, inspectOfflineOperations, type OfflineOperation, type OfflineOperationKind, type OfflineScope } from "../../services/offlineQueue";
import { offlineRetryDelay, syncOfflineOperations } from "../../services/offlineSync";
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
  REJECTED: "Refusée — intervention nécessaire", RETRYABLE_ERROR: "En attente de reprise automatique",
};

export function OfflineQueuePanel({ scope, autoSync, role, initialOpen = false }: { scope: OfflineScope; autoSync: boolean; role: OfflineAccess["role"]; initialOpen?: boolean }) {
  const stableScope = useMemo(() => ({ userId: scope.userId, schoolId: scope.schoolId,
    schoolYearId: scope.schoolYearId }), [scope.userId, scope.schoolId, scope.schoolYearId]);
  const [open, setOpen] = useState(initialOpen);
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [operations, setOperations] = useState<OfflineOperation[]>([]);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState("");
  const [abandonId, setAbandonId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loadedScope, setLoadedScope] = useState("");
  const scopeKey = `${stableScope.userId}/${stableScope.schoolId}/${stableScope.schoolYearId}`;
  const loading = loadedScope !== scopeKey;
  const requestVersion = useRef(0);
  const lastReadableScope = useRef("");
  const invalidateRequests = useCallback(() => { requestVersion.current++; }, []);
  const action = useAsyncAction();
  const run = action.run;
  const refresh = useCallback(() => {
    const version = ++requestVersion.current;
    void inspectOfflineOperations(stableScope).then(({ operations: items, unreadableCount: unreadable }) => {
      if (version !== requestVersion.current) return;
      lastReadableScope.current = scopeKey;
      setOperations(items); setUnreadableCount(unreadable); setLoadedScope(scopeKey); setError("");
    }).catch(() => {
      if (version !== requestVersion.current) return;
      // A failed read must not reveal the previous account's cached list.
      if (lastReadableScope.current !== scopeKey) { setOperations([]); setUnreadableCount(0); }
      setLoadedScope(scopeKey); setError("Lecture du stockage local indisponible. Les opérations enregistrées restent conservées.");
    });
  }, [stableScope, scopeKey]);
  const sync = useCallback((automatic = false) => {
    // A manual retry may succeed even when navigator.onLine is stale.
    if (automatic && (!autoSync || navigator.onLine === false)) return;
    void run("sync", async () => {
      const before = await inspectOfflineOperations(stableScope);
      const result = await syncOfflineOperations(stableScope, refresh);
      const after = await inspectOfflineOperations(stableScope);
      if (result === "AUTH_REQUIRED") {
        setAuthRequired(true);
        setNotice("Votre session doit être rétablie pour synchroniser les opérations en attente. Aucune opération n'a été supprimée.");
        refresh();
        return;
      }
      setAuthRequired(false);
      const prior = before.operations;
      const current = after.operations;
      if (current.some((item) => item.status === "CONFLICT" || item.status === "REJECTED")) {
        setNotice("Des opérations nécessitent votre intervention.");
      } else if (current.some((item) => item.status === "SERVER_CONFIRMED" && prior.find((old) => old.id === item.id)?.status !== "SERVER_CONFIRMED")) {
        setNotice("Opérations synchronisées et confirmées par le serveur.");
      } else if (current.some((item) => item.status === "RETRYABLE_ERROR")) {
        setNotice("Connexion instable. Vos opérations sont conservées. La synchronisation reprendra automatiquement.");
      }
      refresh();
    }, "Synchronisation indisponible. Les brouillons restent conservés localement.");
  }, [autoSync, refresh, stableScope, run]);
  useEffect(() => {
    refresh();
    sync(true);
    const onOnline = () => { setOnline(true); setNotice("Connexion détectée. Vérification de la session et des services en cours."); refresh(); sync(true); };
    const onOffline = () => { setOnline(false); setNotice("Connexion interrompue. Les opérations compatibles restent locales."); refresh(); };
    const onFocus = () => { refresh(); sync(true); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    const unsubscribeAuth = auth ? onAuthStateChanged(auth, (user) => {
      if (user?.uid === stableScope.userId) { setAuthRequired(false); sync(true); }
    }) : undefined;
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("acadea:offline-operation-queued", onFocus);
    return () => {
      invalidateRequests();
      unsubscribeAuth?.();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("acadea:offline-operation-queued", onFocus);
    };
  }, [refresh, sync, invalidateRequests, stableScope.userId]);
  useEffect(() => {
    const retryable = operations.filter((item) => item.status === "RETRYABLE_ERROR");
    if (!autoSync || !online || authRequired || loading || !retryable.length) return;
    const timer = window.setTimeout(() => sync(true), offlineRetryDelay(Math.max(...retryable.map((item) => item.attempts))));
    return () => window.clearTimeout(timer);
  }, [autoSync, online, authRequired, loading, operations, sync]);
  const hasRetryable = !loading && operations.some((item) => item.status === "RETRYABLE_ERROR");
  const needsIntervention = (!loading && (operations.some((item) => item.status === "CONFLICT" || item.status === "REJECTED") || unreadableCount > 0 || authRequired)) || Boolean(error || action.error);
  useEffect(() => {
    if (!notice || needsIntervention || !online) return;
    const timer = window.setTimeout(() => setNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [notice, needsIntervention, online]);
  const outstanding = loading ? 0 : operations.filter((operation) => operation.status !== "SERVER_CONFIRMED").length + unreadableCount;
  const content = <div>
    {(notice || needsIntervention) && !open && <div role={needsIntervention ? "alert" : "status"} className="fixed left-3 right-3 top-4 z-[80] rounded border border-amber-200 bg-white p-3 text-sm text-ink shadow-lg sm:left-auto sm:right-4 sm:max-w-sm">
      <span>{needsIntervention ? error || action.error || `Des opérations nécessitent votre intervention (${outstanding}).` : notice}</span>
      {(needsIntervention || !online || hasRetryable || authRequired) && <button type="button" className="ml-2 font-semibold underline" onClick={() => { refresh(); setOpen(true); }}>Voir les opérations</button>}
    </div>}
    {open && <section className={initialOpen ? "w-full rounded-lg border border-slate-200 bg-white p-4 text-ink shadow-xl" : "fixed bottom-32 left-3 right-3 z-[80] max-h-[70vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-ink shadow-xl sm:bottom-4 sm:left-auto sm:right-4 sm:w-[min(90vw,26rem)]"}
      aria-label="État des opérations hors connexion">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Opérations locales</h2>{!initialOpen && <button type="button" className="text-sm underline" onClick={() => setOpen(false)}>Fermer</button>}</div>
      <p className="mt-1 text-xs text-slate-600">Seul un accusé serveur confirme une opération. Un paiement provisoire ne produit jamais de reçu local.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {action.error && <p role="alert" className="mt-2 text-sm text-red-700">{action.error}</p>}
      {authRequired && <p role="status" className="mt-2 text-sm text-amber-800">Votre session doit être rétablie pour synchroniser les opérations en attente. Aucune opération n'a été supprimée.</p>}
      {unreadableCount > 0 && <p role="alert" className="mt-2 text-sm text-red-700">{unreadableCount} opération(s) ancienne(s) ou illisible(s) sont conservées localement. Les autres opérations peuvent continuer ; contactez l'assistance avant toute manipulation du stockage.</p>}
      {loading && <p role="status">Lecture des opérations locales…</p>}
      {!loading && !error && !operations.length && unreadableCount === 0 && <p className="mt-3 text-sm">Aucune opération locale pour ce compte et cette année.</p>}
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
      {(autoSync || initialOpen) && operations.some((item) => ["LOCAL_PENDING", "SYNCING", "RETRYABLE_ERROR"].includes(item.status)) && <button type="button" className="primary-button mt-3 justify-center" disabled={action.isPending("sync")} onClick={() => sync()}>{action.isPending("sync") ? "Synchronisation…" : "Réessayer la synchronisation"}</button>}
      <OfflineDraftForms scope={stableScope} role={role} />
    </section>}
  </div>;
  return initialOpen ? content : createPortal(content, document.body);
}
