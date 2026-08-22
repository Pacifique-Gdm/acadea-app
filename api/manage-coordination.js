import { randomUUID } from "node:crypto";
import { firebaseAdminPublicError, initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { coordinationHttpError, requireActiveCoordinationActor, requireActiveCoordinator, resolveCoordinationSchoolScope } from "./_lib/coordination.js";

export const maxDuration = 300;

function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function text(value) { return String(value ?? "").trim(); }
async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function bearerToken(req) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) throw Object.assign(new Error("Authentification requise."), { statusCode: 401, code: "unauthenticated" });
  return token;
}

async function requireSuperAdmin(auth, token) {
  const caller = await auth.verifyIdToken(token, true);
  if (caller.role !== "super_admin") throw Object.assign(new Error("Action réservée au Super Administrateur."), { statusCode: 403, code: "permission-denied" });
  return caller;
}

function validateSchoolIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) throw Object.assign(new Error("Sélection d'écoles invalide."), { statusCode: 400, code: "invalid-argument" });
  const ids = [...new Set(value.map(text).filter(Boolean))];
  if (ids.length !== value.length) throw Object.assign(new Error("Les écoles doivent être sélectionnées une seule fois."), { statusCode: 400, code: "invalid-argument" });
  return ids;
}

async function activeCoordinationRelations(db, schoolIds) {
  const relations = [];
  for (let index = 0; index < schoolIds.length; index += 30) {
    const snapshot = await db.collection("coordinationSchools").where("schoolId", "in", schoolIds.slice(index, index + 30)).get();
    snapshot.docs.filter((item) => item.data().active === true).forEach((item) => relations.push(item.data()));
  }
  return relations;
}

const SUB_COORDINATION_ACTIONS = new Set(["create-sub-coordination", "add-sub-school", "remove-sub-school", "transfer-sub-school", "archive-sub-coordination", "reactivate-sub-coordination"]);

function validateOptionalSchoolIds(value) {
  if (!Array.isArray(value) || value.length > 100) throw coordinationHttpError(400, "invalid-argument", "Sélection d'écoles invalide.");
  const ids = [...new Set(value.map(text).filter(Boolean))];
  if (ids.length !== value.length) throw coordinationHttpError(400, "invalid-argument", "Les écoles doivent être sélectionnées une seule fois.");
  return ids;
}

function auditPayload({ id, eventType, caller, coordinationId, subCoordinationId, schoolId, action, now, metadata }) {
  return { id, eventType, coordinationId, subCoordinationId, ...(schoolId ? { schoolId } : {}), actorId: caller.uid, actorRole: caller.role, actorName: caller.profile?.name ?? caller.name ?? "Coordinateur", action, result: "success", resourceType: "subCoordination", resourceId: subCoordinationId, source: "server", createdAt: now, ...(metadata ? { metadata } : {}) };
}

async function loadActiveSubAssignments(transaction, db, coordinationId) {
  const snapshot = await transaction.get(db.collection("subCoordinationSchools").where("coordinationId", "==", coordinationId));
  return snapshot.docs.map((item) => ({ id: item.id, ref: item.ref, ...item.data() })).filter((item) => item.active === true);
}

async function validateMainSchoolRelations(transaction, db, coordinationId, schoolIds) {
  const rows = [];
  for (const schoolId of schoolIds) {
    const [relation, school] = await Promise.all([
      transaction.get(db.doc(`coordinationSchools/${coordinationId}__${schoolId}`)),
      transaction.get(db.doc(`schools/${schoolId}`)),
    ]);
    if (!relation.exists || relation.data()?.active !== true || relation.data()?.coordinationId !== coordinationId || relation.data()?.schoolId !== schoolId || !school.exists || school.data()?.status !== "active") {
      throw coordinationHttpError(403, "school-outside-coordination", "Une école n'appartient pas activement à cette Coordination.");
    }
    rows.push({ schoolId, relation, school });
  }
  return rows;
}

