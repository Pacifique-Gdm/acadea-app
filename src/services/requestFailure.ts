/** Classe une erreur réseau, API ou Firestore en motif compréhensible, sans
 * jamais exposer de détail technique (code, jeton, URL, message brut). */
export type FailureKind = "network" | "rate-limit" | "inactive-year" | "permission" | "unavailable" | "other";

const MESSAGES: Record<FailureKind, { retrying: string; final: string }> = {
  network: { retrying: "Connexion interrompue, nouvel essai en cours.", final: "Connexion interrompue. Vérifiez la connexion puis réessayez." },
  "rate-limit": { retrying: "Trop de demandes, nouvel essai dans un instant.", final: "Trop de demandes. Patientez une minute puis réessayez." },
  "inactive-year": { retrying: "Cette année scolaire n'est pas active.", final: "Cette année scolaire n'est pas active." },
  permission: { retrying: "Accès non autorisé pour ce compte.", final: "Accès non autorisé pour ce compte." },
  unavailable: { retrying: "Service momentanément indisponible, nouvel essai en cours.", final: "Service momentanément indisponible. Réessayez dans quelques minutes." },
  other: { retrying: "Opération impossible pour le moment, nouvel essai en cours.", final: "Opération impossible pour le moment. Réessayez." },
};

/** Délais des nouvelles tentatives automatiques : limités et espacés. */
export const RETRY_DELAYS_MS = Object.freeze([3_000, 10_000, 30_000]);

export function failureKind(error: unknown): FailureKind {
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown } : {};
  const status = typeof value.status === "number" ? value.status : 0;
  const code = typeof value.code === "string" ? value.code.toLowerCase().split("/").at(-1) ?? "" : "";
  const message = typeof value.message === "string" ? value.message : typeof error === "string" ? error : "";
  const text = message.toLowerCase();
  if (status === 429 || code === "resource-exhausted" || /trop de tentatives|quota exceeded/.test(text)) return "rate-limit";
  if (/ann[ée]e scolaire (active )?(inactive|invalide)|ann[ée]e scolaire inactive|n'est pas active/.test(text)) return "inactive-year";
  if (status === 403 || status === 401 || code === "permission-denied" || code === "unauthenticated"
    || /non autoris|hors p[ée]rim[èe]tre|compte utilisateur inactif|session invalide|session a expir/.test(text)) return "permission";
  if (code === "unavailable" || code === "network-request-failed"
    || /failed to fetch|networkerror|network request failed|network error|load failed|connexion indisponible|r[ée]ponse r[ée]seau perdue|err_internet_disconnected/.test(text)) return "network";
  if (status >= 500 || ["internal", "deadline-exceeded", "aborted", "unknown"].includes(code) || /temporairement indisponible|momentan[ée]ment indisponible/.test(text)) return "unavailable";
  return "other";
}

export function isRetryableFailure(kind: FailureKind) {
  return kind === "network" || kind === "rate-limit" || kind === "unavailable";
}

export function plainFailureMessage(kind: FailureKind, retrying: boolean) {
  return retrying ? MESSAGES[kind].retrying : MESSAGES[kind].final;
}

/** Délai de la tentative suivante, ou null quand les essais automatiques sont épuisés. */
export function nextRetryDelay(kind: FailureKind, attempt: number): number | null {
  if (!isRetryableFailure(kind)) return null;
  return RETRY_DELAYS_MS[attempt] ?? null;
}

/** Message français renvoyé par le serveur Acadéa, sans la partie diagnostic
 * ajoutée par le client de provisionnement. Vide pour une erreur interne du
 * navigateur (TypeError…) ou un texte qui ressemble à un détail technique. */
export function publicServerMessage(error: unknown) {
  if (!(error instanceof Error) || ["TypeError", "ReferenceError", "SyntaxError", "RangeError"].includes(error.name)) return "";
  const message = error.message.split(" Détail serveur :")[0].trim();
  if (!message || message.length > 220 || /https?:|\bundefined\b|\bnull\b|error:|exception|\bat [\w.]+ \(|[{}<>]|\b[A-Z_]{6,}\b/.test(message)) return "";
  return message;
}
