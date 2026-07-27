import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "firebase-functions";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { isOperationalNotification, resolveOperationalRecipients } from "./resolveOperationalRecipients.js";
import { sendOperationalToDevices } from "./sendOperationalToDevices.js";
import type { AnnouncementRecord, AttendanceRecord, DisciplineRecord, ParentRecord, PushTokenRecord, SchoolUserRecord, StudentRecord } from "./types.js";

function repository(database: Firestore) {
  async function document<T>(path: string) {
    const snapshot = await database.doc(path).get();
    return snapshot.exists ? ({ id: snapshot.id, ...snapshot.data() } as T) : null;
  }
  return {
    getAttendance: (id: string) => document<AttendanceRecord>(`attendance/${id}`),
    getDiscipline: (id: string) => document<DisciplineRecord>(`disciplineSanctions/${id}`),
    getAnnouncement: (id: string) => document<AnnouncementRecord>(`valves/${id}`),
    getStudent: (id: string) => document<StudentRecord>(`students/${id}`),
    getParent: (id: string) => document<ParentRecord>(`parents/${id}`),
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

export async function claimOperationalDispatch(database: Firestore, module: string, event: string, notificationId: string) {
  const reference = database.doc(`pushDispatches/${module}__${event}__${notificationId}`);
  const claimed = await database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const status = snapshot.data()?.status;
    if (snapshot.exists && (status === "processing" || status === "completed")) return false;
    transaction.set(reference, { module, event, notificationId, status: "processing", attemptCount: (snapshot.data()?.attemptCount ?? 0) + 1, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
  return claimed ? reference : null;
}

export async function handleOperationalNotification(notificationId: string, value: Record<string, unknown>, database: Firestore = getFirestore(), messaging: Messaging = getMessaging()) {
  if (!isOperationalNotification(value)) return { status: "ignored" as const };
  const notification = { id: notificationId, ...value };
  const dispatchData = await resolveOperationalRecipients(notification, repository(database));
  if (!dispatchData) return { status: "ignored" as const };
  const dispatch = await claimOperationalDispatch(database, dispatchData.module, dispatchData.event, notificationId);
  if (!dispatch) return { status: "duplicate" as const };
  try {
    const result = await sendOperationalToDevices(messaging, database, notification, dispatchData);
    await dispatch.set({ status: "completed", completedAt: new Date().toISOString(), ...result }, { merge: true });
    return { status: "completed" as const, ...result };
  } catch (error) {
    await dispatch.set({ status: "failed", failedAt: new Date().toISOString() }, { merge: true });
    logger.error("Échec du push opérationnel.", { notificationId, module: dispatchData.module, event: dispatchData.event, error });
    throw error;
  }
}

export const onOperationalNotificationCreated = onDocumentCreated("notifications/{notificationId}", async (event) => {
  if (event.data) await handleOperationalNotification(event.params.notificationId, event.data.data());
});
