import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { isPaymentRecordedNotification, resolvePaymentRecipient } from "./resolvePaymentRecipient.js";
import { sendPaymentRecordedToDevices } from "./sendToUserDevices.js";
import type { ParentRecord, ParentUserRecord, PushTokenRecord, StudentRecord } from "./types.js";

function repository(database: Firestore) {
  return {
    async getParent(parentId: string) {
      const snapshot = await database.doc(`parents/${parentId}`).get();
      return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as ParentRecord) : null;
    },
    async getStudent(studentId: string) {
      const snapshot = await database.doc(`students/${studentId}`).get();
      return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as StudentRecord) : null;
    },
    async findParentUsers(parentId: string, schoolId: string) {
      const snapshot = await database.collection("users").where("role", "==", "parent").where("parentId", "==", parentId).where("schoolId", "==", schoolId).get();
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ParentUserRecord);
    },
    async listPushTokens(userId: string) {
      const snapshot = await database.collection(`users/${userId}/pushTokens`).where("active", "==", true).get();
      return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as PushTokenRecord);
    },
  };
}

async function claimDispatch(database: Firestore, notificationId: string) {
  const reference = database.doc(`pushDispatches/${notificationId}`);
  try {
    await reference.create({ event: "payment_recorded", status: "processing", createdAt: new Date().toISOString() });
    return reference;
  } catch (error) {
    if ((error as { code?: number | string }).code === 6 || (error as { code?: number | string }).code === "already-exists") return null;
    throw error;
  }
}

export async function handlePaymentRecorded(
  notificationId: string,
  value: Record<string, unknown>,
  database: Firestore = getFirestore(),
  messaging: Messaging = getMessaging(),
) {
  if (!isPaymentRecordedNotification(value)) return { status: "ignored" as const };
  const dispatch = await claimDispatch(database, notificationId);
  if (!dispatch) return { status: "duplicate" as const };
  try {
    const notification = { id: notificationId, ...value };
    const recipients = await resolvePaymentRecipient(notification, repository(database));
    const result = await sendPaymentRecordedToDevices(messaging, database, notification, recipients);
    await dispatch.set({ status: "completed", completedAt: new Date().toISOString(), ...result }, { merge: true });
    return { status: "completed" as const, ...result };
  } catch (error) {
    await dispatch.set({ status: "failed", failedAt: new Date().toISOString() }, { merge: true });
    logger.error("Échec du push payment_recorded.", { notificationId, error });
    throw error;
  }
}

export const onPaymentRecordedNotificationCreated = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;
  await handlePaymentRecorded(event.params.notificationId, snapshot.data());
});
