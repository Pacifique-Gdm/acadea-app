import { initializeApp } from "firebase-admin/app";

initializeApp();

export { onPaymentRecordedNotificationCreated } from "./push/paymentRecorded.js";
export { onMessageNotificationCreated } from "./push/messageNotification.js";
export { onOperationalNotificationCreated } from "./push/operationalNotification.js";
export { onPersonalNotificationCreated } from "./push/personalNotification.js";
export { secretaryAiRecordDecision, secretaryAiWritingAssistant } from "./ai/writingAssistant.js";
export { studyAiAssistant } from "./ai/studyAssistant.js";
export { platformAiResetMonthlyUsage, platformAiUpdateSettings } from "./ai/schoolAiAdmin.js";
export { onDisciplineSanctionAudited } from "./audit/disciplineAudit.js";
export { secretaryDeleteDocument } from "./audit/secretaryDocumentDeletion.js";
export { secretaryCorrespondenceFile } from "./audit/secretaryCorrespondenceFile.js";
export { messageAttachmentFile } from "./audit/messageAttachmentFile.js";
export { onStudentAllocationForecastChanged, onFeeAllocationForecastChanged } from "./finance/forecastSignals.js";
export { allocationMaintenanceEvery10Minutes, allocationNightlyCheck } from "./finance/allocationMaintenance.js";
