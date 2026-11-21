import { useCallback, useState } from "react";
import { requestReconnect } from "./reconnect";
import { classifyError, ERROR_MESSAGES, isRetryableBusinessText, userFacingError } from "../../utils/userFacingError";

type ErrorNoticeProps = {
  /** Erreur brute (Error, objet Firebase) ou texte déjà préparé. */
  error: unknown;
  /** Relance réelle de l'opération. Absent : pas de bouton « Réessayer ». */
  onRetry?: () => void;
  /** Texte de secours quand l'erreur n'a aucun texte. */
  fallback?: string;
  className?: string;
};

/** Composant d'erreur commun : message clair en français et bouton d'action.
 * Un texte technique n'est jamais affiché tel quel. */
export function ErrorNotice({ error, onRetry, fallback = "", className = "" }: ErrorNoticeProps) {
  // Sans relance fournie, une erreur affichée dans un formulaire relance ce
  // formulaire (même chemin qu'un clic sur son bouton d'envoi, sur demande seulement).
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => { if (node) setForm(node.closest("form")); }, []);
  if (error === undefined || error === null || error === "" || error === false) return null;
  const message = userFacingError(error, fallback || ERROR_MESSAGES.other);
  const kind = classifyError(message);
  const retry = onRetry ?? (form ? () => form.requestSubmit() : undefined);
  // Relance fournie par l'écran : toujours proposée (sauf session expirée ou refus d'autorisation).
  // Relance « formulaire » implicite : seulement pour un échec qui vaut la peine d'être renvoyé.
  const showRetry = kind !== "session" && kind !== "permission" && (Boolean(onRetry)
    || (Boolean(retry) && (kind !== "business" || isRetryableBusinessText(message))));
  return <div ref={attach} role="alert" aria-live="assertive" data-error-kind={kind} className={`flex flex-wrap items-center gap-2 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700 ${className}`.trim()}>
    <p className="min-w-0 flex-1 font-semibold">{message}</p>
    {showRetry && <button type="button" className="secondary-button shrink-0 justify-center" onClick={retry}>Réessayer</button>}
    {kind === "session" && <button type="button" className="secondary-button shrink-0 justify-center" onClick={requestReconnect}>Se reconnecter</button>}
  </div>;
}
