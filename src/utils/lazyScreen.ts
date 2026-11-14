/** Chargement à la demande d'un écran (lot 12). Après une mise à jour de
 * l'application, un ancien morceau de code peut avoir disparu du serveur :
 * la page est alors rechargée une seule fois pour obtenir la nouvelle version. */
const RELOAD_FLAG = "acadea-chunk-reload";

export function loadScreen<T>(loader: () => Promise<T>, reload: () => void = () => window.location.reload()): () => Promise<T> {
  return async () => {
    try {
      const module = await loader();
      try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* stockage facultatif */ }
      return module;
    } catch (error) {
      let alreadyReloaded = false;
      try { alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === "1"; sessionStorage.setItem(RELOAD_FLAG, "1"); } catch { alreadyReloaded = true; }
      if (!alreadyReloaded && typeof navigator !== "undefined" && navigator.onLine !== false) reload();
      throw error;
    }
  };
}
