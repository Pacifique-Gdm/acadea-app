import type { Firestore } from "firebase-admin/firestore";
import type { Messaging } from "firebase-admin/messaging";
import { deactivateInvalidToken, isInvalidTokenError } from "./cleanupInvalidTokens.js";
import type { PaymentRecordedNotification, ResolvedPaymentRecipient } from "./types.js";

export async function sendPaymentRecordedToDevices(
  messaging: Messaging,
  database: Firestore,
  notification: PaymentRecordedNotification,
  recipients: ResolvedPaymentRecipient[],
) {
  let successCount = 0;
  let failureCount = 0;
  for (const recipient of recipients) {
    for (let offset = 0; offset < recipient.tokens.length; offset += 500) {
      const tokenRecords = recipient.tokens.slice(offset, offset + 500);
      const response = await messaging.sendEachForMulticast({
        tokens: tokenRecords.map((item) => item.token as string),
        notification: {
          title: "Paiement enregistré",
          body: "Un nouveau paiement est disponible dans votre espace financier Acadéa.",
        },
        data: {
          module: "payments",
          event: "payment_recorded",
          destination: "/dashboard",
          notificationId: notification.id,
          schoolId: notification.schoolId,
          schoolYearId: notification.schoolYearId,
          parentId: notification.parentId,
          studentId: notification.studentId,
        },
      });
      successCount += response.successCount;
      failureCount += response.failureCount;
      await Promise.all(
        response.responses.map((item, index) => {
          const tokenRecord = tokenRecords[index];
          if (!tokenRecord || item.success || !isInvalidTokenError(item.error?.code)) return Promise.resolve();
          return deactivateInvalidToken(database, recipient.userId, tokenRecord.id);
        }),
      );
    }
  }
  return { successCount, failureCount };
}
