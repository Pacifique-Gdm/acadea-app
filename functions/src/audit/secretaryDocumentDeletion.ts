import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { FUNCTION_AUDIT_EVENTS, functionServerAudit } from "./serverAudit.js";
import { enforceCallableRateLimit, FUNCTION_RATE_LIMITS, type RateLimitDatabase } from "../security/rateLimit.js";
import { assertActiveSchoolYear, type SchoolYearDatabase } from "../security/schoolYear.js";

type DocumentKind = "correspondence" | "report";
type DocumentAction = "archive" | "restore" | "delete";

function deleteConfirmation(kind: DocumentKind) {
  return kind === "correspondence" ? "SUPPRIMER COURRIER" : "SUPPRIMER RAPPORT";
}

export function assertPermanentDeletionAllowed(input: { currentStatus: string; ownerId: unknown; actorId: string; archivedFromStatus: unknown }) {
  if (input.ownerId !== input.actorId) throw new HttpsError("permission-denied", "Seul l’auteur peut supprimer définitivement ce document.");
  const deletableDraft = input.currentStatus === "draft"
    || (input.currentStatus === "archived" && input.archivedFromStatus === "draft");
  if (!deletableDraft) throw new HttpsError("failed-precondition", "Seul un brouillon peut être supprimé définitivement.");
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
  if (action === "delete" && request.data?.confirmation !== deleteConfirmation(kind)) throw new HttpsError("invalid-argument", "Confirmation de suppression incorrecte.");

  const db = getFirestore();
  const collectionName = kind === "correspondence" ? "correspondences" : "secretaryReports";
  const reference = db.doc(`${collectionName}/${documentId}`);
  const profileReference = db.doc(`users/${request.auth.uid}`);
  const profileSnapshot = await profileReference.get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists) throw new HttpsError("permission-denied", "Action réservée à un Secrétaire actif.");
  assertSecretaryDocumentAccess({ tokenRole: request.auth.token.role, tokenSchoolId: schoolId, profile, documentSchoolId: schoolId });
  const rate = action === "delete" ? FUNCTION_RATE_LIMITS.SECRETARY_DELETE : FUNCTION_RATE_LIMITS.SECRETARY_DOCUMENT;
  await enforceCallableRateLimit({ db: db as unknown as RateLimitDatabase, actorId: request.auth.uid, schoolId, action: `secretary.${kind}.${action}`, ...rate });
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    if (action === "delete") return { action, deleted: true, alreadyDeleted: true, storageCleanupSucceeded: true };
    throw new HttpsError("not-found", "Document introuvable.");
  }
  const document = snapshot.data() ?? {};
  assertSecretaryDocumentAccess({ tokenRole: request.auth.token.role, tokenSchoolId: schoolId, profile, documentSchoolId: document.schoolId });
  await assertActiveSchoolYear(db as unknown as SchoolYearDatabase, schoolId, document.schoolYearId);

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
