export function firebaseErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error) return String(error.code).replace(/^firestore\//, "");
  if (typeof error === "object" && error !== null && "name" in error && error.name === "QuotaExceededError") return "browser-storage-quota";
  return "unknown";
}

export function retryableRefreshError(error: unknown) {
  return ["unavailable", "deadline-exceeded", "network-request-failed"].includes(firebaseErrorCode(error));
}

export function refreshErrorMessage(error: unknown) {
  switch (firebaseErrorCode(error)) {
    case "permission-denied": return "Vous n'avez pas l'autorisation d'actualiser ces données pour l'établissement actif.";
    case "unauthenticated": return "Votre session a expiré. Veuillez vous reconnecter.";
    case "unavailable": return "Le service est temporairement indisponible. Vérifiez votre connexion puis réessayez.";
    case "failed-precondition": return "La requête nécessite une configuration supplémentaire. Contactez l'administrateur technique.";
    case "client-timeout": return "Le chargement des données prend plus de temps que prévu. Les données affichées sont conservées ; vérifiez leur mise à jour avant de réessayer.";
    case "deadline-exceeded": return "La connexion est lente. Les données déjà affichées sont conservées ; réessayez lorsque le réseau est stable.";
    case "network-request-failed": return "Connexion impossible. Les données affichées sont conservées.";
    case "resource-exhausted": return "Le service de données a atteint une limite de ressources. Les données affichées sont conservées mais leur actualisation n'est pas vérifiée.";
    case "browser-storage-quota": return "Le stockage de ce navigateur a atteint sa limite. Les données affichées sont conservées mais leur actualisation n'est pas vérifiée.";
    default: return "Impossible d'actualiser les données. Réessayez ou contactez l'assistance.";
  }
}

export function logRefreshError(params: { module: string; error: unknown }) {
  if (!import.meta.env.DEV && import.meta.env.VITE_APP_ENV !== "staging") return;
  const collectionPath = typeof params.error === "object" && params.error !== null && "collectionPath" in params.error ? String(params.error.collectionPath) : "unknown";
  console.error("[Acadéa refresh]", {
    module: params.module,
    action: "refresh",
    collectionPath,
    errorCode: firebaseErrorCode(params.error),
    timestamp: new Date().toISOString(),
  });
}
