export const PWA_UPDATE_EVENT = "acadea:pwa-update";
const CURRENT_BUILD_ID = __ACADEA_BUILD_ID__;
const VERSION_CHECK_INTERVAL = 5 * 60 * 1000;
let serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

declare global {
  interface WindowEventMap {
    "acadea:pwa-update": CustomEvent<ServiceWorkerRegistration>;
  }
}

function notifyUpdateAvailable(registration: ServiceWorkerRegistration) {
  window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT, { detail: registration }));
}

function watchRegistration(registration: ServiceWorkerRegistration) {
  if (registration.waiting && navigator.serviceWorker.controller) {
    notifyUpdateAvailable(registration);
  }

  registration.addEventListener("updatefound", () => {
    const nextWorker = registration.installing;
    if (!nextWorker) return;

    nextWorker.addEventListener("statechange", () => {
      if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
        notifyUpdateAvailable(registration);
      }
    });
  });

  window.setInterval(() => {
    void registration.update();
  }, 60 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void registration.update();
      void checkForDeployedVersion(registration);
    }
  });

  window.setInterval(() => {
    void checkForDeployedVersion(registration);
  }, VERSION_CHECK_INTERVAL);

  void checkForDeployedVersion(registration);
}

async function checkForDeployedVersion(registration: ServiceWorkerRegistration) {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { version?: string };
    if (payload.version && payload.version !== CURRENT_BUILD_ID) {
      await registration.update();
      notifyUpdateAvailable(registration);
    }
  } catch (error) {
    console.debug("Vérification de version Acadéa indisponible.", error);
  }
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (import.meta.env.DEV) {
    window.addEventListener("load", () => {
      void clearDevelopmentPwaState();
    });
    return;
  }

  window.addEventListener("load", () => {
    serviceWorkerRegistrationPromise = navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        watchRegistration(registration);
        return registration;
      })
      .catch((error) => {
        console.warn("Service worker Acadéa indisponible.", error);
        return null;
      });
  });
}

export async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return null;
  if (serviceWorkerRegistrationPromise) return serviceWorkerRegistrationPromise;
  const existingRegistration = await navigator.serviceWorker.getRegistration("/");
  if (existingRegistration) return existingRegistration;
  serviceWorkerRegistrationPromise = navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Service worker Acadéa indisponible pour les notifications.", error);
    return null;
  });
  return serviceWorkerRegistrationPromise;
}

export function applyPwaUpdate(registration: ServiceWorkerRegistration) {
  const waitingWorker = registration.waiting;
  if (!waitingWorker) {
    void clearPwaCaches().finally(() => window.location.reload());
    return;
  }

  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

async function clearPwaCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("acadea-pwa-")).map((key) => caches.delete(key)));
}

async function clearDevelopmentPwaState() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    await clearPwaCaches();
  } catch (error) {
    console.warn("Nettoyage du Service Worker Acadéa en développement impossible.", error);
  }
}
