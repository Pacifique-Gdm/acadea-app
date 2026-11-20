import { deleteDoc, doc, getDoc, setDoc } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { app, auth, db, firebaseReady } from "../firebase";
import { getServiceWorkerRegistration } from "../pwa";
import type { AppUser } from "../types";
import { resolveApiUrl } from "../config/apiUrl";
import { resolveMessagePushDestination, resolveOperationalPushDestination, resolvePaymentRecordedDestination } from "../utils/pushNotificationRoutes";

const DEVICE_ID_KEY = "acadea:push-device-id";
/** P4, lot 4 : retrait du jeton d'un compte resté en attente (sans réseau), à refaire à sa prochaine connexion. */
export const PENDING_PUSH_REMOVAL_PREFIX = "acadea:push-a-retirer:";
export const PAYMENT_PUSH_EVENT = "acadea:payment-recorded-push";
export const MESSAGE_PUSH_EVENT = "acadea:message-push";
export const OPERATIONAL_PUSH_EVENT = "acadea:operational-push";
let stopForegroundListener: (() => void) | null = null;
let pushNotificationOperation:
  | { kind: "enable"; promise: Promise<PushEnableResult> }
  | { kind: "disable"; promise: Promise<PushDisableResult> }
  | null = null;

type PushEnableResult =
  | { status: "enabled"; deviceId: string }
  | { status: "unsupported" | "not-configured" | "not-authorized" | "permission-denied" | "operation-in-progress" };

type PushDisableResult =
  | { status: "disabled"; deviceId: string }
  | { status: "no-device" | "not-authorized" | "operation-in-progress" };

export type PushNotificationStatus =
  | "unsupported"
  | "not_configured"
  | "available"
  | "blocked"
  | "enabled"
  | "unauthorized";

function currentFirebaseUid() {
  return (auth as unknown as { currentUser?: { uid?: string } } | undefined)?.currentUser?.uid;
}

function getOrCreateDeviceId() {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const deviceId = globalThis.crypto.randomUUID();
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function tokenDocument(userId: string, deviceId: string) {
  if (!db) throw new Error("Firestore indisponible pour les notifications push.");
  return doc(db as unknown as Firestore, "users", userId, "pushTokens", deviceId);
}

/** Lot 24 : tous les rôles actifs peuvent recevoir des notifications sur leurs appareils. */
function isAuthorizedParent(user: AppUser) {
  return user.status !== "inactive" && (user as { active?: boolean }).active !== false && currentFirebaseUid() === user.id
    && (user.role !== "parent" || (Boolean(user.schoolId) && Boolean(user.parentId)));
}

function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* stockage indisponible : la suppression côté serveur reste la protection principale */ }
}

async function forgetLocalMessagingToken() {
  if (!app) return;
  const messagingModule = await import("firebase/messaging");
  if (await messagingModule.isSupported().catch(() => false)) await messagingModule.deleteToken(messagingModule.getMessaging(app)).catch(() => false);
}

/**
 * Retire le jeton de CET appareil (déconnexion) : plus aucune notification n'y arrivera.
 * P4, lot 4 : le jeton du navigateur est invalidé EN MÊME TEMPS (sans attendre Firestore, qui ne répond pas
 * sans réseau), et un retrait non abouti est noté pour être refait à la prochaine connexion de ce compte.
 */
export async function forgetDevicePushToken(userId: string) {
  if (!db || !userId || typeof window === "undefined") return;
  const deviceId = readStorage(DEVICE_ID_KEY);
  if (!deviceId) return;
  stopPushForegroundListener();
  writeStorage(PENDING_PUSH_REMOVAL_PREFIX + userId, deviceId);
  const localToken = forgetLocalMessagingToken().catch(() => undefined);
  await deleteDoc(tokenDocument(userId, deviceId)).then(() => writeStorage(PENDING_PUSH_REMOVAL_PREFIX + userId, null), () => undefined);
  await localToken;
}

