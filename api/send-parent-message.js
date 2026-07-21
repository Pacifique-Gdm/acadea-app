import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { initAdmin } from "./_lib/firebaseAdmin.js";
import { attachRequestId, createApiLogger, getRequestId } from "./_lib/logger.js";

const allowedRecipients = new Set(["admin", "cashier", "both", "discipline"]);
const messageLimit = 3;
const quotaWindowMs = 12 * 60 * 60 * 1000;

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function uid(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeConversationSegment(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    || "unknown";
}

function createConversationId(schoolId, schoolYearId, parentId, threadId) {
  return ["conv", schoolId, schoolYearId, parentId, threadId].map(normalizeConversationSegment).join("_");
}

function messageConversationScope(message) {
  if (message.recipientParentId === "all") return "all";
  const parentId = message.threadParentId ?? (message.recipientParentId !== "school" ? message.recipientParentId : undefined);
  return parentId ? `parent:${parentId}` : "school";
}

function targetConversationScope(recipientParentId, threadParentId) {
  return messageConversationScope({ recipientParentId, threadParentId });
}

function nextMessageThreadId(messages, senderId, recipientParentId, threadParentId) {
  const scope = targetConversationScope(recipientParentId, threadParentId);
  const scopedMessages = messages.filter((message) => messageConversationScope(message) === scope);
  const threadGroups = scopedMessages.reduce((groups, message) => {
    const key = message.threadId ?? "legacy";
    return { ...groups, [key]: [...(groups[key] ?? []), message] };
  }, {});
  const activeMessages = Object.values(threadGroups).sort((a, b) => {
    const lastA = [...a].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0]?.createdAt ?? "";
    const lastB = [...b].sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))[0]?.createdAt ?? "";
    return String(lastB).localeCompare(String(lastA));
  })[0] ?? [];
  const lastMessages = [...activeMessages].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).slice(-2);
  if (lastMessages.length >= 2 && lastMessages.every((message) => message.senderId === senderId)) {
    return uid("thread");
  }
  return activeMessages[0]?.threadId;
}

async function requireParentContext({ auth, db, token }) {
  const caller = await auth.verifyIdToken(token, true);
  if (caller.role !== "parent" || !caller.schoolId || !caller.parentId) {
    throw Object.assign(new Error("Action reservee a un parent autorise."), { statusCode: 403, code: "not-authorized" });
  }

  const userSnapshot = await db.doc(`users/${caller.uid}`).get();
  if (!userSnapshot.exists) {
    throw Object.assign(new Error("Profil parent introuvable."), { statusCode: 403, code: "not-authorized" });
  }
  const user = userSnapshot.data();
  if (user.role !== "parent" || user.schoolId !== caller.schoolId || user.parentId !== caller.parentId || user.status === "inactive" || user.active === false) {
    throw Object.assign(new Error("Profil parent non autorise."), { statusCode: 403, code: "not-authorized" });
  }

  const parentSnapshot = await db.doc(`parents/${caller.parentId}`).get();
  if (!parentSnapshot.exists || parentSnapshot.data().schoolId !== caller.schoolId) {
    throw Object.assign(new Error("Compte parent introuvable."), { statusCode: 403, code: "not-authorized" });
  }

  return { caller, user, parent: parentSnapshot.data() };
}

function quotaFromCounter(counter, nowMs) {
  const windowStartedAt = String(counter.windowStartedAt ?? "");
  const windowExpiresAt = String(counter.windowExpiresAt ?? "");
  const windowExpiresMs = Date.parse(windowExpiresAt);
  if (!windowStartedAt || !windowExpiresAt || Number.isNaN(windowExpiresMs) || nowMs >= windowExpiresMs) {
    return { messageCount: 0, windowStartedAt: "", windowExpiresAt: "" };
  }
  return {
    messageCount: Math.min(Number(counter.messageCount ?? 0), messageLimit),
    windowStartedAt,
    windowExpiresAt,
  };
}

