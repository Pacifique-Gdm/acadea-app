const CACHE_VERSION = "acadea-pwa-v6";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;
const BRAND_CACHE = `${CACHE_VERSION}-brand`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/acadea-icon.png",
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

function allowedPushData(payload) {
  const data = payload?.data;
  if (!data || data.destination !== "/dashboard") return null;
  if (data.module === "payments" && data.event === "payment_recorded" && data.notificationId && data.studentId) return data;
  if (
    data.module === "messages" &&
    (data.event === "school_message_received" || data.event === "parent_message_received") &&
    data.notificationId && data.messageId && data.schoolId && data.schoolYearId && data.parentId
  ) return data;
  if (data.module === "attendance" && (data.event === "student_absent" || data.event === "student_late") && data.notificationId && data.attendanceId && data.studentId && data.parentId) return data;
  if (data.module === "discipline" && data.event === "discipline_incident_created" && data.notificationId && data.disciplineSanctionId && data.studentId && data.parentId) return data;
  if (data.module === "announcements" && data.event === "announcement_published" && data.notificationId && data.announcementId) return data;
  return null;
}

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  const data = allowedPushData(payload);
  if (!data) return;
  const notification = payload.notification ?? {};
  const isMessage = data.module === "messages";
  event.waitUntil(
    self.registration.showNotification(notification.title || "Paiement enregistré", {
      body: notification.body || "Un paiement a été enregistré.",
      icon: "/icons/icon-192.png",
      badge: "/favicon.png",
      tag: isMessage ? `message-${data.notificationId}` : `payment-recorded-${data.notificationId || "unknown"}`,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = allowedPushData({ data: event.notification?.data });
  if (!data) return;
  event.notification.close();
  const destinationUrl = new URL("/dashboard", self.location.origin);
  if (data.module === "messages") {
    destinationUrl.searchParams.set("push", "message");
    destinationUrl.searchParams.set("messageId", data.messageId);
  } else if (data.module === "attendance") {
    destinationUrl.searchParams.set("push", "attendance");
    destinationUrl.searchParams.set("attendanceId", data.attendanceId);
  } else if (data.module === "discipline") {
    destinationUrl.searchParams.set("push", "discipline");
    destinationUrl.searchParams.set("disciplineSanctionId", data.disciplineSanctionId);
  } else if (data.module === "announcements") {
    destinationUrl.searchParams.set("push", "announcement");
    destinationUrl.searchParams.set("announcementId", data.announcementId);
  }
  const destination = destinationUrl.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existingClient = clients.find((client) => new URL(client.url).origin === self.location.origin);
      if (existingClient) {
        return existingClient.focus().then(() => existingClient.navigate(destination));
      }
      return self.clients.openWindow(destination);
    }),
  );
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
    url.pathname === "/acadea-icon.png";

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
