import { createHash } from "node:crypto";
import { cachedSchoolSearchEntries, normalizeSearchText, searchSchoolEntries, searchWords } from "./schoolSearchIndex.js";

/** Messagerie du Super administrateur et réponses (lot 23, décisions du propriétaire du 16/11) :
 * - le Super administrateur écrit aux coordinations, sous-coordinations et administrateurs d'école ;
 * - ils peuvent lui répondre ;
 * - le personnel de l'école (pas les parents) peut répondre à un message de la Coordination
 *   ou de la Sous-coordination. */
export const PLATFORM_RECIPIENT_ROLES = new Set(["coordination_admin", "sub_coordination_admin", "school_admin"]);
const COORDINATION_ROLES = new Set(["coordination_admin", "sub_coordination_admin"]);
const SCHOOL_STAFF_ROLES = new Set(["school_admin", "secretary", "cashier", "discipline_director", "study_director", "teacher"]);
export const SENDER_ROLE_LABELS = Object.freeze({
  super_admin: "Équipe ACADÉA", coordination_admin: "Coordinateur", sub_coordination_admin: "Sous-coordinateur",
  school_admin: "Administrateur", secretary: "Secrétaire", cashier: "Caissier", discipline_director: "Directeur de discipline",
  study_director: "Directeur des études", teacher: "Enseignant", parent: "Parent",
});

const fail = (statusCode, code, message) => { throw Object.assign(new Error(message), { statusCode, code }); };
const text = (value, max = 5000) => String(value ?? "").trim().slice(0, max);
const role = (value) => (value === "admin" ? "school_admin" : value);
const active = (value) => Boolean(value) && value.active !== false && value.status !== "inactive" && value.status !== "archived" && !value.archivedAt;
export const stableId = (prefix, ...parts) => `${prefix}-${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24)}`;

/** Nom affiché de l'expéditeur : jamais un identifiant technique. */
export function displayName(profile, fallbackRole) {
  // Lot 25 : le Super administrateur apparaît toujours comme « Équipe ACADÉA ».
  if (role(fallbackRole ?? profile?.role) === "super_admin") return "Équipe ACADÉA";
  const name = text(profile?.displayName ?? profile?.name ?? profile?.fullName, 160);
  return name || SENDER_ROLE_LABELS[role(fallbackRole)] || "Utilisateur";
}

