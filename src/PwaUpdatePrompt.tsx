import { useEffect, useState } from "react";
import { applyPwaUpdate, PWA_UPDATE_EVENT } from "./pwa";

export default function PwaUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    function handleUpdate(event: WindowEventMap[typeof PWA_UPDATE_EVENT]) {
      setRegistration(event.detail);
    }

    window.addEventListener(PWA_UPDATE_EVENT, handleUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, handleUpdate);
  }, []);

  if (!registration) return null;

  return (
    <div className="fixed inset-x-3 bottom-4 z-[90] mx-auto max-w-xl rounded border border-blue-100 bg-white p-4 shadow-2xl sm:bottom-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-ink">
          Une nouvelle version d'Acadéa est disponible. Voulez-vous mettre à jour maintenant ?
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={() => setRegistration(null)} className="secondary-button justify-center">
            Plus tard
          </button>
          <button type="button" onClick={() => applyPwaUpdate(registration)} className="primary-button justify-center">
            Mettre à jour
          </button>
        </div>
      </div>
    </div>
  );
}
