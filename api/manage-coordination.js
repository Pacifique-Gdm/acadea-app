import { randomUUID } from "node:crypto";
import { firebaseAdminPublicError, initAdmin } from "./_lib/firebaseAdmin.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";

export const maxDuration = 300;

function sendJson(res, status, body) { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); }
function text(value) { return String(value ?? "").trim(); }
async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function requireSuperAdmin(req) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) throw Object.assign(new Error("Authentification requise."), { statusCode: 401, code: "unauthenticated" });
  const { auth, db } = initAdmin();
  const caller = await auth.verifyIdToken(token, true);
  if (caller.role !== "super_admin") throw Object.assign(new Error("Action réservée au Super Administrateur."), { statusCode: 403, code: "permission-denied" });
  return { auth, db, caller };
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

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Méthode non autorisée." });
  try {
    const { auth, db, caller } = await requireSuperAdmin(req);
    const input = await body(req);
    const action = text(input.action || "create");
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
    const status = Number(error?.statusCode) || 500; const diagnostic = firebaseAdminPublicError(error, "manage-coordination");
    return sendJson(res, status, { error: diagnostic.message, code: error?.code || diagnostic.code, ...(diagnostic.correlationId ? { correlationId: diagnostic.correlationId } : {}) });
  }
}
