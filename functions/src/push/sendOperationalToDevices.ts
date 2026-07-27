import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { deactivateInvalidToken, isInvalidTokenError } from "./cleanupInvalidTokens.js";
import type { OperationalDispatch, OperationalNotificationRecord } from "./types.js";

const content = {
  student_absent: { title: "Absence signalée", body: "Une absence concernant votre enfant a été enregistrée." },
  student_late: { title: "Retard signalé", body: "Un retard concernant votre enfant a été enregistré." },
  discipline_incident_created: { title: "Nouvelle information disciplinaire", body: "Une nouvelle information concernant le suivi disciplinaire de votre enfant est disponible." },
  announcement_published: { title: "Nouvelle annonce Acadéa", body: "Une nouvelle annonce est disponible dans Acadéa." },
} as const;

export async function sendOperationalToDevices(messaging: Messaging, database: Firestore, notification: OperationalNotificationRecord, dispatch: OperationalDispatch) {
  let successCount = 0;
  let failureCount = 0;
  let retryableFailureCount = 0;
  for (const recipient of dispatch.recipients) {
    for (let offset = 0; offset < recipient.tokens.length; offset += 500) {
      const tokens = recipient.tokens.slice(offset, offset + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: tokens.map((token) => token.token as string),
        notification: content[dispatch.event],
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
