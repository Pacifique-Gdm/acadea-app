import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "./serverAudit.js";

export const secretaryDeleteDocument = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  if (request.auth.token.role !== "secretary") throw new HttpsError("permission-denied", "Action réservée au Secrétaire.");
  const schoolId = typeof request.auth.token.schoolId === "string" ? request.auth.token.schoolId : "";
  const documentId = typeof request.data?.documentId === "string" ? request.data.documentId : "";
  const kind = request.data?.kind === "correspondence" || request.data?.kind === "report" ? request.data.kind : undefined;
  if (!schoolId || !documentId || !kind) throw new HttpsError("invalid-argument", "Document invalide.");
  const db = getFirestore();
  const collectionName = kind === "correspondence" ? "correspondences" : "secretaryReports";
  const reference = db.doc(`${collectionName}/${documentId}`);
  const [snapshot, profile] = await Promise.all([reference.get(), db.doc(`users/${request.auth.uid}`).get()]);
  if (!snapshot.exists) return { deleted: true, alreadyDeleted: true, storageCleanupSucceeded: true };
  const document = snapshot.data() ?? {};
  if (document.schoolId !== schoolId || !profile.exists || profile.data()?.schoolId !== schoolId || profile.data()?.role !== "secretary") throw new HttpsError("permission-denied", "Document hors établissement.");
  const auditId = `secretary-delete-${kind}-${documentId}`;
  const batch = db.batch();
  batch.delete(reference);
  batch.create(db.doc(`auditLogs/${auditId}`), functionServerAudit({ id: auditId, eventType: kind === "correspondence" ? FUNCTION_AUDIT_EVENTS.CORRESPONDENCE_DELETED : FUNCTION_AUDIT_EVENTS.REPORT_DELETED, actor: { uid: request.auth.uid, role: "secretary", name: profile.data()?.name }, schoolId, schoolYearId: document.schoolYearId, resourceType: kind, resourceId: documentId }));
  await batch.commit();
  let storageCleanupSucceeded = true;
  if (kind === "correspondence") {
    try { await getStorage().bucket().deleteFiles({ prefix: `schools/${schoolId}/correspondences/${documentId}/` }); }
    catch { storageCleanupSucceeded = false; }
  }
  return { deleted: true, alreadyDeleted: false, storageCleanupSucceeded };
});
