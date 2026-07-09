const CACHE_VERSION = "acadea-pwa-v5";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const BRAND_CACHE = `${CACHE_VERSION}-brand`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/logo-acadea.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(APP_SHELL).catch(() => undefined),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(() => caches.match("/") || caches.match("/index.html")),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/logo-acadea.svg";

  if (!isStaticAsset) return;

  event.respondWith(
    caches.open(BRAND_CACHE).then((brandCache) => brandCache.match(url.pathname)).then((branded) => {
      if (branded) return branded;
      return caches.match(request);
    }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
