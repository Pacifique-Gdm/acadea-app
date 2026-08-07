import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onPaymentRecordedNotificationCreated } from "./push/paymentRecorded.js";
export { onMessageNotificationCreated } from "./push/messageNotification.js";
export { onOperationalNotificationCreated } from "./push/operationalNotification.js";
export { secretaryAiRecordDecision, secretaryAiWritingAssistant } from "./ai/writingAssistant.js";
export { platformAiResetMonthlyUsage } from "./ai/schoolAiAdmin.js";
