declare const __ACADEA_BUILD_ID__: string;
import { getServiceWorkerRegistration } from "../pwa";

/** Called only after a verified online school session has created its local ticket. */
export async function prepareOfflineShell(): Promise<void> {
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  const registration = await getServiceWorkerRegistration();
  const worker = registration?.active ?? (await navigator.serviceWorker.ready).active;
  if (!worker) throw new Error("Service worker Acadéa indisponible.");
  const channel = new MessageChannel();
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Préparation hors connexion expirée.")), 30_000);
    channel.port1.onmessage = (event: MessageEvent<{ ok?: boolean; version?: string; error?: string }>) => {
      window.clearTimeout(timeout);
      if (event.data?.ok && event.data.version === __ACADEA_BUILD_ID__) resolve();
      else reject(new Error(event.data?.error || "Préparation hors connexion impossible."));
      channel.port1.close();
    };
    worker.postMessage({ type: "PREPARE_OFFLINE_SHELL", version: __ACADEA_BUILD_ID__ }, [channel.port2]);
  });
}