async function legacyActiveQuotaWindow({ db, schoolId, schoolYearId, parentId, now = new Date() }) {
  const snapshot = await db.collection("messages")
    .where("schoolId", "==", schoolId)
    .where("schoolYearId", "==", schoolYearId)
    .where("threadParentId", "==", parentId)
    .where("recipientParentId", "==", "school")
    .get();
  const activeMessages = snapshot.docs
    .map((doc) => String(doc.data().createdAt ?? ""))
    .filter((createdAt) => {
      const createdMs = Date.parse(createdAt);
      return !Number.isNaN(createdMs) && now.getTime() < createdMs + quotaWindowMs;
    })
    .sort((first, second) => first.localeCompare(second));

  if (activeMessages.length === 0) {
    return { messageCount: 0, windowStartedAt: "", windowExpiresAt: "" };
  }

  const windowStartedAt = activeMessages[0];
  const windowExpiresAt = new Date(Date.parse(windowStartedAt) + quotaWindowMs).toISOString();
  const messageCount = activeMessages.filter((createdAt) => createdAt >= windowStartedAt && createdAt < windowExpiresAt).length;
  return {
    messageCount: Math.min(messageCount, messageLimit),
    windowStartedAt,
    windowExpiresAt,
  };
}

async function currentQuota({ db, caller, schoolYearId, now = new Date() }) {
  const counterId = `${caller.schoolId}__${caller.parentId}__${schoolYearId}`;
  const counterSnapshot = await db.doc(`parentDailyMessageLimits/${counterId}`).get();
  if (counterSnapshot.exists) {
    return quotaFromCounter(counterSnapshot.data(), now.getTime());
  }
  return legacyActiveQuotaWindow({ db, schoolId: caller.schoolId, schoolYearId, parentId: caller.parentId, now });
}

function publicError(error) {
  if (error?.code === "quota-exceeded") return { statusCode: 429, body: { error: "quota-exceeded", message: "Vous avez atteint la limite de 3 messages pour 12 heures." } };
  if (error?.code === "not-authorized") return { statusCode: error.statusCode ?? 403, body: { error: "not-authorized", message: "Action non autorisee." } };
  if (error?.code === "invalid-recipient") return { statusCode: 400, body: { error: "invalid-recipient", message: "Destinataire invalide." } };
  return { statusCode: error?.statusCode ?? 500, body: { error: "server-error", message: "Message non envoye. Veuillez reessayer." } };
}

