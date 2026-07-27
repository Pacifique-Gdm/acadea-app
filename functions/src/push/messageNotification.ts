import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { isMessageNotification, resolveMessageRecipients } from "./resolveMessageRecipients.js";
import { sendMessageToDevices } from "./sendMessageToDevices.js";
import type { MessageRecord, ParentRecord, PushTokenRecord, SchoolUserRecord } from "./types.js";

function repository(database: Firestore) {
  return {
    async getMessage(messageId: string) {
      const snapshot = await database.doc(`messages/${messageId}`).get();
      return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as MessageRecord) : null;
    },
    async getParent(parentId: string) {
      const snapshot = await database.doc(`parents/${parentId}`).get();
      return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as ParentRecord) : null;
    },
    async getUser(userId: string) {
      const snapshot = await database.doc(`users/${userId}`).get();
      return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as SchoolUserRecord) : null;
    },
    async findParentUsers(parentId: string, schoolId: string) {
      const snapshot = await database.collection("users").where("role", "==", "parent").where("parentId", "==", parentId).where("schoolId", "==", schoolId).get();
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolUserRecord);
    },
    async findSchoolUsers(schoolId: string, roles: string[]) {
      const snapshot = await database.collection("users").where("schoolId", "==", schoolId).where("role", "in", roles).get();
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as SchoolUserRecord);
    },
    async listPushTokens(userId: string) {
      const snapshot = await database.collection(`users/${userId}/pushTokens`).where("active", "==", true).get();
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PushTokenRecord);
    },
  };
}

export async function claimMessageDispatch(database: Firestore, event: string, notificationId: string) {
  const reference = database.doc(`pushDispatches/${event}__${notificationId}`);
  const claimed = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const status = snapshot.data()?.status;
    if (snapshot.exists && (status === "processing" || status === "completed")) return false;
    transaction.set(reference, {
      event,
      notificationId,
      status: "processing",
      attemptCount: (snapshot.data()?.attemptCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  });
  return claimed ? reference : null;
}

export async function handleMessageNotification(
  notificationId: string,
  value: Record<string, unknown>,
  database: Firestore = getFirestore(),
  messaging: Messaging = getMessaging(),
) {
  if (!isMessageNotification(value)) return { status: "ignored" as const };
  const notification = { id: notificationId, ...value };
  const resolved = await resolveMessageRecipients(notification, repository(database));
  if (!resolved) return { status: "ignored" as const };
  const dispatch = await claimMessageDispatch(database, resolved.event, notificationId);
  if (!dispatch) return { status: "duplicate" as const };
  try {
    const result = await sendMessageToDevices(messaging, database, notification, resolved);
    await dispatch.set({ status: "completed", completedAt: new Date().toISOString(), ...result }, { merge: true });
    return { status: "completed" as const, event: resolved.event, ...result };
  } catch (error) {
    await dispatch.set({ status: "failed", failedAt: new Date().toISOString() }, { merge: true });
    logger.error("Échec du push de messagerie.", { notificationId, event: resolved.event, error });
    throw error;
  }
}

export const onMessageNotificationCreated = onDocumentCreated("notifications/{notificationId}", async (event) => {
  if (!event.data) return;
  await handleMessageNotification(event.params.notificationId, event.data.data());
});
