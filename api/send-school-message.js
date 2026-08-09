import { createHash, randomUUID } from "node:crypto";
import { initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { requireActiveSchoolYear } from "./_lib/schoolYear.js";
import { allowedRecipientRoles, messagingSenderIdentity, normalizedMessagingRole, requireMessagingCaller } from "./_lib/messageRecipients.js";

export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const FILE_POLICY = new Map([
  [".pdf", "application/pdf"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
]);

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function text(value, max = 2000) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizedRole(value) {
  return normalizedMessagingRole(value);
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function stableId(prefix, ...values) {
  return `${prefix}-${createHash("sha256").update(values.join("\u001f")).digest("hex").slice(0, 24)}`;
}

export async function resolveRecipients(db, caller, recipientRoles, recipientIds, schoolYearId) {
  const requestedRoles = [...new Set(recipientRoles.map(normalizedRole))];
  const allowed = allowedRecipientRoles(caller.role);
  if (!requestedRoles.length || requestedRoles.some((role) => !allowed.has(role))) throw httpError(400, "invalid-recipient", "Destinataire non autorise.");
  if (!recipientIds.length || recipientIds.length > 50) throw httpError(400, "invalid-recipient", "Selection de destinataires invalide.");
  const snapshots = await db.getAll(...recipientIds.map((id) => db.doc(`users/${id}`)));
  const recipients = snapshots.map((snapshot) => snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null);
  if (recipients.some((recipient) => !recipient)) throw httpError(400, "invalid-recipient", "Un destinataire est introuvable.");
  for (const recipient of recipients) {
    const role = normalizedRole(recipient.role);
    if (recipient.schoolId !== caller.schoolId || !requestedRoles.includes(role) || recipient.active === false || recipient.status === "inactive") {
      throw httpError(403, "invalid-recipient", "Un destinataire n'appartient pas a cet etablissement ou n'est pas autorise.");
    }
    if (role === "parent") {
      if (!recipient.parentId) throw httpError(403, "invalid-recipient", "Profil parent incomplet.");
      const parentSnapshot = await db.doc(`parents/${recipient.parentId}`).get();
      const parent = parentSnapshot.exists ? parentSnapshot.data() : undefined;
      if (!parent || parent.schoolId !== caller.schoolId || !Array.isArray(parent.studentIds) || parent.studentIds.length === 0) throw httpError(403, "invalid-recipient", "Parent non rattache a cet etablissement.");
      const studentSnapshots = await db.getAll(...parent.studentIds.map((id) => db.doc(`students/${id}`)));
      if (!studentSnapshots.some((snapshot) => snapshot.exists && snapshot.data().schoolId === caller.schoolId && snapshot.data().schoolYearId === schoolYearId)) {
        throw httpError(403, "invalid-recipient", "Parent sans eleve rattache a l'annee scolaire active.");
      }
    }
  }
  return recipients;
}

function safeOriginalName(value) {
  return text(value, 120).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-") || "fichier";
}

function fileExtension(path) {
  return path.slice(path.lastIndexOf(".")).toLowerCase();
}

export async function verifyAndMoveAttachments(bucket, caller, schoolYearId, draftId, attachments, conversationId, messageId) {
  if (!Array.isArray(attachments) || attachments.length > MAX_ATTACHMENTS) throw httpError(400, "invalid-attachments", "Pieces jointes invalides.");
  const prefix = `message-uploads/${caller.schoolId}/${caller.uid}/${draftId}/`;
  const verified = [];
  let total = 0;
  for (const item of attachments) {
    const path = text(item?.path, 500);
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) throw httpError(400, "invalid-attachments", "Chemin de piece jointe invalide.");
    const extension = fileExtension(path);
    const [metadata] = await bucket.file(path).getMetadata();
    const size = Number(metadata.size ?? 0);
    const mime = metadata.contentType ?? "";
    const custom = metadata.metadata ?? {};
    if (!FILE_POLICY.has(extension) || FILE_POLICY.get(extension) !== mime || size <= 0 || custom.schoolId !== caller.schoolId || custom.schoolYearId !== schoolYearId || custom.senderId !== caller.uid || custom.draftId !== draftId) {
      throw httpError(400, "invalid-attachments", "Une piece jointe ne respecte pas la politique de securite.");
    }
    total += size;
    if (total > MAX_TOTAL_BYTES) throw httpError(400, "attachments-too-large", "La taille totale des pieces jointes ne doit pas depasser 10 Mo.");
    verified.push({ sourcePath: path, name: safeOriginalName(custom.originalName), type: mime, size, extension });
  }
  const moved = [];
  try {
    for (const item of verified) {
      const token = randomUUID();
      const destination = `messages/${caller.schoolId}/${conversationId}/${messageId}/${randomUUID()}${item.extension}`;
      await bucket.file(item.sourcePath).copy(bucket.file(destination), { metadata: { contentType: item.type, metadata: { firebaseStorageDownloadTokens: token, schoolId: caller.schoolId, schoolYearId, conversationId, messageId, originalName: item.name } } });
      moved.push({ name: item.name, type: item.type, size: item.size, path: destination, url: `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destination)}?alt=media&token=${token}` });
    }
    return moved;
  } catch (error) {
    await Promise.allSettled(moved.map((item) => bucket.file(item.path).delete({ ignoreNotFound: true })));
    throw error;
  }
}

export function createSchoolMessageDocument({ messageId, caller, schoolYearId, recipients, participantIds, conversationId, subject, messageBody, attachments, createdAt }) {
  return {
    id: messageId,
    schoolId: caller.schoolId,
    schoolYearId,
    senderId: caller.uid,
    ...messagingSenderIdentity(caller),
    recipientIds: recipients.map((recipient) => recipient.id),
    participantIds,
    recipientParentId: "school",
    threadId: conversationId,
    conversationId,
    subject,
    body: messageBody,
    attachments,
    createdAt,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee." });
  let temporaryPaths = [];
  let finalPaths = [];
  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw httpError(401, "not-authenticated", "Authentification requise.");
    const { auth, db, bucket } = initAdmin();
    const caller = await requireMessagingCaller(auth, db, token);
    const body = await readBody(req);
    const schoolYearId = text(body.schoolYearId, 120);
    const subject = text(body.subject, 200);
    const messageBody = text(body.body, 5000);
    const draftId = text(body.draftId, 120);
    const recipientRoles = Array.isArray(body.recipientRoles) ? body.recipientRoles.map((item) => text(item, 40)) : [];
    const recipientIds = Array.isArray(body.recipientIds) ? [...new Set(body.recipientIds.map((item) => text(item, 128)).filter(Boolean))] : [];
    if (!schoolYearId || !subject || !messageBody || !draftId) throw httpError(400, "invalid-argument", "Annee, objet, message et brouillon sont requis.");
    await requireActiveSchoolYear(db, caller.schoolId, schoolYearId);
    const recipients = await resolveRecipients(db, caller, recipientRoles, recipientIds, schoolYearId);
    const idempotencyKey = text(req.headers["x-idempotency-key"], 128);
    if (!idempotencyKey) throw httpError(400, "invalid-argument", "Cle d'idempotence requise.");
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.schoolId, action: "school.message.send", idempotencyKey, ...API_RATE_LIMITS.SCHOOL_MESSAGE });
    const createdAt = new Date().toISOString();
    const messageId = stableId("msg", caller.uid, idempotencyKey);
    const conversationId = stableId("conv", caller.uid, idempotencyKey);
    const inputAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    temporaryPaths = inputAttachments.map((item) => text(item?.path, 500)).filter(Boolean);
    const existingMessage = await db.doc(`messages/${messageId}`).get();
    if (existingMessage.exists) {
      await Promise.allSettled(temporaryPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
      sendJson(res, 200, { message: existingMessage.data(), idempotent: true });
      return;
    }
    const attachments = await verifyAndMoveAttachments(bucket, caller, schoolYearId, draftId, inputAttachments, conversationId, messageId);
    finalPaths = attachments.map((item) => item.path);
    const participantIds = [...new Set([caller.uid, ...recipients.map((recipient) => recipient.id)])];
    const savedMessage = createSchoolMessageDocument({ messageId, caller, schoolYearId, recipients, participantIds, conversationId, subject, messageBody, attachments, createdAt });
    const conversation = { id: conversationId, schoolId: caller.schoolId, schoolYearId, threadId: conversationId, threadParentId: "school", parentId: "school", participantIds, lastMessage: messageBody, lastMessageAt: createdAt, lastSenderId: caller.uid, lastSenderRole: caller.role, messageCount: 1, unreadParentCount: 0, unreadAdminCount: 0, unreadCashierCount: 0, unreadDisciplineCount: 0, createdAt, updatedAt: createdAt, status: "active" };
    const batch = db.batch();
    batch.set(db.doc(`messages/${messageId}`), savedMessage);
    batch.set(db.doc(`conversations/${conversationId}`), conversation);
    recipients.forEach((recipient) => {
      const notificationId = stableId("notif", messageId, recipient.id);
      batch.set(db.doc(`notifications/${notificationId}`), { id: notificationId, schoolId: caller.schoolId, schoolYearId, recipientUserId: recipient.id, audienceRoles: [normalizedRole(recipient.role)], messageId, type: "message", title: "Nouveau message", body: subject, createdAt, read: false });
    });
    await batch.commit();
    await Promise.allSettled(temporaryPaths.map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
    sendJson(res, 200, { message: savedMessage });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    if (finalPaths.length || temporaryPaths.length) {
      try {
        const { bucket } = initAdmin();
        await Promise.allSettled([...finalPaths, ...temporaryPaths].map((path) => bucket.file(path).delete({ ignoreNotFound: true })));
      } catch { /* diagnostic principal conserve */ }
    }
    const statusCode = Number(error?.statusCode) || 500;
    const code = typeof error?.code === "string" ? error.code : "server-error";
    if (statusCode >= 500) console.error("[Acadea messaging] Envoi serveur impossible.", { code, errorName: error?.name });
    sendJson(res, statusCode, { error: code, message: statusCode >= 500 ? "Message non envoye. Veuillez reessayer." : error.message });
  }
}
