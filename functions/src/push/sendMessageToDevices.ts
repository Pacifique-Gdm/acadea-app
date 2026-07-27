import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { deactivateInvalidToken, isInvalidTokenError } from "./cleanupInvalidTokens.js";
import type { MessageNotificationRecord, ResolvedMessageDispatch } from "./types.js";

export async function sendMessageToDevices(
  messaging: Messaging,
  database: Firestore,
  notification: MessageNotificationRecord,
  dispatch: ResolvedMessageDispatch,
) {
  const schoolToParent = dispatch.event === "school_message_received";
  let successCount = 0;
  let failureCount = 0;
  let retryableFailureCount = 0;
  for (const recipient of dispatch.recipients) {
    for (let offset = 0; offset < recipient.tokens.length; offset += 500) {
      const tokenRecords = recipient.tokens.slice(offset, offset + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: tokenRecords.map((item) => item.token as string),
        notification: {
          title: schoolToParent ? "Nouveau message Acadéa" : "Nouveau message parent",
          body: schoolToParent
            ? "Un nouveau message de votre école est disponible."
            : "Un nouveau message est disponible dans la messagerie Acadéa.",
        },
        data: {
          module: "messages",
          event: dispatch.event,
          destination: "/dashboard",
          notificationId: notification.id,
          messageId: notification.messageId,
          schoolId: notification.schoolId,
          schoolYearId: notification.schoolYearId,
          parentId: dispatch.parentId,
          ...(dispatch.schoolRecipient ? { schoolRecipient: dispatch.schoolRecipient } : {}),
        },
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
      await Promise.all(response.responses.map((item, index) => {
        const token = tokenRecords[index];
        if (!token || item.success) return Promise.resolve();
        if (isInvalidTokenError(item.error?.code)) return deactivateInvalidToken(database, recipient.userId, token.id);
        retryableFailureCount += 1;
        return Promise.resolve();
      }));
    }
  }
  if (retryableFailureCount > 0) {
    throw new Error(`Échec FCM temporaire pour ${retryableFailureCount} appareil(s).`);
  }
  return { successCount, failureCount };
}