export default async function handler(req, res) {
  const requestId = getRequestId(req);
  attachRequestId(res, requestId);
  const logger = createApiLogger({ endpoint: "/api/send-parent-message", method: req.method, requestId });
  let callerContext;
  let schoolYearId = "";

  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee.", requestId });
    return;
  }

  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      sendJson(res, 401, { error: "not-authenticated", message: "Authentification requise.", requestId });
      return;
    }

    const { auth, db } = initAdmin();
    const { caller, parent } = await requireParentContext({ auth, db, token });
    callerContext = caller;
    const body = req.method === "POST" ? await readBody(req) : {};
    const query = req.query ?? {};
    schoolYearId = normalizeText(req.method === "POST" ? body.schoolYearId : query.schoolYearId);
    if (!schoolYearId) {
      sendJson(res, 400, { error: "missing-school-year", message: "Annee scolaire requise.", requestId });
      return;
    }

    if (req.method === "GET") {
      const quota = await currentQuota({ db, caller, schoolYearId });
      logger.info("Quota message parent consulte.", { schoolId: caller.schoolId, userId: caller.uid, role: caller.role, schoolYearId });
      sendJson(res, 200, {
        quota: {
          limit: messageLimit,
          messageCount: quota.messageCount,
          remaining: Math.max(0, messageLimit - quota.messageCount),
          windowStartedAt: quota.windowStartedAt,
          windowExpiresAt: quota.windowExpiresAt,
          windowHours: 12,
        },
      });
      return;
    }

    const recipient = normalizeText(body.recipient);
    const subject = normalizeText(body.subject);
    const messageBody = normalizeText(body.body);
    if (!allowedRecipients.has(recipient)) {
      sendJson(res, 400, { error: "invalid-recipient", message: "Destinataire invalide.", requestId });
      return;
    }
    if (!subject || !messageBody) {
      sendJson(res, 400, { error: "invalid-message", message: "Objet et message requis.", requestId });
      return;
    }

    const recipientLabels = {
      admin: "Administrateur uniquement",
      cashier: "Caissier uniquement",
      both: "Administrateur et Caissier",
      discipline: "Directeur de Discipline",
    };
    const createdAt = new Date().toISOString();
    const counterId = `${caller.schoolId}__${caller.parentId}__${schoolYearId}`;
    const counterRef = db.doc(`parentDailyMessageLimits/${counterId}`);
    const messageId = uid("msg");
    const notificationId = uid("notif");
    const saved = await db.runTransaction(async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const quota = counterSnapshot.exists
        ? quotaFromCounter(counterSnapshot.data(), Date.parse(createdAt))
        : await legacyActiveQuotaWindow({ db, schoolId: caller.schoolId, schoolYearId, parentId: caller.parentId, now: new Date(createdAt) });
      const existingCount = quota.messageCount;
      const windowStartedAt = quota.windowStartedAt || createdAt;
      const windowExpiresAt = quota.windowExpiresAt || new Date(Date.parse(windowStartedAt) + quotaWindowMs).toISOString();

      if (existingCount >= messageLimit) {
        throw Object.assign(new Error("Quota parent atteint."), { code: "quota-exceeded", statusCode: 429 });
      }

      const messagesSnapshot = await transaction.get(
        db.collection("messages")
          .where("schoolId", "==", caller.schoolId)
          .where("schoolYearId", "==", schoolYearId)
          .where("threadParentId", "==", caller.parentId),
      );
      const existingMessages = messagesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const threadId = nextMessageThreadId(existingMessages, caller.uid, "school", caller.parentId) ?? uid("thread");
      const conversationId = createConversationId(caller.schoolId, schoolYearId, caller.parentId, threadId);
      const message = {
        id: messageId,
        schoolId: caller.schoolId,
        schoolYearId,
        senderId: caller.uid,
        recipientParentId: "school",
        schoolRecipient: recipient,
        threadParentId: caller.parentId,
        threadId,
        conversationId,
        subject: `${recipientLabels[recipient]} - ${subject}`,
        body: messageBody,
        createdAt,
      };
      const notification = {
        id: notificationId,
        schoolId: caller.schoolId,
        schoolYearId,
        recipientRole: "school",
        schoolRecipient: recipient,
        messageId,
        type: "message",
        title: `Nouveau message parent - ${recipientLabels[recipient]}`,
        body: `${parent.fullName ?? caller.name ?? "Parent"} : ${subject}`,
        createdAt,
        read: false,
      };
      const conversation = {
        id: conversationId,
        schoolId: caller.schoolId,
        schoolYearId,
        threadId,
        threadParentId: caller.parentId,
        parentId: caller.parentId,
        parentName: parent.fullName ?? caller.name ?? "Parent",
        schoolRecipient: recipient,
        lastMessage: messageBody,
        lastMessageAt: createdAt,
        lastSenderId: caller.uid,
        lastSenderRole: "parent",
        messageCount: FieldValue.increment(1),
        unreadParentCount: FieldValue.increment(0),
        unreadAdminCount: FieldValue.increment(recipient === "admin" || recipient === "both" ? 1 : 0),
        unreadCashierCount: FieldValue.increment(recipient === "cashier" || recipient === "both" ? 1 : 0),
        unreadDisciplineCount: FieldValue.increment(recipient === "discipline" ? 1 : 0),
        createdAt,
        updatedAt: createdAt,
        status: "active",
      };

      transaction.set(db.doc(`conversations/${conversationId}`), conversation, { merge: true });
      transaction.set(db.doc(`messages/${messageId}`), message);
      transaction.set(db.doc(`notifications/${notificationId}`), notification);
      transaction.set(counterRef, {
        schoolId: caller.schoolId,
        schoolYearId,
        parentId: caller.parentId,
        windowStartedAt,
        windowExpiresAt,
        windowHours: 12,
        messageCount: existingCount + 1,
        updatedAt: createdAt,
      }, { merge: true });
      return {
        message,
        notification,
        quota: {
          limit: messageLimit,
          messageCount: existingCount + 1,
          remaining: Math.max(0, messageLimit - existingCount - 1),
          windowStartedAt,
          windowExpiresAt,
          windowHours: 12,
        },
      };
    });

    logger.info("Message parent envoye.", { schoolId: caller.schoolId, userId: caller.uid, role: caller.role, schoolYearId });
    sendJson(res, 200, saved);
  } catch (error) {
    const response = publicError(error);
    logger.error("Envoi parent echoue.", error, {
      schoolId: callerContext?.schoolId,
      userId: callerContext?.uid,
      role: callerContext?.role,
      schoolYearId,
    });
    sendJson(res, response.statusCode, { ...response.body, requestId });
  }
}