/** P4, lot 4 : refait, pour le compte connecté, un retrait de jeton resté en attente lors d'une déconnexion sans réseau. */
export async function flushPendingPushTokenRemoval(userId: string) {
  if (!db || !userId || typeof window === "undefined" || currentFirebaseUid() !== userId) return false;
  const deviceId = readStorage(PENDING_PUSH_REMOVAL_PREFIX + userId);
  if (!deviceId) return false;
  await deleteDoc(tokenDocument(userId, deviceId));
  writeStorage(PENDING_PUSH_REMOVAL_PREFIX + userId, null);
  return true;
}

/**
 * P4, lot 4 : annonce au serveur que ce navigateur appartient désormais à ce compte. Le serveur supprime chez
 * l'ANCIEN compte le document qui porte exactement ce jeton. Un échec ne bloque pas l'activation.
 */
async function reportPushDeviceOwner(deviceId: string, token: string) {
  const currentUser = (auth as unknown as { currentUser?: { getIdToken?: () => Promise<string> } } | undefined)?.currentUser;
  if (!currentUser?.getIdToken || typeof fetch !== "function") return;
  const idToken = await currentUser.getIdToken();
  const response = await fetch(resolveApiUrl("/api/message-recipients"), {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register-push-device", deviceId, token }),
  });
  if (!response.ok) throw new Error("Enregistrement de l'appareil de notifications refusé.");
}