async function manageSubCoordination({ res, auth, db, token, input, action }) {
  const caller = await requireActiveCoordinator(auth, db, token);
  await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: `coordination.${action}`, ...API_RATE_LIMITS.PROVISION_SCHOOL });
  const now = new Date().toISOString();

  if (action === "create-sub-coordination") {
    const identity = input.coordinator ?? {};
    const lastName = text(identity.lastName);
    const middleName = text(identity.middleName);
    const firstName = text(identity.firstName);
    const name = [lastName, middleName, firstName].filter(Boolean).join(" ");
    const phone = text(identity.phone);
    const email = text(identity.email).toLowerCase();
    const password = text(identity.password);
    const circumscription = text(input.circumscription);
    const schoolIds = validateOptionalSchoolIds(input.schoolIds);
    if (!name || !phone || !email || !email.includes("@") || password.length < 6 || !circumscription) throw coordinationHttpError(400, "invalid-argument", "Identité, téléphone, e-mail, mot de passe et Circonscription sont requis.");
    const subCoordinationRef = db.collection("subCoordinations").doc();
    const authUser = await auth.createUser({ email, password, displayName: name, disabled: false });
    try {
      await auth.setCustomUserClaims(authUser.uid, { role: "sub_coordination_admin", coordinationId: caller.coordinationId, subCoordinationId: subCoordinationRef.id });
      await db.runTransaction(async (transaction) => {
        await validateMainSchoolRelations(transaction, db, caller.coordinationId, schoolIds);
        const activeAssignments = await loadActiveSubAssignments(transaction, db, caller.coordinationId);
        if (activeAssignments.some((relation) => schoolIds.includes(relation.schoolId))) throw coordinationHttpError(409, "school-already-delegated", "Une école est déjà attribuée à une autre Sous-coordination active.");
        transaction.create(subCoordinationRef, { id: subCoordinationRef.id, coordinationId: caller.coordinationId, coordinatorUserId: authUser.uid, circumscription, status: "active", active: true, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid, archivedAt: null, archivedBy: null, reactivatedAt: null, reactivatedBy: null });
        transaction.create(db.doc(`users/${authUser.uid}`), { id: authUser.uid, name, lastName, middleName: middleName || null, firstName: firstName || null, phone, email, role: "sub_coordination_admin", coordinationId: caller.coordinationId, subCoordinationId: subCoordinationRef.id, status: "active", active: true, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
        for (const schoolId of schoolIds) transaction.set(db.doc(`subCoordinationSchools/${subCoordinationRef.id}__${schoolId}`), { id: `${subCoordinationRef.id}__${schoolId}`, coordinationId: caller.coordinationId, subCoordinationId: subCoordinationRef.id, schoolId, active: true, addedAt: now, addedBy: caller.uid, removedAt: null, removedBy: null });
        const auditRef = db.collection("auditLogs").doc();
        transaction.create(auditRef, auditPayload({ id: auditRef.id, eventType: "subCoordination.created", caller, coordinationId: caller.coordinationId, subCoordinationId: subCoordinationRef.id, action: "Création Sous-coordination", now, metadata: { schoolCount: schoolIds.length, coordinatorUserId: authUser.uid } }));
      });
    } catch (error) {
      await auth.deleteUser(authUser.uid).catch(() => undefined);
      throw error;
    }
    return sendJson(res, 200, { subCoordination: { id: subCoordinationRef.id, coordinationId: caller.coordinationId, coordinatorUserId: authUser.uid, circumscription, status: "active", active: true }, coordinator: { id: authUser.uid, name, email, role: "sub_coordination_admin", coordinationId: caller.coordinationId, subCoordinationId: subCoordinationRef.id }, schoolIds });
  }

  const subCoordinationId = text(input.subCoordinationId);
  if (!subCoordinationId) throw coordinationHttpError(400, "invalid-argument", "subCoordinationId requis.");
  const subRef = db.doc(`subCoordinations/${subCoordinationId}`);
  const subSnapshot = await subRef.get();
  const sub = subSnapshot.exists ? subSnapshot.data() : undefined;
  if (!sub || sub.coordinationId !== caller.coordinationId) throw coordinationHttpError(404, "not-found", "Sous-coordination introuvable.");

  if (action === "archive-sub-coordination" || action === "reactivate-sub-coordination") {
    const archive = action === "archive-sub-coordination";
    if ((archive && sub.active === false) || (!archive && sub.active === true)) return sendJson(res, 200, { subCoordinationId, active: !archive, idempotent: true });
    const authUser = await auth.getUser(sub.coordinatorUserId);
    if (!archive) await auth.setCustomUserClaims(sub.coordinatorUserId, { role: "sub_coordination_admin", coordinationId: caller.coordinationId, subCoordinationId });
    await auth.updateUser(sub.coordinatorUserId, { disabled: archive });
    if (archive) await auth.revokeRefreshTokens(sub.coordinatorUserId);
    try {
      const batch = db.batch();
      batch.update(subRef, archive ? { status: "archived", active: false, archivedAt: now, archivedBy: caller.uid, updatedAt: now, updatedBy: caller.uid } : { status: "active", active: true, archivedAt: null, archivedBy: null, reactivatedAt: now, reactivatedBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
      batch.update(db.doc(`users/${sub.coordinatorUserId}`), archive ? { status: "inactive", active: false, archivedAt: now, archivedBy: caller.uid, updatedAt: now, updatedBy: caller.uid } : { status: "active", active: true, archivedAt: null, archivedBy: null, reactivatedAt: now, reactivatedBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
      const auditRef = db.collection("auditLogs").doc();
      batch.set(auditRef, auditPayload({ id: auditRef.id, eventType: archive ? "subCoordination.archived" : "subCoordination.reactivated", caller, coordinationId: caller.coordinationId, subCoordinationId, action: archive ? "Archivage Sous-coordination" : "Réactivation Sous-coordination", now }));
      await batch.commit();
    } catch (error) {
      await auth.updateUser(sub.coordinatorUserId, { disabled: authUser.disabled }).catch(() => undefined);
      throw error;
    }
    return sendJson(res, 200, { subCoordinationId, active: !archive, idempotent: false });
  }

  if (action === "add-sub-school" && (sub.active !== true || sub.status !== "active")) throw coordinationHttpError(409, "sub-coordination-inactive", "La Sous-coordination est archivée.");
  const schoolId = text(input.schoolId);
  if (!schoolId) throw coordinationHttpError(400, "invalid-argument", "schoolId requis.");
  const targetId = action === "transfer-sub-school" ? text(input.targetSubCoordinationId) : subCoordinationId;
  if (action === "transfer-sub-school" && (!targetId || targetId === subCoordinationId)) throw coordinationHttpError(400, "invalid-argument", "Sous-coordination cible invalide.");
  await db.runTransaction(async (transaction) => {
    await validateMainSchoolRelations(transaction, db, caller.coordinationId, [schoolId]);
    const activeAssignments = await loadActiveSubAssignments(transaction, db, caller.coordinationId);
    const existing = activeAssignments.find((item) => item.schoolId === schoolId);
    if (action === "add-sub-school" && existing && existing.subCoordinationId !== subCoordinationId) throw coordinationHttpError(409, "school-already-delegated", "Cette école est déjà attribuée à une autre Sous-coordination.");
    if (action !== "add-sub-school" && (!existing || existing.subCoordinationId !== subCoordinationId)) throw coordinationHttpError(404, "relation-not-found", "Attribution active introuvable.");
    if (action === "transfer-sub-school") {
      const targetSnapshot = await transaction.get(db.doc(`subCoordinations/${targetId}`));
      if (!targetSnapshot.exists || targetSnapshot.data()?.coordinationId !== caller.coordinationId || targetSnapshot.data()?.active !== true) throw coordinationHttpError(404, "target-not-found", "Sous-coordination cible active introuvable.");
    }
    if (action === "remove-sub-school" || action === "transfer-sub-school") transaction.update(existing.ref, { active: false, removedAt: now, removedBy: caller.uid });
    if (action === "add-sub-school" && !existing) transaction.set(db.doc(`subCoordinationSchools/${subCoordinationId}__${schoolId}`), { id: `${subCoordinationId}__${schoolId}`, coordinationId: caller.coordinationId, subCoordinationId, schoolId, active: true, addedAt: now, addedBy: caller.uid, removedAt: null, removedBy: null }, { merge: true });
    if (action === "add-sub-school" && existing) return;
    if (action === "transfer-sub-school") transaction.set(db.doc(`subCoordinationSchools/${targetId}__${schoolId}`), { id: `${targetId}__${schoolId}`, coordinationId: caller.coordinationId, subCoordinationId: targetId, schoolId, active: true, addedAt: now, addedBy: caller.uid, removedAt: null, removedBy: null }, { merge: true });
    const auditRef = db.collection("auditLogs").doc();
    const eventType = action === "add-sub-school" ? "subCoordination.school.added" : action === "remove-sub-school" ? "subCoordination.school.removed" : "subCoordination.school.transferred";
    const label = action === "add-sub-school" ? "École ajoutée à la Sous-coordination" : action === "remove-sub-school" ? "École retirée de la Sous-coordination" : "École transférée entre Sous-coordinations";
    transaction.create(auditRef, auditPayload({ id: auditRef.id, eventType, caller, coordinationId: caller.coordinationId, subCoordinationId, schoolId, action: label, now, metadata: action === "transfer-sub-school" ? { targetSubCoordinationId: targetId } : undefined }));
  });
  return sendJson(res, 200, { subCoordinationId, schoolId, active: action === "add-sub-school", ...(action === "transfer-sub-school" ? { targetSubCoordinationId: targetId } : {}) });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée." });
  try {
    const token = bearerToken(req);
    const { auth, db } = initAdmin();
    const input = await body(req);
    const action = text(input.action || "create");
    if (action === "read-student-parent") {
      const caller = await requireActiveCoordinationActor(auth, db, token);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.read-student-parent", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
      const studentId = text(input.studentId);
      if (!studentId) throw coordinationHttpError(400, "invalid-argument", "studentId requis.");
      const studentSnapshot = await db.doc(`students/${studentId}`).get();
      const student = studentSnapshot.exists ? studentSnapshot.data() : undefined;
      const schoolIds = new Set(await resolveCoordinationSchoolScope(db, caller));
      if (!student || !schoolIds.has(student.schoolId)) throw coordinationHttpError(404, "not-found", "Élève introuvable dans le périmètre autorisé.");
      if (!student.parentId) return sendJson(res, 200, { parent: null });
      const parentSnapshot = await db.doc(`parents/${student.parentId}`).get();
      const parent = parentSnapshot.exists ? parentSnapshot.data() : undefined;
      if (!parent || parent.schoolId !== student.schoolId || parent.schoolYearId !== student.schoolYearId) return sendJson(res, 200, { parent: null });
      return sendJson(res, 200, { parent: { id: parentSnapshot.id, schoolId: parent.schoolId, schoolYearId: parent.schoolYearId, userId: parent.userId ?? "", fullName: parent.fullName ?? "", phone: parent.phone ?? "", email: parent.email ?? "", address: parent.address ?? "", studentIds: Array.isArray(parent.studentIds) ? parent.studentIds.filter((id) => id === studentId) : [], status: parent.status === "inactive" ? "inactive" : "active" } });
    }
    if (action === "read-personnel-profile") {
      const caller = await requireActiveCoordinationActor(auth, db, token);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.read-personnel-profile", ...API_RATE_LIMITS.MESSAGE_RECIPIENTS });
      const personnelId = text(input.personnelId);
      if (!personnelId) throw coordinationHttpError(400, "invalid-argument", "personnelId requis.");
      const personnelSnapshot = await db.doc(`users/${personnelId}`).get();
      const personnel = personnelSnapshot.exists ? personnelSnapshot.data() : undefined;
      const schoolIds = new Set(await resolveCoordinationSchoolScope(db, caller));
      const internalRoles = new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]);
      if (!personnel || !internalRoles.has(personnel.role) || !schoolIds.has(personnel.schoolId)) throw coordinationHttpError(404, "not-found", "Personnel introuvable dans le périmètre autorisé.");
      const profileSnapshot = await db.doc(`personnelProfiles/${personnelId}`).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
      if (!profile || profile.schoolId !== personnel.schoolId || profile.personnelId !== personnelId) return sendJson(res, 200, { profile: null });
      const allowed = ["matricule", "photoUrl", "lastName", "middleName", "firstName", "jobTitle", "gender", "birthDate", "birthPlace", "address", "engagementDate", "contractType", "educationLevel", "diploma", "specialty", "trainingInstitution", "graduationYear", "emergencyContactName", "emergencyContactRelationship", "emergencyContactPhone", "observations", "createdAt", "updatedAt"];
      const safeProfile = { id: profileSnapshot.id, schoolId: profile.schoolId, personnelId };
      allowed.forEach((key) => { if (profile[key] !== undefined) safeProfile[key] = profile[key]; });
      return sendJson(res, 200, { profile: safeProfile });
    }
    if (SUB_COORDINATION_ACTIONS.has(action)) return await manageSubCoordination({ res, auth, db, token, input, action });
    if (action === "update-settings") {
      const caller = await requireActiveCoordinator(auth, db, token);
      await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: caller.coordinationId, action: "coordination.settings_updated", ...API_RATE_LIMITS.PROVISION_SCHOOL });
      const values = {
        name: text(input.name),
        code: text(input.code),
        phone: text(input.phone),
        email: text(input.email).toLowerCase(),
        address: text(input.address),
        logoUrl: text(input.logoUrl),
      };
      if (!values.name || (values.email && !values.email.includes("@"))) throw coordinationHttpError(400, "invalid-argument", "Nom et e-mail valides requis.");
      if (values.logoUrl && values.logoUrl.length > 2_000_000) throw coordinationHttpError(400, "invalid-argument", "Le logo est trop volumineux.");
      const now = new Date().toISOString();
      const coordinationRef = db.doc(`coordinations/${caller.coordinationId}`);
      const auditRef = db.collection("auditLogs").doc();
      const batch = db.batch();
      batch.update(coordinationRef, { ...values, updatedAt: now, updatedBy: caller.uid });
      batch.create(auditRef, { id: auditRef.id, eventType: "coordination.settings_updated", coordinationId: caller.coordinationId, actorId: caller.uid, actorRole: caller.role, actorName: caller.profile?.name ?? "Coordinateur", action: "Paramètres Coordination modifiés", result: "success", resourceType: "coordination", resourceId: caller.coordinationId, source: "server", createdAt: now, metadata: { fields: Object.keys(values) } });
      await batch.commit();
      return sendJson(res, 200, { coordinationId: caller.coordinationId, updatedAt: now });
    }
    const caller = await requireSuperAdmin(auth, token);
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: "platform", action: `coordination.${action}`, ...API_RATE_LIMITS.PROVISION_SCHOOL });
    const now = new Date().toISOString();
    if (action === "create") {
      const name = text(input.name); const schoolIds = validateSchoolIds(input.schoolIds);
      const coordinator = input.coordinator ?? {};
      const coordinatorName = text(coordinator.name); const email = text(coordinator.email).toLowerCase(); const password = text(coordinator.password);
      if (!name || !coordinatorName || !email || password.length < 6) throw Object.assign(new Error("Nom, coordonnées et mot de passe du Coordinateur requis."), { statusCode: 400, code: "invalid-argument" });
      const schoolSnapshots = await Promise.all(schoolIds.map((id) => db.doc(`schools/${id}`).get()));
      if (schoolSnapshots.some((snapshot) => !snapshot.exists)) throw Object.assign(new Error("Une école sélectionnée est introuvable."), { statusCode: 404, code: "not-found" });
      const existingRelations = await activeCoordinationRelations(db, schoolIds);
      if (existingRelations.length || schoolSnapshots.some((snapshot) => typeof snapshot.data()?.activeCoordinationId === "string" && snapshot.data().activeCoordinationId)) throw Object.assign(new Error("Une école appartient déjà à une Coordination active."), { statusCode: 409, code: "already-exists" });
      const coordinationRef = db.collection("coordinations").doc();
      const authUser = await auth.createUser({ email, password, displayName: coordinatorName, disabled: false });
      const userRef = db.doc(`users/${authUser.uid}`);
      try {
        await auth.setCustomUserClaims(authUser.uid, { role: "coordination_admin", coordinationId: coordinationRef.id });
        const batch = db.batch();
        batch.set(coordinationRef, { id: coordinationRef.id, name, code: text(input.code) || null, status: "active", phone: text(input.phone) || null, email: text(input.email).toLowerCase() || null, address: text(input.address) || null, principalCoordinatorUserId: authUser.uid, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
        batch.set(userRef, { id: authUser.uid, name: coordinatorName, email, role: "coordination_admin", coordinationId: coordinationRef.id, status: "active", active: true, createdAt: now, createdBy: caller.uid });
        for (const schoolId of schoolIds) {
          batch.set(db.doc(`coordinationSchools/${coordinationRef.id}__${schoolId}`), { id: `${coordinationRef.id}__${schoolId}`, coordinationId: coordinationRef.id, schoolId, active: true, addedAt: now, addedBy: caller.uid });
          batch.update(db.doc(`schools/${schoolId}`), { activeCoordinationId: coordinationRef.id, updatedAt: now });
        }
        const auditRef = db.collection("auditLogs").doc(`coordination-created-${randomUUID()}`);
        batch.set(auditRef, { id: auditRef.id, eventType: "coordination.created", coordinationId: coordinationRef.id, actorId: caller.uid, actorRole: caller.role, actorName: caller.name ?? "Super Administrateur", action: "Création Coordination", resourceType: "coordination", resourceId: coordinationRef.id, source: "server", createdAt: now, metadata: { schoolCount: schoolIds.length, coordinatorUserId: authUser.uid } });
        await batch.commit();
      } catch (error) { await auth.deleteUser(authUser.uid).catch(() => undefined); throw error; }
      return sendJson(res, 200, { coordination: { id: coordinationRef.id, name, status: "active", principalCoordinatorUserId: authUser.uid }, coordinator: { id: authUser.uid, name: coordinatorName, email, role: "coordination_admin", coordinationId: coordinationRef.id }, schoolIds });
    }
    const coordinationId = text(input.coordinationId); if (!coordinationId) throw Object.assign(new Error("coordinationId requis."), { statusCode: 400, code: "invalid-argument" });
    const coordinationRef = db.doc(`coordinations/${coordinationId}`); const coordinationSnapshot = await coordinationRef.get();
    if (!coordinationSnapshot.exists) throw Object.assign(new Error("Coordination introuvable."), { statusCode: 404, code: "not-found" });
    if (action === "add-school" || action === "remove-school") {
      const schoolId = text(input.schoolId); const schoolRef = db.doc(`schools/${schoolId}`); const schoolSnapshot = schoolId ? await schoolRef.get() : null;
      if (!schoolId || !schoolSnapshot?.exists) throw Object.assign(new Error("École introuvable."), { statusCode: 404, code: "not-found" });
      const relationRef = db.doc(`coordinationSchools/${coordinationId}__${schoolId}`); const relation = await relationRef.get();
      const batch = db.batch();
      if (action === "add-school") {
        const existingRelations = await activeCoordinationRelations(db, [schoolId]);
        if (existingRelations.some((item) => item.coordinationId !== coordinationId)) throw Object.assign(new Error("Cette école appartient déjà à une autre Coordination."), { statusCode: 409, code: "already-exists" });
        if (schoolSnapshot.data()?.activeCoordinationId && schoolSnapshot.data().activeCoordinationId !== coordinationId) throw Object.assign(new Error("Cette école appartient déjà à une autre Coordination."), { statusCode: 409, code: "already-exists" });
        batch.set(relationRef, { id: relationRef.id, coordinationId, schoolId, active: true, addedAt: now, addedBy: caller.uid, removedAt: null, removedBy: null, ...(relation.exists && relation.data()?.removedAt ? { previousRemovedAt: relation.data().removedAt } : {}) }, { merge: true });
        batch.update(schoolRef, { activeCoordinationId: coordinationId, updatedAt: now });
      }
      else {
        if (!relation.exists || relation.data()?.coordinationId !== coordinationId || relation.data()?.schoolId !== schoolId) throw Object.assign(new Error("Rattachement introuvable."), { statusCode: 404, code: "not-found" });
        batch.set(relationRef, { active: false, removedAt: now, removedBy: caller.uid }, { merge: true });
        if (schoolSnapshot.data()?.activeCoordinationId === coordinationId) batch.update(schoolRef, { activeCoordinationId: null, updatedAt: now });
      }
      const auditRef = db.collection("auditLogs").doc();
      batch.set(auditRef, { id: auditRef.id, eventType: action === "add-school" ? "coordination.school.added" : "coordination.school.removed", coordinationId, schoolId, actorId: caller.uid, actorRole: caller.role, actorName: caller.name ?? "Super Administrateur", action: action === "add-school" ? "École ajoutée à la Coordination" : "École retirée de la Coordination", source: "server", createdAt: now });
      await batch.commit();
      return sendJson(res, 200, { coordinationId, schoolId, active: action === "add-school" });
    }
    throw Object.assign(new Error("Action invalide."), { statusCode: 400, code: "invalid-argument" });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    const status = Number(error?.statusCode) || 500;
    if (status < 500) return sendJson(res, status, { error: error.message, code: error?.code || "invalid-request" });
    const diagnostic = firebaseAdminPublicError(error, "manage-coordination");
    return sendJson(res, status, { error: diagnostic.message, code: diagnostic.code, ...(diagnostic.correlationId ? { correlationId: diagnostic.correlationId } : {}) });
  }
}
