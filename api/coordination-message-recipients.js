import { createHash } from "node:crypto";
import { initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { activeCoordinationSchoolIds, chunks, coordinationHttpError, requireActiveCoordinator } from "./_lib/coordination.js";

const ALLOWED_ROLES = new Set(["school_admin", "discipline_director", "study_director", "cashier", "teacher", "parent", "secretary"]);
function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function text(value, max = 5000) { return String(value ?? "").trim().slice(0, max); }
function stableId(prefix, ...parts) { return `${prefix}-${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24)}`; }
async function readBody(req) { if (req.body && typeof req.body === "object") return req.body; if (typeof req.body === "string") return JSON.parse(req.body || "{}"); const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}"); }

async function loadRecipients(req, res, db, caller) {
  const schoolIds = await activeCoordinationSchoolIds(db, caller.coordinationId);
  await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.message.recipients", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
  const selectedSchoolId = String(req.query?.schoolId ?? "").trim();
  if (selectedSchoolId && !schoolIds.includes(selectedSchoolId)) throw coordinationHttpError(403, "school-outside-coordination", "École hors Coordination.");
  const scope = selectedSchoolId ? [selectedSchoolId] : schoolIds;
  const recipients = [];
  for (const batch of chunks(scope, 30)) {
    let cursor;
    do {
      let usersQuery = db.collection("users").where("schoolId", "in", batch).limit(500);
      if (cursor) usersQuery = usersQuery.startAfter(cursor);
      const snapshot = await usersQuery.get();
      snapshot.docs.forEach((item) => {
        const profile = item.data();
        const role = profile.role === "admin" ? "school_admin" : profile.role;
        if (ALLOWED_ROLES.has(role) && profile.active !== false && profile.status !== "inactive") recipients.push({ uid: item.id, name: String(profile.name ?? profile.displayName ?? "Utilisateur"), role, schoolId: profile.schoolId });
      });
      cursor = snapshot.docs.at(-1);
      if (snapshot.docs.length < 500) break;
    } while (cursor);
  }
  recipients.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return sendJson(res, 200, { recipients });
}

async function sendMessage(req, res, db, caller) {
  const input = await readBody(req);
  const subject = text(input.subject, 200); const messageBody = text(input.body); const idempotencyKey = text(req.headers["x-idempotency-key"], 128);
  const recipientIds = Array.isArray(input.recipientIds) ? [...new Set(input.recipientIds.map((item) => text(item, 128)).filter(Boolean))] : [];
  if (!subject || !messageBody || !idempotencyKey || !recipientIds.length || recipientIds.length > 200) throw coordinationHttpError(400, "invalid-argument", "Objet, message et destinataires sont requis.");
  const schoolIds = await activeCoordinationSchoolIds(db, caller.coordinationId);
  const selectedSchoolId = text(input.schoolId, 128);
  if (selectedSchoolId && !schoolIds.includes(selectedSchoolId)) throw coordinationHttpError(403, "school-outside-coordination", "École hors Coordination.");
  await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.message.send", idempotencyKey, ...API_RATE_LIMITS.SCHOOL_MESSAGE });
  const recipientSnapshots = [];
  for (const batch of chunks(recipientIds, 100)) recipientSnapshots.push(...await db.getAll(...batch.map((id) => db.doc(`users/${id}`))));
  const recipients = recipientSnapshots.map((snapshot) => snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null);
  if (recipients.some((item) => !item)) throw coordinationHttpError(400, "invalid-recipient", "Un destinataire est introuvable.");
  for (const recipient of recipients) {
    const role = recipient.role === "admin" ? "school_admin" : recipient.role;
    if (!schoolIds.includes(recipient.schoolId) || (selectedSchoolId && recipient.schoolId !== selectedSchoolId) || !ALLOWED_ROLES.has(role) || recipient.active === false || recipient.status === "inactive") throw coordinationHttpError(403, "invalid-recipient", "Destinataire hors périmètre ou non autorisé.");
  }
  const requestId = stableId("coord-request", caller.uid, idempotencyKey);
  const requestRef = db.doc(`coordinationMessageRequests/${requestId}`);
  const existing = await requestRef.get();
  if (existing.exists) return sendJson(res, 200, { messageIds: existing.data().messageIds ?? [], idempotent: true });
  const schoolSnapshots = await db.getAll(...schoolIds.map((id) => db.doc(`schools/${id}`)));
  const activeYears = new Map(schoolSnapshots.filter((item) => item.exists).map((item) => [item.id, item.data().activeSchoolYearId]));
  const now = new Date().toISOString(); const batch = db.batch(); const messageIds = [];
  for (const recipient of recipients) {
    const schoolYearId = activeYears.get(recipient.schoolId);
    if (!schoolYearId) throw coordinationHttpError(409, "school-year-missing", "Une école ne possède aucune année scolaire active.");
    const messageId = stableId("coord-msg", caller.uid, idempotencyKey, recipient.id); messageIds.push(messageId);
    batch.set(db.doc(`messages/${messageId}`), { id: messageId, coordinationId: caller.coordinationId, schoolId: recipient.schoolId, schoolYearId, senderId: caller.uid, senderName: caller.profile.name ?? "Coordination", senderRole: "coordination_admin", recipientIds: [recipient.id], participantIds: [caller.uid, recipient.id], recipientParentId: "school", subject, body: messageBody, createdAt: now, idempotencyKeyHash: stableId("key", caller.uid, idempotencyKey) });
    const notificationId = stableId("notif", messageId, recipient.id);
    batch.set(db.doc(`notifications/${notificationId}`), { id: notificationId, coordinationId: caller.coordinationId, schoolId: recipient.schoolId, schoolYearId, recipientUserId: recipient.id, audienceRoles: [recipient.role === "admin" ? "school_admin" : recipient.role], messageId, type: "message", title: "Nouveau message de la Coordination", body: subject, createdAt: now, read: false });
  }
  const auditRef = db.collection("auditLogs").doc();
  batch.set(auditRef, { id: auditRef.id, eventType: "coordination.message.sent", coordinationId: caller.coordinationId, actorId: caller.uid, actorRole: caller.role, actorName: caller.profile.name ?? "Coordinateur", action: "Message Coordination envoyé", source: "server", createdAt: now, metadata: { recipientCount: recipients.length } });
  batch.create(requestRef, { id: requestId, coordinationId: caller.coordinationId, actorId: caller.uid, messageIds, createdAt: now });
  await batch.commit();
  return sendJson(res, 200, { messageIds, idempotent: false });
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "method-not-allowed", message: "Méthode non autorisée." });
  try {
    const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
    if (!token) throw coordinationHttpError(401, "not-authenticated", "Authentification requise.");
    const { auth, db } = initAdmin();
    const caller = await requireActiveCoordinator(auth, db, token);
    return req.method === "GET" ? loadRecipients(req, res, db, caller) : sendMessage(req, res, db, caller);
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    const status = Number(error?.statusCode) || 500;
    return sendJson(res, status, { error: error?.code || "server-error", message: status >= 500 ? (req.method === "GET" ? "Destinataires indisponibles." : "Message non envoyé.") : error.message });
  }
}
