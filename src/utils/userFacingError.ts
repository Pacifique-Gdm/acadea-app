/** Classement unique des erreurs affichées à l'écran.
 *
 * Règle : un message clair déjà écrit en français par Acadéa (règle métier)
 * reste affiché tel quel. Tout texte technique (Firebase, fetch, codes,
 * anglais…) est remplacé par l'un des cinq messages ci-dessous. */
export type ErrorKind = "network" | "timeout" | "session" | "permission" | "other" | "business";

export const ERROR_MESSAGES = Object.freeze({
  network: "Connexion Internet instable ou indisponible. Vérifiez votre connexion, puis réessayez.",
  timeout: "Le service met plus de temps que prévu à répondre. Veuillez réessayer dans un instant.",
  session: "Votre session a expiré. Veuillez vous reconnecter pour continuer.",
  permission: "Vous n'avez pas l'autorisation d'effectuer cette opération. Contactez votre administrateur si nécessaire.",
  other: "Une erreur est survenue. Veuillez réessayer. Si le problème persiste, contactez l'assistance Acadéa.",
} satisfies Record<Exclude<ErrorKind, "business">, string>);

const NETWORK = /network-request-failed|failed to fetch|networkerror|network error|network request failed|load failed|fetch failed|err_network|err_internet_disconnected|err_connection|client is offline|\boffline\b|\bunavailable\b|connexion indisponible|r[ée]ponse r[ée]seau perdue/;
const TIMEOUT = /deadline-exceeded|timeout|timed out|time out|trop long|aborterror/;
const SESSION = /unauthenticated|user-token-expired|id-token-expired|requires-recent-login|invalid-user-token|user-disabled|token-expired|session a expir|session invalide|\b401\b/;
const PERMISSION = /permission-denied|missing or insufficient permissions|insufficient permission|\b403\b|forbidden|unauthorized/;

/** Codes techniques connus (Firebase, Firestore, Auth, Storage, navigateur). */
const TECHNICAL_CODES = /\b(?:[a-z]+\/)?(?:permission-denied|network-request-failed|deadline-exceeded|resource-exhausted|failed-precondition|not-found|already-exists|invalid-argument|unauthenticated|unavailable|internal-error|out-of-range|unimplemented|data-loss|user-token-expired|id-token-expired|too-many-requests|quota-exceeded|requires-recent-login|popup-closed-by-user|user-not-found|wrong-password|invalid-credential|invalid-email|email-already-in-use|weak-password|object-not-found|retry-limit-exceeded|unauthorized|canceled|cancelled)\b/;
/** Texte technique ou en anglais : jamais affiché tel quel. */
const TECHNICAL = /firebase|firestore|\bauth\/|\bstorage\/|\bfunctions\/|failed to fetch|load failed|networkerror|typeerror|referenceerror|syntaxerror|\bundefined\b|\bnull\b|\bnan\b|https?:\/\/|\bat [\w.]+ \(|[{}]|\b(?:the|is|was|are|not|of|to|for|with|failed|error|missing|insufficient|request|unexpected|cannot|could|invalid|function|object|property|reading|internal|unknown|denied|offline|network|timeout|server|exceeded|permissions?)\b/i;

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "";
}

function errorText(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    return typeof message === "string" ? message : "";
  }
  return "";
}

const CANONICAL = new Map(Object.entries(ERROR_MESSAGES).map(([kind, text]) => [text, kind as ErrorKind]));

/** Vrai quand le texte contient un détail technique ou de l'anglais. */
export function isTechnicalText(text: string) {
  const value = text.trim();
  if (!value || CANONICAL.has(value)) return false;
  return TECHNICAL_CODES.test(value.toLowerCase()) || TECHNICAL.test(value);
}

/** Classe une erreur (objet, Error ou texte déjà affiché). */
export function classifyError(error: unknown): ErrorKind {
  const text = errorText(error).trim();
  const canonical = CANONICAL.get(text);
  if (canonical) return canonical;
  // Un message clair déjà rédigé par Acadéa reste affiché tel quel.
  if (text && !isTechnicalText(text)) return "business";
  const code = errorCode(error).toLowerCase();
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) || "" : "";
  const name = error instanceof Error ? error.name : "";
  const detail = `${code} ${name} ${text} ${status}`.toLowerCase();
  if (NETWORK.test(detail)) return "network";
  if (TIMEOUT.test(detail)) return "timeout";
  if (SESSION.test(detail)) return "session";
  if (PERMISSION.test(detail)) return "permission";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  return "other";
}

/** Texte à afficher : message métier gardé, sinon l'un des cinq messages
 * communs. `fallback` sert seulement quand l'erreur n'a ni texte ni code. */
export function userFacingError(error: unknown, fallback: string): string {
  const text = errorText(error).trim();
  if (!text && !errorCode(error)) return fallback;
  const kind = classifyError(error);
  return kind === "business" ? text : ERROR_MESSAGES[kind];
}

/** Message métier qui invite à recommencer : le bouton « Réessayer » a un sens. */
export function isRetryableBusinessText(text: string) {
  return /r[ée]essay|connexion|indisponible|interrompu|nouvel essai|pour le moment|impossible de charger|chargement|actualis/i.test(text);
}
