import type { Firestore } from "firebase-admin/firestore";
import { loadPushContext, pushText } from "./pushTexts.js";
import type { Messaging } from "firebase-admin/messaging";
import { deactivateInvalidToken, isInvalidTokenError } from "./cleanupInvalidTokens.js";
import type { OperationalDispatch, OperationalNotificationRecord } from "./types.js";

/** Lot 25 : école, prénom de l'élève (sanction : élève lu sur la fiche, jamais le motif), titre de l'annonce. */
async function operationalText(database: Firestore, notification: OperationalNotificationRecord, event: OperationalDispatch["event"]) {
  let studentId = notification.studentId;
  if (!studentId && notification.disciplineSanctionId) studentId = (await database.doc(`disciplineSanctions/${notification.disciplineSanctionId}`).get()).data()?.studentId;
  const context = await loadPushContext(database, notification.schoolId, event === "announcement_published" ? undefined : studentId);
  const title = event === "announcement_published" && notification.announcementId ? (await database.doc(`valves/${notification.announcementId}`).get()).data()?.title : undefined;
  return pushText(event, context, { title });
}

export async function sendOperationalToDevices(messaging: Messaging, database: Firestore, notification: OperationalNotificationRecord, dispatch: OperationalDispatch) {
  let successCount = 0;
  let failureCount = 0;
  let retryableFailureCount = 0;
  const text = dispatch.recipients.some((item) => item.tokens.length) ? await operationalText(database, notification, dispatch.event) : null;
  for (const recipient of dispatch.recipients) {
    for (let offset = 0; offset < recipient.tokens.length; offset += 500) {
      const tokens = recipient.tokens.slice(offset, offset + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: tokens.map((token) => token.token as string),
        notification: text!,
        data: {
          module: dispatch.module,
          event: dispatch.event,
          destination: "/dashboard",
          notificationId: notification.id,
          schoolId: notification.schoolId,
          schoolYearId: notification.schoolYearId,
          ...(notification.parentId ? { parentId: notification.parentId } : {}),
          ...(notification.studentId ? { studentId: notification.studentId } : {}),
          ...(notification.attendanceId ? { attendanceId: notification.attendanceId } : {}),
          ...(notification.disciplineSanctionId ? { disciplineSanctionId: notification.disciplineSanctionId } : {}),
          ...(notification.announcementId ? { announcementId: notification.announcementId } : {}),
        },
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
      await Promise.all(response.responses.map((item, index) => {
        const token = tokens[index];
        if (!token || item.success) return Promise.resolve();
        if (isInvalidTokenError(item.error?.code)) return deactivateInvalidToken(database, recipient.userId, token.id);
        retryableFailureCount += 1;
        return Promise.resolve();
      }));
    }
  }
  if (retryableFailureCount > 0) throw new Error(`Échec FCM temporaire pour ${retryableFailureCount} appareil(s).`);
  return { successCount, failureCount };
}
