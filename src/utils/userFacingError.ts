const NETWORK_MESSAGE = "Connexion Internet indisponible. Impossible de communiquer avec Acadéa pour le moment. Vérifiez votre connexion Internet, puis réessayez.";

export function userFacingError(error: unknown, fallback: string): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  const detail = `${code} ${message}`.toLowerCase();
  if (/network-request-failed|failed to fetch|networkerror|err_network|err_internet_disconnected|fetch failed|\bunavailable\b/.test(detail)) return NETWORK_MESSAGE;
  if (/permission-denied|403|forbidden/.test(detail)) return "Vous n'avez pas l'autorisation d'effectuer cette opération.";
  if (/unauthenticated|auth\/user-token-expired|auth\/id-token-expired|session expir/.test(detail)) return "Votre session a expiré. Veuillez vous reconnecter.";
  if (/deadline-exceeded|timeout|timed out/.test(detail)) return "Le service met trop de temps à répondre. Réessayez.";
  if (/^firebase: error|firebaseerror|auth\/|firestore\/|storage\//.test(detail)) return fallback;
  return message || fallback;
}
