import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const allowedRecipients = new Set(["admin", "cashier", "both", "discipline"]);
const dailyLimit = 3;
const quotaTimeZone = "Africa/Kinshasa";

function getCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8")));
  }

  if (process.env.NODE_ENV !== "production" && existsSync("service-account.json")) {
    return cert(JSON.parse(readFileSync("service-account.json", "utf8")));
  }

  return applicationDefault();
}

function initAdmin() {
  if (getApps().length === 0) {
    initializeApp({ credential: getCredential() });
  }

  return {
    auth: getAuth(),
    db: getFirestore(),
  };
}

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

function localDateInKinshasa(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: quotaTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function kinshasaDayBounds(localDate) {
  const [year, month, day] = localDate.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, -1, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
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

async function legacySentCount({ db, schoolId, schoolYearId, parentId, localDate }) {
  const { startIso, endIso } = kinshasaDayBounds(localDate);
  const snapshot = await db.collection("messages")
    .where("schoolId", "==", schoolId)
    .where("schoolYearId", "==", schoolYearId)
    .where("threadParentId", "==", parentId)
    .where("recipientParentId", "==", "school")
    .get();
  // Filtrage local de la journée pour éviter un index composite Firestore dédié.
  return snapshot.docs.filter((doc) => {
    const createdAt = String(doc.data().createdAt ?? "");
    return createdAt >= startIso && createdAt < endIso;
  }).length;
}

async function currentQuota({ db, caller, schoolYearId, localDate }) {
  const counterId = `${caller.schoolId}__${caller.parentId}__${localDate}`;
  const counterSnapshot = await db.doc(`parentDailyMessageLimits/${counterId}`).get();
  if (counterSnapshot.exists) {
    return Math.min(Number(counterSnapshot.data().messageCount ?? 0), dailyLimit);
  }
  return Math.min(await legacySentCount({ db, schoolId: caller.schoolId, schoolYearId, parentId: caller.parentId, localDate }), dailyLimit);
}

function publicError(error) {
  if (error?.code === "quota-exceeded") return { statusCode: 429, body: { error: "quota-exceeded", message: "Vous avez atteint la limite de 3 messages pour aujourd'hui." } };
  if (error?.code === "not-authorized") return { statusCode: error.statusCode ?? 403, body: { error: "not-authorized", message: "Action non autorisee." } };
  if (error?.code === "invalid-recipient") return { statusCode: 400, body: { error: "invalid-recipient", message: "Destinataire invalide." } };
  return { statusCode: error?.statusCode ?? 500, body: { error: "server-error", message: "Message non envoye. Veuillez reessayer." } };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    sendJson(res, 405, { error: "method-not-allowed", message: "Methode non autorisee." });
    return;
  }

  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    if (!token) {
      sendJson(res, 401, { error: "not-authenticated", message: "Authentification requise." });
      return;
    }

    const { auth, db } = initAdmin();
    const { caller, parent } = await requireParentContext({ auth, db, token });
    const body = req.method === "POST" ? await readBody(req) : {};
    const query = req.query ?? {};
    const schoolYearId = normalizeText(req.method === "POST" ? body.schoolYearId : query.schoolYearId);
    if (!schoolYearId) {
      sendJson(res, 400, { error: "missing-school-year", message: "Annee scolaire requise." });
      return;
    }

    const localDate = localDateInKinshasa();
    if (req.method === "GET") {
      const messageCount = await currentQuota({ db, caller, schoolYearId, localDate });
      sendJson(res, 200, { quota: { limit: dailyLimit, messageCount, remaining: Math.max(0, dailyLimit - messageCount), localDate, timeZone: quotaTimeZone } });
      return;
    }

    const recipient = normalizeText(body.recipient);
    const subject = normalizeText(body.subject);
    const messageBody = normalizeText(body.body);
    if (!allowedRecipients.has(recipient)) {
      sendJson(res, 400, { error: "invalid-recipient", message: "Destinataire invalide." });
      return;
    }
    if (!subject || !messageBody) {
      sendJson(res, 400, { error: "invalid-message", message: "Objet et message requis." });
      return;
    }

    const recipientLabels = {
      admin: "Administrateur uniquement",
      cashier: "Caissier uniquement",
      both: "Administrateur et Caissier",
      discipline: "Directeur de Discipline",
    };
    const createdAt = new Date().toISOString();
    const counterId = `${caller.schoolId}__${caller.parentId}__${localDate}`;
    const counterRef = db.doc(`parentDailyMessageLimits/${counterId}`);
    const messageId = uid("msg");
    const notificationId = uid("notif");
    const saved = await db.runTransaction(async (transaction) => {
      const counterSnapshot = await transaction.get(counterRef);
      const existingCount = counterSnapshot.exists
        ? Number(counterSnapshot.data().messageCount ?? 0)
        : await legacySentCount({ db, schoolId: caller.schoolId, schoolYearId, parentId: caller.parentId, localDate });

      if (existingCount >= dailyLimit) {
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
        localDate,
        messageCount: existingCount + 1,
        updatedAt: createdAt,
      }, { merge: true });
      return { message, notification, quota: { limit: dailyLimit, messageCount: existingCount + 1, remaining: Math.max(0, dailyLimit - existingCount - 1), localDate, timeZone: quotaTimeZone } };
    });

    sendJson(res, 200, saved);
  } catch (error) {
    const response = publicError(error);
    console.error("[Acadea parent messaging] Envoi parent echoue.", error);
    sendJson(res, response.statusCode, response.body);
  }
}
