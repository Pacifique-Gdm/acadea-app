import { deleteDoc, doc, getDoc, setDoc } from "@firebase/firestore";
import type { Firestore } from "@firebase/firestore";
import { app, auth, db, firebaseReady } from "../firebase";
import { getServiceWorkerRegistration } from "../pwa";
import type { AppUser } from "../types";
import { resolveMessagePushDestination, resolveOperationalPushDestination, resolvePaymentRecordedDestination } from "../utils/pushNotificationRoutes";

const DEVICE_ID_KEY = "acadea:push-device-id";
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
  const deviceId = globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, deviceId);
  return deviceId;
}

function tokenDocument(userId: string, deviceId: string) {
  if (!db) throw new Error("Firestore indisponible pour les notifications push.");
  return doc(db as unknown as Firestore, "users", userId, "pushTokens", deviceId);
}

function isAuthorizedParent(user: AppUser) {
  return user.role === "parent" && user.status !== "inactive" && Boolean(user.schoolId) && Boolean(user.parentId) && currentFirebaseUid() === user.id;
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

  stopForegroundListener?.();
  stopForegroundListener = messagingModule.onMessage(messaging, (payload) => {
    const data = payload.data as Record<string, unknown> | undefined;
    if (!data) return;
    const isMessage = data.module === "messages";
    const isPayment = data.module === "payments";
    const destination = isMessage ? resolveMessagePushDestination(user, data) : isPayment ? resolvePaymentRecordedDestination(user, data) : resolveOperationalPushDestination(user, data);
    if (!destination) return;
    const foregroundNotification = new Notification(payload.notification?.title || (isMessage ? "Nouveau message Acadéa" : "Paiement enregistré"), {
      body: payload.notification?.body || (isMessage ? "Un nouveau message est disponible dans Acadéa." : "Un nouveau paiement est disponible dans votre espace financier Acadéa."),
      icon: "/icons/icon-192.png",
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

export function restorePushNotifications(user: AppUser) {
  return registerPushNotifications(user, false);
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
