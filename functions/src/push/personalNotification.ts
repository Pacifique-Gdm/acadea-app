import type { Firestore } from "firebase-admin/firestore";
import { loadPushContext, messagePushText, pushText, type PushContext } from "./pushTexts.js";
import type { Messaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { deactivateInvalidToken, isInvalidTokenError } from "./cleanupInvalidTokens.js";

/** Lot 24 — push « personnels » : toute notification créée par le serveur pour UN
 * utilisateur précis (recipientUserId) : messages et réponses de tous les rôles
 * (envoi groupé : une notification, donc un push, par destinataire), correction ou
 * annulation de paiement, notes publiées. Les paiements enregistrés, absences,
 * sanctions et annonces restent envoyés par leurs fonctions existantes.
 * Les textes visibles sur l'écran verrouillé ne contiennent ni montant ni motif. */
// Quatre semaines : le téléphone reçoit la notification dès qu'il retrouve la connexion.
const TTL_SECONDS = 28 * 24 * 60 * 60;

export type PersonalEvent = "message_received" | "payment_corrected" | "payment_cancelled" | "grades_published" | "allocation_alert";
type NotificationValue = Record<string, unknown>;
type UserRecord = { id: string; role?: string; status?: string; active?: boolean; archivedAt?: unknown; schoolId?: string; coordinationId?: string };
type TokenRecord = { id: string; token?: string; userId?: string; active?: boolean };

export function personalEvent(value: NotificationValue): PersonalEvent | null {
  if (typeof value.recipientUserId !== "string" || !value.recipientUserId) return null;
  if (value.module === "discipline" || value.module === "attendance" || value.module === "announcements") return null;
  if (value.type === "message" && typeof value.messageId === "string" && value.messageId) return "message_received";
  if (value.type === "financial_correction" && value.event === "payment_corrected") return "payment_corrected";
  if (value.type === "financial_correction" && value.event === "payment_cancelled") return "payment_cancelled";
  if (value.type === "grade_publication") return "grades_published";
  // Lot 27a-bis : alerte de la répartition des frais (paiement en attente depuis plus d'une heure, écart de nuit).
  if (value.type === "allocation_alert") return "allocation_alert";
  return null;
}

/** Le destinataire doit être actif et dans la portée de la notification (séparation entre écoles). */
export function recipientAllowed(user: UserRecord | null, value: NotificationValue) {
  if (!user || user.status === "inactive" || user.status === "archived" || user.active === false || user.archivedAt) return false;
  if (value.platformMessage === true) return true;
  if (typeof value.schoolId === "string" && value.schoolId) {
    if (user.schoolId === value.schoolId) return true;
    return (user.role === "coordination_admin" || user.role === "sub_coordination_admin") && typeof value.coordinationId === "string" && value.coordinationId === user.coordinationId;
  }
  return false;
}

/** Lot 25 : textes communs (pushTexts.ts) — école et prénom, ni montant ni motif. */
export function personalText(event: PersonalEvent, message?: { senderName?: unknown; senderRole?: unknown; subject?: unknown } | null, context: PushContext = {}) {
  if (event === "message_received") return messagePushText(message);
  // Sans montant sur l'écran verrouillé : le détail est dans la notification ouverte dans Acadéa.
  if (event === "allocation_alert") return { title: "Acadéa — Répartition des frais", body: "Une alerte de répartition demande votre attention. Ouvrez Acadéa pour le détail." };
  return pushText(event, context);
}

export async function handlePersonalNotification(notificationId: string, value: NotificationValue, database: Firestore = getFirestore(), messaging: Messaging = getMessaging()) {
  const event = personalEvent(value);
  if (!event) return { status: "ignored" as const };
  const userId = value.recipientUserId as string;
  const userSnapshot = await database.doc(`users/${userId}`).get();
  const user = userSnapshot.exists ? ({ id: userSnapshot.id, ...userSnapshot.data() } as UserRecord) : null;
  if (!recipientAllowed(user, value)) {
    // Compte désactivé ou archivé : ses jetons sont retirés, plus aucune notification.
    if (user && (user.status === "inactive" || user.status === "archived" || user.active === false || user.archivedAt)) {
      const stale = await database.collection(`users/${userId}/pushTokens`).get();
      await Promise.all(stale.docs.map((item) => item.ref.delete()));
    }
    return { status: "ignored" as const };
  }
  // Un seul envoi par notification, même si la fonction est relancée.
  const dispatchRef = database.doc(`pushDispatches/personal__${notificationId}`);
  const claimed = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(dispatchRef);
    if (snapshot.exists && ["processing", "completed"].includes(snapshot.data()?.status)) return false;
    transaction.set(dispatchRef, { event, notificationId, status: "processing", updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!claimed) return { status: "duplicate" as const };
  try {
    const tokenSnapshot = await database.collection(`users/${userId}/pushTokens`).where("active", "==", true).get();
    const seen = new Set<string>();
    const tokens = tokenSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as TokenRecord)
      .filter((item) => item.userId === userId && typeof item.token === "string" && item.token && !seen.has(item.token) && Boolean(seen.add(item.token)));
    if (!tokens.length) {
      await dispatchRef.set({ status: "completed", successCount: 0, failureCount: 0, completedAt: new Date().toISOString() }, { merge: true });
      return { status: "completed" as const, successCount: 0, failureCount: 0 };
    }
    const message = event === "message_received" ? (await database.doc(`messages/${value.messageId as string}`).get()).data() : undefined;
    const context = event === "message_received" ? {} : await loadPushContext(database, value.schoolId, value.studentId);
    const text = personalText(event, message, context);
    const unread = (await database.collection("notifications").where("recipientUserId", "==", userId).where("read", "==", false).count().get()).data().count;
    let successCount = 0, failureCount = 0;
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map((item) => item.token as string),
        notification: text,
        data: {
          module: "personal", event, destination: "/dashboard", notificationId, badge: String(unread),
          ...(typeof value.messageId === "string" ? { messageId: value.messageId } : {}),
        },
        webpush: { headers: { TTL: String(TTL_SECONDS), Urgency: "high" } },
      });
      successCount += response.successCount; failureCount += response.failureCount;
      await Promise.all(response.responses.map((item, index) => (!item.success && (isInvalidTokenError(item.error?.code) || item.error?.code === "messaging/invalid-argument") && batch[index]) ? deactivateInvalidToken(database, userId, batch[index]!.id) : Promise.resolve()));
    }
    await dispatchRef.set({ status: "completed", successCount, failureCount, completedAt: new Date().toISOString() }, { merge: true });
    return { status: "completed" as const, successCount, failureCount };
  } catch (error) {
    await dispatchRef.set({ status: "failed", failedAt: new Date().toISOString() }, { merge: true });
    logger.error("Échec du push personnel.", { notificationId, event, error });
    throw error;
  }
}

export const onPersonalNotificationCreated = onDocumentCreated({ document: "notifications/{notificationId}", region: "europe-west1" }, async (event) => {
  if (!event.data) return;
  await handlePersonalNotification(event.params.notificationId, event.data.data());
});