export async function getPushNotificationStatus(user: AppUser): Promise<PushNotificationStatus> {
  if (!isAuthorizedParent(user)) return "unauthorized";
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
  if (!firebaseReady || !app || !db || !vapidKey) return "not_configured";
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";

  const messagingModule = await import("firebase/messaging");
  if (!(await messagingModule.isSupported())) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "available";

  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return "available";
  const registration = await getServiceWorkerRegistration();
  if (!registration) return "unsupported";

  const tokenSnapshot = await getDoc(tokenDocument(user.id, deviceId));
  const storedToken = tokenSnapshot.data()?.token;
  if (!tokenSnapshot.exists() || tokenSnapshot.data()?.active !== true || typeof storedToken !== "string" || !storedToken) return "available";

  const currentToken = await messagingModule.getToken(messagingModule.getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  return currentToken && currentToken === storedToken ? "enabled" : "available";
}

async function registerPushNotifications(user: AppUser, requestPermission: boolean): Promise<PushEnableResult> {
  if (!isAuthorizedParent(user)) {
    return { status: "not-authorized" };
  }
  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim();
  if (!firebaseReady || !app || !db || !vapidKey) return { status: "not-configured" };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return { status: "unsupported" };

  const messagingModule = await import("firebase/messaging");
  if (!(await messagingModule.isSupported())) return { status: "unsupported" };

  const permission = requestPermission ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return { status: "permission-denied" };

  const serviceWorkerRegistration = await getServiceWorkerRegistration();
  if (!serviceWorkerRegistration) return { status: "unsupported" };

  const messaging = messagingModule.getMessaging(app);
  const token = await messagingModule.getToken(messaging, { vapidKey, serviceWorkerRegistration });
  if (!token) return { status: "not-configured" };

  const deviceId = getOrCreateDeviceId();
  const now = new Date().toISOString();
  await setDoc(
    tokenDocument(user.id, deviceId),
    {
      userId: user.id,
      deviceId,
      token,
      platform: "web",
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  );
  // P4, lot 4 : le document de ce compte vient d'être réécrit pour cet appareil ; un retrait en attente n'a plus d'objet.
  writeStorage(PENDING_PUSH_REMOVAL_PREFIX + user.id, null);
  await reportPushDeviceOwner(deviceId, token).catch((error) => {
    console.warn("Notifications : l'ancien compte de cet appareil n'a pas pu être détaché.", error);
  });

  stopForegroundListener?.();
  stopForegroundListener = messagingModule.onMessage(messaging, (payload) => {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;
    const isPersonal = data.module === "personal";
    const isMessage = data.module === "messages" || (isPersonal && data.event === "message_received");
    const isPayment = data.module === "payments";
    const destination = isPersonal ? `/dashboard?push=${data.event === "message_received" ? `message&messageId=${encodeURIComponent(String(data.messageId ?? ""))}` : data.event === "grades_published" ? "grades" : "payment"}`
      : isMessage ? resolveMessagePushDestination(user, data) : isPayment ? resolvePaymentRecordedDestination(user, data) : resolveOperationalPushDestination(user, data);
    if (!destination) return;
    const foregroundNotification = new Notification(payload.notification?.title || (isMessage ? "Nouveau message Acadéa" : "Paiement enregistré"), {
      body: payload.notification?.body || (isMessage ? "Un nouveau message est disponible dans Acadéa." : "Un nouveau paiement est disponible dans votre espace financier Acadéa."),
      icon: "/icons/icon-192.png",
      badge: "/icons/notification-badge.png",
      tag: isMessage ? `message-${data.notificationId}` : `payment-recorded-${data.notificationId}`,
    });
    foregroundNotification.onclick = () => {
      window.focus();
      window.location.assign(destination);
      foregroundNotification.close();
    };
    window.dispatchEvent(new CustomEvent(isMessage ? MESSAGE_PUSH_EVENT : isPayment ? PAYMENT_PUSH_EVENT : OPERATIONAL_PUSH_EVENT, { detail: { ...data, title: payload.notification?.title, body: payload.notification?.body } }));
  });

  return { status: "enabled", deviceId };
}

export function enablePushNotifications(user: AppUser): Promise<PushEnableResult> {
  if (pushNotificationOperation?.kind === "enable") return pushNotificationOperation.promise;
  if (pushNotificationOperation) return Promise.resolve({ status: "operation-in-progress" });
  const promise = registerPushNotifications(user, true).finally(() => {
    pushNotificationOperation = null;
  });
  pushNotificationOperation = { kind: "enable", promise };
  return promise;
}

export async function restorePushNotifications(user: AppUser) {
  const result = await registerPushNotifications(user, false);
  // P4, lot 4 : pas de réinscription (permission retirée, navigateur incompatible…) : on refait le retrait en attente.
  if (result.status !== "enabled") await flushPendingPushTokenRemoval(user.id).catch(() => false);
  return result;
}

export function stopPushForegroundListener() {
  stopForegroundListener?.();
  stopForegroundListener = null;
}

async function unregisterPushNotifications(user: AppUser): Promise<PushDisableResult> {
  if (!isAuthorizedParent(user) || !db) return { status: "not-authorized" };
  const deviceId = window.localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) return { status: "no-device" };
  stopPushForegroundListener();
  await deleteDoc(tokenDocument(user.id, deviceId));

  if (app) {
    const messagingModule = await import("firebase/messaging");
    if (await messagingModule.isSupported()) {
      await messagingModule.deleteToken(messagingModule.getMessaging(app)).catch(() => false);
    }
  }
  return { status: "disabled", deviceId };
}

export function disablePushNotifications(user: AppUser): Promise<PushDisableResult> {
  if (pushNotificationOperation?.kind === "disable") return pushNotificationOperation.promise;
  if (pushNotificationOperation) return Promise.resolve({ status: "operation-in-progress" });
  const promise = unregisterPushNotifications(user).finally(() => {
    pushNotificationOperation = null;
  });
  pushNotificationOperation = { kind: "disable", promise };
  return promise;
}

// Aliases temporaires pour les consommateurs existants pendant la généralisation du service.
export type PaymentPushNotificationStatus = PushNotificationStatus;
export const getPaymentPushNotificationStatus = getPushNotificationStatus;
export const enablePaymentPushNotifications = enablePushNotifications;
export const restorePaymentPushNotifications = restorePushNotifications;
export const stopPaymentPushForegroundListener = stopPushForegroundListener;
export const disablePaymentPushNotifications = disablePushNotifications;
