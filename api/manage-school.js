import { randomUUID } from "node:crypto";
import { firebaseAdminPublicError, initAdmin } from "./_lib/firebaseAdmin.js";
import { deleteSchoolCompletely } from "./_lib/schoolDeletion.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./_lib/serverAudit.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";

export const maxDuration = 300;

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

function normalizeText(value) {
  return String(value ?? "").trim();
}

function pickSchoolPatch(body) {
  const patch = {};
  for (const key of ["name", "address", "phone", "email", "subscriptionPlan", "subscriptionStatus", "subscriptionAmount"]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return patch;
}


export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Methode non autorisee." });
    return;
  }

  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

    if (!token) {
      sendJson(res, 401, { error: "Authentification requise.", code: "unauthenticated" });
      return;
    }

    const { auth, db, bucket } = initAdmin();
    const caller = await auth.verifyIdToken(token, true);
    if (caller.role !== "super_admin") {
      sendJson(res, 403, { error: "Action reservee au super administrateur.", code: "permission-denied" });
      return;
    }

    const body = await readBody(req);
    const requestedAction = normalizeText(body.action);
    const action = ["update", "suspend", "reactivate", "delete"].includes(requestedAction) ? requestedAction : "invalid";
    const schoolId = normalizeText(body.schoolId);

    if (!schoolId) {
      sendJson(res, 400, { error: "schoolId requis.", code: "invalid-argument" });
      return;
    }
    const rate = action === "delete" ? API_RATE_LIMITS.SCHOOL_DELETE : API_RATE_LIMITS.SCHOOL_ADMIN;
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: "platform", action: `school.${action || "unknown"}`, ...rate });

    const schoolRef = db.doc(`schools/${schoolId}`);
    const schoolSnapshot = await schoolRef.get();
    if (!schoolSnapshot.exists) {
      if (action === "delete" && body.confirmation === "SUPPRIMER ECOLE") {
        sendJson(res, 200, { schoolId, status: "complete", alreadyDeleted: true, deletedCount: 0, firestoreDeletedCount: 0, authDeleted: 0, storageDeleted: 0, collections: [] });
        return;
      }
      sendJson(res, 404, { error: "Ecole introuvable.", code: "not-found" });
      return;
    }

    if (action === "update") {
      const patch = pickSchoolPatch(body.patch ?? {});
      if (Object.keys(patch).length === 0) {
        sendJson(res, 400, { error: "Aucune modification valide.", code: "invalid-argument" });
        return;
      }
      const auditRef = db.collection("auditLogs").doc(`school-update-${randomUUID()}`);
      const batch = db.batch();
      batch.update(schoolRef, { ...patch, updatedAt: new Date().toISOString(), updatedBy: caller.uid });
      batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.SCHOOL_UPDATED, actor: caller, schoolId, resourceType: "school", resourceId: schoolId, metadata: { fieldsChanged: Object.keys(patch).join(",") } }));
      await batch.commit();
      const updated = await schoolRef.get();
      sendJson(res, 200, { school: { id: updated.id, ...updated.data() } });
      return;
    }

    if (action === "suspend" || action === "reactivate") {
      const status = action === "suspend" ? "suspended" : "active";
      const subscriptionStatus = action === "suspend" ? "suspended" : "active";
      const auditRef = db.collection("auditLogs").doc(`school-status-${randomUUID()}`);
      const batch = db.batch();
      batch.update(schoolRef, {
        status,
        subscriptionStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: caller.uid,
      });
      batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: action === "suspend" ? AUDIT_EVENT_TYPES.SCHOOL_SUSPENDED : AUDIT_EVENT_TYPES.SCHOOL_REACTIVATED, actor: caller, schoolId, resourceType: "school", resourceId: schoolId, metadata: { status } }));
      await batch.commit();
      const updated = await schoolRef.get();
      sendJson(res, 200, { school: { id: updated.id, ...updated.data() } });
      return;
    }

    if (action === "delete") {
      if (body.confirmation !== "SUPPRIMER ECOLE") {
        sendJson(res, 400, { error: "Confirmation de suppression invalide.", code: "invalid-argument" });
        return;
      }
      const report = await deleteSchoolCompletely({ db, auth, bucket, schoolId, schoolData: schoolSnapshot.data(), actor: caller });
      sendJson(res, 200, {
        schoolId,
        deletedCount: report.firestore.deleted,
        firestoreDeletedCount: report.firestore.deleted,
        authUsersFound: report.auth.found,
        authDeleted: report.auth.deleted,
        authAlreadyMissing: report.auth.alreadyMissing,
        authFailed: report.auth.failed.length,
        authSkipped: report.auth.skipped,
        storageDeleted: report.storageDeleted,
        collections: report.firestore.collections,
        status: report.status,
      });
      return;
    }

    sendJson(res, 400, { error: "Action invalide.", code: "invalid-argument" });
  } catch (error) {
    if (sendRateLimitError(res, error)) return;
    console.error("[Acadea platform] Gestion ecole echouee.", error);
    const diagnostic = firebaseAdminPublicError(error);
    sendJson(res, 500, {
      error: "Operation ecole impossible. Verifiez les informations et reessayez.",
      code: diagnostic.code,
      details: diagnostic.details,
    });
  }
}