export async function requireActiveSuperAdmin(db, decoded) {
  if (decoded?.role !== "super_admin") fail(403, "not-authorized", "Action réservée au Super administrateur.");
  const snapshot = await db.doc(`users/${decoded.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.role !== "super_admin" || !active(profile)) fail(403, "not-authorized", "Profil Super administrateur inactif.");
  return { uid: decoded.uid, role: "super_admin", profile };
}

/** « Marie Kabila (Caissier) », ou « l'Équipe ACADÉA » / « Équipe ACADÉA ». */
export function personLabel(profile, roleKey, article = false) {
  if (role(roleKey) === "super_admin") return article ? "l'Équipe ACADÉA" : "Équipe ACADÉA";
  return `${displayName(profile, roleKey)} (${SENDER_ROLE_LABELS[role(roleKey)] ?? "Personnel"})`;
}

/** « À : … » d'un message envoyé : un à trois noms avec rôle, sinon le nombre de destinataires. */
export function recipientsLabel(recipients) {
  if (recipients.length <= 3) return recipients.map((item) => personLabel(item, item.role)).join(", ");
  const roles = [...new Set(recipients.map((item) => role(item.role)))];
  const plural = { parent: "parents", teacher: "enseignants", cashier: "caissiers", secretary: "secrétaires", school_admin: "administrateurs", discipline_director: "directeurs de discipline", study_director: "directeurs des études" };
  return roles.length === 1 && plural[roles[0]] ? `${recipients.length} ${plural[roles[0]]}` : `${recipients.length} destinataires`;
}

async function activeSchoolYear(db, schoolId) {
  const school = (await db.doc(`schools/${schoolId}`).get()).data();
  return school?.status === "active" && typeof school.activeSchoolYearId === "string" && school.activeSchoolYearId ? school.activeSchoolYearId : "";
}

/** Lot SA-6 : destinataires du Super administrateur cherchés par nom, page par page.
 * - Administrateurs d'école : on cherche l'ÉCOLE (nom, sigle, ville, e-mail) dans la liste de recherche
 *   des écoles du lot 2a (16 petits documents, gardés 20 s), puis on lit seulement les administrateurs
 *   des 25 écoles de la page. Plus aucune lecture de tous les administrateurs de la plateforme.
 * - Coordinations et sous-coordinations (peu nombreuses) : lues une fois, gardées 60 s dans le serveur,
 *   puis cherchées par nom de la personne ou de la coordination.
 * Si la liste de recherche des écoles n'est pas prête, la recherche des administrateurs reste possible
 * par leur nom (ancienne lecture complète, seulement dans ce cas). */
export const RECIPIENT_PAGE_SIZE = 25;
export const COORDINATOR_CACHE_MS = 60_000;
const RECIPIENT_ROLES = ["coordination_admin", "sub_coordination_admin", "school_admin"];
const SCHOOL_ADMIN_ROLES = ["school_admin", "admin"];
/** Firestore : 30 combinaisons au plus par requête « in » ; 15 écoles × 2 rôles = 30. */
const SCHOOL_CHUNK = 15;

const recipientRow = (profile, place) => ({
  uid: profile.id, name: displayName(profile, profile.role), role: role(profile.role),
  schoolId: profile.schoolId ?? null, coordinationId: profile.coordinationId ?? null, place: place ?? "",
});
const byName = (a, b) => a.name.localeCompare(b.name, "fr") || a.uid.localeCompare(b.uid);
const matches = (words, ...values) => {
  const haystack = values.map((value) => normalizeSearchText(value)).join(" | ");
  const compact = haystack.replace(/ /g, "");
  return words.every((word) => haystack.includes(word) || compact.includes(word));
};
const pageOf = (rows, page) => rows.slice(page * RECIPIENT_PAGE_SIZE, (page + 1) * RECIPIENT_PAGE_SIZE);

export function parseRecipientSearch(query = {}) {
  const pick = (value) => (Array.isArray(value) ? value[0] : value);
  const requestedRole = pick(query.role);
  const requestedPage = Number(pick(query.page));
  return {
    role: RECIPIENT_ROLES.includes(requestedRole) ? requestedRole : "coordination_admin",
    query: typeof pick(query.q) === "string" ? pick(query.q).slice(0, 120) : "",
    page: Number.isInteger(requestedPage) && requestedPage >= 0 && requestedPage < 10_000 ? requestedPage : 0,
  };
}

const coordinatorCache = new Map();
export function resetRecipientCaches() { coordinatorCache.clear(); }

/** Coordinateurs (ou sous-coordinateurs) actifs, avec le nom de leur coordination. Gardés 60 s. */
async function coordinatorRows(db, roleKey, now) {
  const cached = coordinatorCache.get(roleKey);
  if (cached && now - cached.at < COORDINATOR_CACHE_MS) return cached.rows;
  const snapshot = await db.collection("users").where("role", "==", roleKey).get();
  const profiles = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter(active);
  const coordinationIds = [...new Set(profiles.map((profile) => profile.coordinationId).filter((id) => typeof id === "string" && id && !id.includes("/")))];
  const names = new Map();
  if (coordinationIds.length) {
    const coordinations = await db.getAll(...coordinationIds.map((id) => db.doc(`coordinations/${id}`)));
    for (const item of coordinations) if (item.exists) names.set(item.id, text(item.data()?.name, 160));
  }
  const rows = profiles.map((profile) => recipientRow(profile, names.get(profile.coordinationId) ?? "")).sort(byName);
  coordinatorCache.set(roleKey, { at: now, rows });
  return rows;
}

/** Administrateurs actifs des écoles données (2 requêtes au plus pour 25 écoles). */
async function schoolAdminsOf(db, schoolIds) {
  const profiles = [];
  for (let start = 0; start < schoolIds.length; start += SCHOOL_CHUNK) {
    const snapshot = await db.collection("users").where("schoolId", "in", schoolIds.slice(start, start + SCHOOL_CHUNK)).where("role", "in", SCHOOL_ADMIN_ROLES).get();
    profiles.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter(active));
  }
  return profiles;
}

export async function searchPlatformRecipients(db, request, { schoolEntries = cachedSchoolSearchEntries, now = Date.now() } = {}) {
  const { role: roleKey, query, page } = parseRecipientSearch(request);
  const words = searchWords(query);
  if (roleKey !== "school_admin") {
    const rows = (await coordinatorRows(db, roleKey, now)).filter((row) => matches(words, row.name, row.place));
    return { role: roleKey, page, pageSize: RECIPIENT_PAGE_SIZE, total: rows.length, unit: "recipients", recipients: pageOf(rows, page) };
  }
  const entries = await schoolEntries(db);
  if (!entries) {
    // Liste de recherche des écoles absente : ancienne lecture, filtrée sur le nom de la personne.
    const snapshot = await db.collection("users").where("role", "in", SCHOOL_ADMIN_ROLES).get();
    const rows = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).filter(active)
      .map((profile) => recipientRow(profile, "")).filter((row) => matches(words, row.name)).sort(byName);
    return { role: roleKey, page, pageSize: RECIPIENT_PAGE_SIZE, total: rows.length, unit: "recipients", recipients: pageOf(rows, page) };
  }
  const result = searchSchoolEntries(entries, { query, sort: "az", page, pageSize: RECIPIENT_PAGE_SIZE });
  const profiles = await schoolAdminsOf(db, result.schools.map((school) => school.id));
  const recipients = [];
  const emptySchools = [];
  for (const school of result.schools) {
    const admins = profiles.filter((profile) => profile.schoolId === school.id).map((profile) => recipientRow(profile, school.name)).sort(byName);
    if (admins.length) recipients.push(...admins);
    else emptySchools.push({ id: school.id, name: school.name });
  }
  return { role: roleKey, page, pageSize: RECIPIENT_PAGE_SIZE, total: result.total, unit: "schools", recipients, emptySchools };
}

/** Document de message + notification, dans la portée qui permet au destinataire de les lire. */
async function platformDocuments(db, { sender, recipient, subject, body, idempotencyKey, replyToMessageId, now }) {
  const messageId = stableId("plat-msg", sender.uid, idempotencyKey, recipient.id);
  // Lot 25 : une réponse d'école au Super administrateur garde l'école de l'expéditeur, pour figurer dans SA messagerie.
  const scopeSchoolId = role(recipient.role) !== "super_admin" ? recipient.schoolId : sender.schoolId;
  const schoolScope = scopeSchoolId ? { schoolId: scopeSchoolId, schoolYearId: await activeSchoolYear(db, scopeSchoolId) } : {};
  if (schoolScope.schoolId && !schoolScope.schoolYearId) fail(409, "school-year-missing", "L'école du destinataire n'a pas d'année scolaire active.");
  const senderScope = sender.schoolId ? { senderSchoolId: sender.schoolId } : sender.coordinationId ? { coordinationId: sender.coordinationId } : {};
  const message = {
    id: messageId, platformMessage: true, senderId: sender.uid, senderName: displayName(sender.profile, sender.role), senderRole: sender.role,
    recipientIds: [recipient.id], participantIds: [sender.uid, recipient.id], recipientParentId: "school", subject, body, createdAt: now,
    recipientLabel: personLabel(recipient, recipient.role),
    ...schoolScope, ...senderScope, ...(recipient.coordinationId && !schoolScope.schoolId ? { coordinationId: recipient.coordinationId } : {}),
    ...(replyToMessageId ? { replyToMessageId } : {}),
  };
  const notificationId = stableId("plat-notif", messageId, recipient.id);
  const notification = {
    id: notificationId, platformMessage: true, recipientUserId: recipient.id, audienceRoles: [role(recipient.role)], messageId, type: "message",
    title: `${replyToMessageId ? "Réponse" : "Nouveau message"} de ${personLabel(sender.profile, sender.role, true)}`, body: subject, createdAt: now, read: false,
    ...schoolScope,
  };
  return { message, notification };
}

/** Envoi du Super administrateur (1 à 200 destinataires choisis). */
export async function sendPlatformMessage(db, caller, input) {
  const subject = text(input.subject, 200), body = text(input.body), idempotencyKey = text(input.idempotencyKey, 128);
  const recipientIds = Array.isArray(input.recipientIds) ? [...new Set(input.recipientIds.map((item) => text(item, 128)).filter(Boolean))] : [];
  if (!subject || !body || !idempotencyKey || !recipientIds.length || recipientIds.length > 200) fail(400, "invalid-argument", "Objet, message et destinataires sont requis.");
  const requestRef = db.doc(`platformMessageRequests/${stableId("plat-request", caller.uid, idempotencyKey)}`);
  const existing = await requestRef.get();
  if (existing.exists) return { messageIds: existing.data().messageIds ?? [], idempotent: true };
  const snapshots = await db.getAll(...recipientIds.map((id) => db.doc(`users/${id}`)));
  const recipients = snapshots.map((snapshot) => (snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null));
  if (recipients.some((recipient) => !recipient || !active(recipient) || !PLATFORM_RECIPIENT_ROLES.has(role(recipient.role)))) fail(403, "invalid-recipient", "Destinataire introuvable ou non autorisé.");
  const now = new Date().toISOString();
  const batch = db.batch(), messageIds = [];
  for (const recipient of recipients) {
    const { message, notification } = await platformDocuments(db, { sender: caller, recipient, subject, body, idempotencyKey, now });
    batch.set(db.doc(`messages/${message.id}`), message);
    batch.set(db.doc(`notifications/${notification.id}`), notification);
    messageIds.push(message.id);
  }
  batch.create(requestRef, { id: requestRef.id, actorId: caller.uid, messageIds, createdAt: now });
  const auditRef = db.collection("auditLogs").doc();
  batch.set(auditRef, { id: auditRef.id, eventType: "platform.message.sent", actorId: caller.uid, actorRole: "super_admin", actorName: displayName(caller.profile, "super_admin"), action: "Message Super administrateur envoyé", source: "server", createdAt: now, metadata: { recipientCount: recipients.length } });
  await batch.commit();
  return { messageIds, idempotent: false };
}

/** Chemin d'une réponse : « platform » (au Super administrateur), « coordination », ou null pour une
 * réponse ordinaire entre membres d'une même école, qui garde l'envoi normal (comme avant le lot 23). */
export async function replyRoute(db, replyToMessageId) {
  const id = text(replyToMessageId, 160);
  if (!id || id.includes("/")) return null;
  const snapshot = await db.doc(`messages/${id}`).get();
  const senderRole = role(snapshot.exists ? snapshot.data()?.senderRole : undefined);
  if (senderRole === "super_admin") return "platform";
  if (COORDINATION_ROLES.has(senderRole)) return "coordination";
  return null;
}

/** Réponse à un message reçu : contrôle que l'appelant en est bien destinataire et que
 * le chemin de retour est autorisé. Renvoie l'expéditeur d'origine (destinataire de la réponse). */
export async function resolveReplyTarget(db, caller, replyToMessageId) {
  const id = text(replyToMessageId, 160);
  if (!id || id.includes("/")) fail(400, "invalid-argument", "Message d'origine invalide.");
  const originalSnapshot = await db.doc(`messages/${id}`).get();
  const original = originalSnapshot.exists ? originalSnapshot.data() : undefined;
  if (!original || !Array.isArray(original.recipientIds) || !original.recipientIds.includes(caller.uid)) fail(403, "invalid-recipient", "Vous n'êtes pas destinataire de ce message.");
  const targetSnapshot = await db.doc(`users/${original.senderId}`).get();
  const target = targetSnapshot.exists ? { id: targetSnapshot.id, ...targetSnapshot.data() } : undefined;
  if (!target || !active(target)) fail(403, "invalid-recipient", "L'expéditeur n'est plus actif.");
  const targetRole = role(target.role), callerRole = role(caller.role);
  if (targetRole === "super_admin") {
    if (!PLATFORM_RECIPIENT_ROLES.has(callerRole)) fail(403, "invalid-recipient", "Réponse au Super administrateur non autorisée.");
    return { target, original, kind: "platform" };
  }
  if (COORDINATION_ROLES.has(targetRole)) {
    if (!SCHOOL_STAFF_ROLES.has(callerRole)) fail(403, "invalid-recipient", "Les parents ne peuvent pas répondre à la Coordination.");
    if (original.schoolId !== caller.schoolId || target.coordinationId !== original.coordinationId) fail(403, "invalid-recipient", "Message hors de votre école.");
    return { target, original, kind: "coordination" };
  }
  fail(400, "invalid-recipient", "Réponse non prise en charge par ce chemin.");
}

/** Réponse au Super administrateur (depuis une école ou une coordination). */
export async function sendPlatformReply(db, caller, input) {
  const { target } = await resolveReplyTarget(db, caller, input.replyToMessageId);
  const body = text(input.body), subject = text(input.subject, 200) || "Réponse", idempotencyKey = text(input.idempotencyKey, 128);
  if (!body || !idempotencyKey) fail(400, "invalid-argument", "Message requis.");
  const { message, notification } = await platformDocuments(db, { sender: caller, recipient: target, subject, body, idempotencyKey, replyToMessageId: text(input.replyToMessageId, 160), now: new Date().toISOString() });
  const batch = db.batch();
  batch.set(db.doc(`messages/${message.id}`), message);
  batch.set(db.doc(`notifications/${notification.id}`), notification);
  await batch.commit();
  return { message };
}

/** Réponse du personnel de l'école à la Coordination ou à la Sous-coordination. */
export async function sendCoordinationReply(db, caller, input) {
  const { target, original } = await resolveReplyTarget(db, caller, input.replyToMessageId);
  const body = text(input.body), subject = text(input.subject, 200) || `Re : ${text(original.subject, 180)}`, idempotencyKey = text(input.idempotencyKey, 128);
  if (!body || !idempotencyKey) fail(400, "invalid-argument", "Message requis.");
  const schoolYearId = text(input.schoolYearId, 120) || original.schoolYearId;
  const now = new Date().toISOString();
  const messageId = stableId("coord-reply", caller.uid, idempotencyKey);
  const senderName = displayName(caller.profile, caller.role);
  const message = {
    id: messageId, coordinationId: original.coordinationId, ...(original.subCoordinationId ? { subCoordinationId: original.subCoordinationId } : {}),
    schoolId: caller.schoolId, schoolYearId, senderId: caller.uid, senderName, senderRole: role(caller.role),
    recipientIds: [target.id], participantIds: [caller.uid, target.id], recipientParentId: "school", subject, body, createdAt: now, replyToMessageId: original.id,
    recipientLabel: personLabel(target, target.role),
  };
  const notificationId = stableId("notif", messageId, target.id);
  const batch = db.batch();
  batch.set(db.doc(`messages/${messageId}`), message);
  batch.set(db.doc(`notifications/${notificationId}`), {
    id: notificationId, coordinationId: original.coordinationId, ...(original.subCoordinationId ? { subCoordinationId: original.subCoordinationId } : {}),
    schoolId: caller.schoolId, schoolYearId, recipientUserId: target.id, audienceRoles: [role(target.role)], messageId, type: "message",
    title: `Réponse de ${senderName} (${SENDER_ROLE_LABELS[role(caller.role)]})`, body: subject, createdAt: now, read: false,
  });
  await batch.commit();
  return { message };
}
