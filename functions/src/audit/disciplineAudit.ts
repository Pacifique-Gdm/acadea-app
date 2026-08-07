import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "./serverAudit.js";

export const onDisciplineSanctionAudited = onDocumentWritten({ document: "disciplineSanctions/{sanctionId}", region: "europe-west1" }, async (event) => {
  const before = event.data?.before;
  const after = event.data?.after;
  if (!after?.exists) return;
  const sanction = after.data() ?? {};
  const created = !before?.exists;
  const completed = before?.exists && before.data()?.status !== "completed" && sanction.status === "completed";
  if (!created && !completed) return;
  const actorId = created ? sanction.createdBy : sanction.completedBy;
  if (typeof actorId !== "string" || typeof sanction.schoolId !== "string") throw new Error("Contexte de sanction incomplet pour l'audit.");
  const db = getFirestore();
  const profile = await db.doc(`users/${actorId}`).get();
  const actorRole = String(profile.data()?.role ?? "discipline_director");
  const auditId = `discipline-${event.id}`;
  await db.doc(`auditLogs/${auditId}`).create(functionServerAudit({ id: auditId, eventType: created ? FUNCTION_AUDIT_EVENTS.DISCIPLINE_SANCTION_CREATED : FUNCTION_AUDIT_EVENTS.DISCIPLINE_SANCTION_COMPLETED, actor: { uid: actorId, role: actorRole, name: profile.data()?.name }, schoolId: sanction.schoolId, schoolYearId: sanction.schoolYearId, resourceType: "disciplineSanction", resourceId: event.params.sanctionId, metadata: { status: String(sanction.status ?? "") } }));
});
