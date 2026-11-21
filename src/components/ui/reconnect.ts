/** Demande à l'application de renvoyer vers l'écran de connexion
 * (bouton « Se reconnecter » d'un message de session expirée). */
export const RECONNECT_EVENT = "acadea:reconnect";

export function requestReconnect() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RECONNECT_EVENT));
}
