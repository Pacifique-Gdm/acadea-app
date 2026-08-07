import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "./serverAudit.js";

type DocumentKind = "correspondence" | "report";
type DocumentAction = "archive" | "restore" | "delete";

const DELETE_CONFIRMATION = "SUPPRIMER DÉFINITIVEMENT";

export function assertPermanentDeletionAllowed(input: { currentStatus: string; ownerId: unknown; actorId: string; archivedFromStatus: unknown }) {
  if (input.currentStatus !== "archived") throw new HttpsError("failed-precondition", "Archivez le document avant sa suppression définitive.");
  if (input.ownerId !== input.actorId) throw new HttpsError("permission-denied", "Seul l’auteur peut supprimer définitivement ce document.");
  if (input.archivedFromStatus !== "draft") throw new HttpsError("failed-precondition", "Seul un brouillon archivé peut être supprimé définitivement.");
}

export function assertSecretaryDocumentAccess(input: { tokenRole: unknown; tokenSchoolId: string; profile: Record<string, unknown> | undefined; documentSchoolId: unknown }) {
  if (!input.profile || input.profile.status === "inactive" || input.profile.role !== "secretary" || input.profile.schoolId !== input.tokenSchoolId || input.tokenRole !== "secretary") {
    throw new HttpsError("permission-denied", "Action réservée à un Secrétaire actif.");
  }
  if (input.documentSchoolId !== input.tokenSchoolId) throw new HttpsError("permission-denied", "Document hors établissement.");
}

function eventType(kind: DocumentKind, action: DocumentAction) {
  if (kind === "correspondence") {
    if (action === "archive") return FUNCTION_AUDIT_EVENTS.CORRESPONDENCE_ARCHIVED;
    if (action === "restore") return FUNCTION_AUDIT_EVENTS.CORRESPONDENCE_RESTORED;
    return FUNCTION_AUDIT_EVENTS.CORRESPONDENCE_DELETED;
  }
  if (action === "archive") return FUNCTION_AUDIT_EVENTS.REPORT_ARCHIVED;
  if (action === "restore") return FUNCTION_AUDIT_EVENTS.REPORT_RESTORED;
  return FUNCTION_AUDIT_EVENTS.REPORT_DELETED;
}

export const secretaryDeleteDocument = onCall({ region: "europe-west1", invoker: "public" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const schoolId = typeof request.auth.token.schoolId === "string" ? request.auth.token.schoolId : "";
  const documentId = typeof request.data?.documentId === "string" ? request.data.documentId.trim() : "";
  const kind: DocumentKind | undefined = request.data?.kind === "correspondence" || request.data?.kind === "report" ? request.data.kind : undefined;
  const action: DocumentAction | undefined = request.data?.action === "archive" || request.data?.action === "restore" || request.data?.action === "delete" ? request.data.action : undefined;
  if (!schoolId || !documentId || documentId.length > 128 || !kind || !action) throw new HttpsError("invalid-argument", "Document ou action invalide.");
  if (action === "delete" && request.data?.confirmation !== DELETE_CONFIRMATION) throw new HttpsError("invalid-argument", "Confirmation de suppression incorrecte.");

  const db = getFirestore();
  const collectionName = kind === "correspondence" ? "correspondences" : "secretaryReports";
  const reference = db.doc(`${collectionName}/${documentId}`);
  const profileReference = db.doc(`users/${request.auth.uid}`);
  const profileSnapshot = await profileReference.get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists) throw new HttpsError("permission-denied", "Action réservée à un Secrétaire actif.");
  assertSecretaryDocumentAccess({ tokenRole: request.auth.token.role, tokenSchoolId: schoolId, profile, documentSchoolId: schoolId });
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    if (action === "delete") return { action, deleted: true, alreadyDeleted: true, storageCleanupSucceeded: true };
    throw new HttpsError("not-found", "Document introuvable.");
  }
  const document = snapshot.data() ?? {};
  assertSecretaryDocumentAccess({ tokenRole: request.auth.token.role, tokenSchoolId: schoolId, profile, documentSchoolId: document.schoolId });

  const currentStatus = typeof document.status === "string" ? document.status : "draft";
  const ownerId = kind === "correspondence" ? document.createdBy : document.authorId;
  const auditId = `secretary-${action}-${kind}-${documentId}-${Date.now()}`;
  const audit = functionServerAudit({ id: auditId, eventType: eventType(kind, action), actor: { uid: request.auth.uid, role: "secretary", name: profile?.name }, schoolId, schoolYearId: document.schoolYearId, resourceType: kind, resourceId: documentId, metadata: { previousStatus: currentStatus } });
  const batch = db.batch();

  if (action === "archive") {
    if (currentStatus === "archived") throw new HttpsError("failed-precondition", "Ce document est déjà archivé.");
    batch.update(reference, { status: "archived", archivedFromStatus: currentStatus, archivedAt: FieldValue.serverTimestamp(), archivedBy: request.auth.uid, updatedAt: FieldValue.serverTimestamp() });
  } else if (action === "restore") {
    if (currentStatus !== "archived") throw new HttpsError("failed-precondition", "Ce document n’est pas archivé.");
    const restoredStatus = typeof document.archivedFromStatus === "string" && document.archivedFromStatus !== "archived" ? document.archivedFromStatus : "draft";
    batch.update(reference, { status: restoredStatus, archivedFromStatus: null, restoredAt: FieldValue.serverTimestamp(), restoredBy: request.auth.uid, updatedAt: FieldValue.serverTimestamp() });
  } else {
    assertPermanentDeletionAllowed({ currentStatus, ownerId, actorId: request.auth.uid, archivedFromStatus: document.archivedFromStatus });
    batch.delete(reference);
  }
  batch.create(db.doc(`auditLogs/${auditId}`), audit);
  await batch.commit();

  let storageCleanupSucceeded = true;
  if (action === "delete" && kind === "correspondence") {
    try { await getStorage().bucket().deleteFiles({ prefix: `schools/${schoolId}/correspondences/${documentId}/` }); }
    catch { storageCleanupSucceeded = false; }
  }
  return { action, deleted: action === "delete", alreadyDeleted: false, storageCleanupSucceeded };
});
