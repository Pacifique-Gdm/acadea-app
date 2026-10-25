import { getFirestore, type DocumentData } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

const MAX_BYTES = 10 * 1024 * 1024;
const allowedTypes: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
type Identity = { uid: string; role: unknown; schoolId: unknown; parentId: unknown; coordinationId: unknown; subCoordinationId: unknown };

function normalizedRole(value: unknown) {
  return value === "admin" ? "school_admin" : value;
}

export function assertMessageAttachmentAccess(identity: Identity, profile: DocumentData | undefined, school: DocumentData | undefined, message: DocumentData | undefined, messageId: string, path: unknown) {
  const schoolId = identity.schoolId;
  const role = normalizedRole(identity.role);
  const privileged = role === "super_admin" || role === "coordination_admin" || role === "sub_coordination_admin";
  const roleMatches = normalizedRole(profile?.role) === role || (role === "super_admin" && profile?.role == null);
  if (typeof schoolId !== "string" || !schoolId || !profile || profile.status === "inactive" || profile.active === false
    || !roleMatches || (!privileged && profile.schoolId !== schoolId)) {
    throw new HttpsError("permission-denied", "Profil ou établissement non autorisé.");
  }
  if (role === "parent" && (typeof profile.parentId !== "string" || !profile.parentId
    || (identity.parentId != null && identity.parentId !== profile.parentId))) {
    throw new HttpsError("permission-denied", "Profil Parent non concordant.");
  }
  if ((role === "coordination_admin" || role === "sub_coordination_admin") && profile.coordinationId !== identity.coordinationId) {
    throw new HttpsError("permission-denied", "Coordination non concordante.");
  }
  if (role === "sub_coordination_admin" && profile.subCoordinationId !== identity.subCoordinationId) {
    throw new HttpsError("permission-denied", "Sous-coordination non concordante.");
  }
  if (!school || ["suspended", "inactive", "deleting"].includes(school.status)) {
    throw new HttpsError("permission-denied", "Établissement indisponible.");
  }
  if (!message || message.schoolId !== schoolId || !Array.isArray(message.participantIds)
    || !message.participantIds.includes(identity.uid)) {
    throw new HttpsError("permission-denied", "Message hors de votre périmètre.");
  }
  const conversationId = message.conversationId ?? message.threadId;
  if (message.id != null && message.id !== messageId) throw new HttpsError("failed-precondition", "Identifiant de message incohérent.");
  if (typeof conversationId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(conversationId)
    || typeof messageId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId)) {
    throw new HttpsError("failed-precondition", "Références du message invalides.");
  }
  const prefix = `messages/${schoolId}/${conversationId}/${messageId}/`;
  const fileName = typeof path === "string" && path.startsWith(prefix) ? path.slice(prefix.length) : "";
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || !allowedTypes[extension]) {
    throw new HttpsError("permission-denied", "Chemin de pièce jointe invalide.");
  }
  const attachment = Array.isArray(message.attachments)
    ? message.attachments.find((item: unknown) => item && typeof item === "object" && (item as { path?: unknown }).path === path)
    : undefined;
  if (!attachment || attachment.type !== allowedTypes[extension] || typeof attachment.size !== "number"
    || !Number.isFinite(attachment.size) || attachment.size <= 0 || attachment.size > MAX_BYTES) {
    throw new HttpsError("permission-denied", "Pièce jointe absente du message.");
  }
  return { path: path as string, name: typeof attachment.name === "string" ? attachment.name.slice(0, 120) : "document", type: attachment.type as string, size: attachment.size as number };
}

export async function handleMessageAttachmentFile(request: { auth: { uid: string; token: Record<string, unknown> } | null; data: Record<string, unknown> }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentification requise.");
  const messageId = request.data?.messageId;
  const path = request.data?.path;
  if (typeof messageId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(messageId) || typeof path !== "string" || path.length > 500) {
    throw new HttpsError("invalid-argument", "Référence de pièce jointe invalide.");
  }
  const identity: Identity = {
    uid: request.auth.uid, role: request.auth.token.role, schoolId: request.auth.token.schoolId,
    parentId: request.auth.token.parentId, coordinationId: request.auth.token.coordinationId,
    subCoordinationId: request.auth.token.subCoordinationId,
  };
  if (typeof identity.schoolId !== "string" || !identity.schoolId) throw new HttpsError("permission-denied", "Établissement invalide.");
  const db = getFirestore();
  const profileRef = db.doc(`users/${identity.uid}`);
  const schoolRef = db.doc(`schools/${identity.schoolId}`);
  const messageRef = db.doc(`messages/${messageId}`);
  const readState = async () => {
    const [profile, school, message] = await Promise.all([profileRef.get(), schoolRef.get(), messageRef.get()]);
    return assertMessageAttachmentAccess(identity, profile.data(), school.data(), message.data(), messageId, path);
  };
  const attachment = await readState();
  const [bytes] = await getStorage().bucket().file(attachment.path).download();
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.length !== attachment.size) {
    throw new HttpsError("failed-precondition", "Taille de pièce jointe incohérente.");
  }
  const current = await readState();
  if (current.path !== attachment.path || current.size !== attachment.size || current.type !== attachment.type) {
    throw new HttpsError("failed-precondition", "Ce message a changé. Réessayez.");
  }
  return { name: attachment.name, contentType: attachment.type, dataBase64: bytes.toString("base64") };
}

export const messageAttachmentFile = onCall({ region: "europe-west1", memory: "512MiB", timeoutSeconds: 120, invoker: "public" }, async (request) =>
  handleMessageAttachmentFile({ auth: request.auth ? { uid: request.auth.uid, token: request.auth.token } : null, data: request.data }));
