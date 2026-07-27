import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onPaymentRecordedNotificationCreated } from "./push/paymentRecorded.js";
export { onMessageNotificationCreated } from "./push/messageNotification.js";
export { onOperationalNotificationCreated } from "./push/operationalNotification.js";
