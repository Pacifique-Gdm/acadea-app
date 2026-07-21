import { FieldValue } from "firebase-admin/firestore";
import { initAdmin } from "./_lib/firebaseAdmin.js";

const schoolScopedCollections = [
  "users",
  "schoolYears",
  "students",
  "teachers",
  "parents",
  "classes",
  "feeTypes",
  "payments",
  "expenses",
  "grades",
  "attendance",
  "bulletins",
  "documents",
  "announcements",
  "messages",
  "notifications",
  "auditLogs",
  "valves",
  "conversations",
  "parentDailyMessageLimits",
  "disciplineSanctions",
];

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

function isValidUid(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function addAuthCandidate(candidates, uid, source, data = {}) {
  const normalizedUid = normalizeText(uid);
  if (!normalizedUid) return;
  const current = candidates.get(normalizedUid) ?? {
    uid: normalizedUid,
    sources: new Set(),
    schoolIdConfirmed: false,
    superAdmin: false,
  };
  current.sources.add(source);
  current.schoolIdConfirmed = current.schoolIdConfirmed || data.schoolIdConfirmed === true;
  current.superAdmin = current.superAdmin || data.superAdmin === true;
  candidates.set(normalizedUid, current);
}

function pickSchoolPatch(body) {
  const patch = {};
  for (const key of ["name", "address", "phone", "email", "subscriptionPlan", "subscriptionStatus", "subscriptionAmount"]) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return patch;
}

async function deleteQueryBatch(db, query, batchSize = 250) {
  const snapshot = await query.limit(batchSize).get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
  return snapshot.size + (snapshot.size >= batchSize ? await deleteQueryBatch(db, query, batchSize) : 0);
}

async function collectSchoolAuthUsers(db, schoolId, schoolData) {
  const candidates = new Map();
  const skipped = [];

  const usersSnapshot = await db.collection("users").where("schoolId", "==", schoolId).get();
  usersSnapshot.docs.forEach((document) => {
    const user = document.data() ?? {};
    const superAdmin = user.role === "super_admin";
    const schoolIdConfirmed = user.schoolId === schoolId;
    if (isValidUid(document.id)) {
      addAuthCandidate(candidates, document.id, "users.docId", { schoolIdConfirmed, superAdmin });
    }
    if (isValidUid(user.id) && user.id !== document.id) {
      addAuthCandidate(candidates, user.id, "users.id", { schoolIdConfirmed, superAdmin });
    }
  });

  const parentsSnapshot = await db.collection("parents").where("schoolId", "==", schoolId).get();
  parentsSnapshot.docs.forEach((document) => {
    const parent = document.data() ?? {};
    if (isValidUid(parent.userId)) {
      addAuthCandidate(candidates, parent.userId, "parents.userId", { schoolIdConfirmed: parent.schoolId === schoolId });
    }
  });

  if (isValidUid(schoolData?.mainAdminId)) {
    addAuthCandidate(candidates, schoolData.mainAdminId, "schools.mainAdminId", { schoolIdConfirmed: true });
  }

  const authUsers = [];
  candidates.forEach((candidate) => {
    if (!candidate.schoolIdConfirmed) {
      skipped.push({
        uid: candidate.uid,
        reason: "schoolId non confirme",
        sources: Array.from(candidate.sources),
      });
      return;
    }
    if (candidate.superAdmin) {
      skipped.push({
        uid: candidate.uid,
        reason: "super_admin protege",
        sources: Array.from(candidate.sources),
      });
      return;
    }
    authUsers.push({
      uid: candidate.uid,
      sources: Array.from(candidate.sources),
    });
  });

  return { authUsers, skipped };
}

async function deleteSchoolAuthUsers(auth, authUsers, schoolId) {
  const result = {
    found: authUsers.length,
    deleted: 0,
    alreadyMissing: 0,
    failed: [],
    skipped: [],
  };

  for (const entry of authUsers) {
    if (!isValidUid(entry.uid)) {
      result.skipped.push({ uid: entry.uid ?? "", reason: "UID invalide", sources: entry.sources ?? [] });
      continue;
    }

    try {
      const authUser = await auth.getUser(entry.uid);
      const claims = authUser.customClaims ?? {};
      if (claims.role === "super_admin") {
        result.skipped.push({ uid: entry.uid, reason: "super_admin protege", sources: entry.sources });
        continue;
      }
      if (claims.schoolId && claims.schoolId !== schoolId) {
        result.skipped.push({ uid: entry.uid, reason: "schoolId Auth different", sources: entry.sources });
        continue;
      }

      await auth.deleteUser(entry.uid);
      result.deleted += 1;
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        result.alreadyMissing += 1;
        continue;
      }
      result.failed.push({
        uid: entry.uid,
        code: error?.code ?? "unknown",
        message: error instanceof Error ? error.message : String(error),
        sources: entry.sources,
      });
    }
  }

  return result;
}

async function deleteSchoolData(db, schoolId) {
  const collections = [];
  let deleted = 0;
  for (const collectionName of schoolScopedCollections) {
    const deletedCount = await deleteQueryBatch(db, db.collection(collectionName).where("schoolId", "==", schoolId));
    deleted += deletedCount;
    collections.push({ collection: collectionName, deletedCount });
  }
  const idempotencySignalsCount = await deleteQueryBatch(db, db.collection("messageIdempotency").doc(schoolId).collection("signals"));
  deleted += idempotencySignalsCount;
  collections.push({ collection: `messageIdempotency/${schoolId}/signals`, deletedCount: idempotencySignalsCount });
  await db.doc(`messageIdempotency/${schoolId}`).delete();
  await db.doc(`schools/${schoolId}`).delete();
  collections.push({ collection: "schools", deletedCount: 1 });
  return { deletedCount: deleted + 1, collections };
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
      sendJson(res, 401, { error: "Authentification requise." });
      return;
    }

    const { auth, db } = initAdmin();
    const caller = await auth.verifyIdToken(token, true);
    if (caller.role !== "super_admin") {
      sendJson(res, 403, { error: "Action reservee au super administrateur." });
      return;
    }

    const body = await readBody(req);
    const action = normalizeText(body.action);
    const schoolId = normalizeText(body.schoolId);

    if (!schoolId) {
      sendJson(res, 400, { error: "schoolId requis." });
      return;
    }

    const schoolRef = db.doc(`schools/${schoolId}`);
    const schoolSnapshot = await schoolRef.get();
    if (!schoolSnapshot.exists) {
      sendJson(res, 404, { error: "Ecole introuvable." });
      return;
    }

    if (action === "update") {
      const patch = pickSchoolPatch(body.patch ?? {});
      if (Object.keys(patch).length === 0) {
        sendJson(res, 400, { error: "Aucune modification valide." });
        return;
      }
      await schoolRef.update({ ...patch, updatedAt: new Date().toISOString(), updatedBy: caller.uid });
      const updated = await schoolRef.get();
      sendJson(res, 200, { school: { id: updated.id, ...updated.data() } });
      return;
    }

    if (action === "suspend" || action === "reactivate") {
      const status = action === "suspend" ? "suspended" : "active";
      const subscriptionStatus = action === "suspend" ? "suspended" : "active";
      await schoolRef.update({
        status,
        subscriptionStatus,
        updatedAt: new Date().toISOString(),
        updatedBy: caller.uid,
      });
      const updated = await schoolRef.get();
      sendJson(res, 200, { school: { id: updated.id, ...updated.data() } });
      return;
    }

    if (action === "delete") {
      if (body.confirmation !== "SUPPRIMER ECOLE") {
        sendJson(res, 400, { error: "Confirmation de suppression invalide." });
        return;
      }
      const schoolData = schoolSnapshot.data();
      const collectedAuthUsers = await collectSchoolAuthUsers(db, schoolId, schoolData);
      const authDeletion = await deleteSchoolAuthUsers(auth, collectedAuthUsers.authUsers, schoolId);
      authDeletion.skipped.push(...collectedAuthUsers.skipped);
      const firestoreDeletion = await deleteSchoolData(db, schoolId);
      const status = authDeletion.failed.length > 0 ? "partial" : "complete";
      await db.collection("platform").doc("schoolDeletionLog").collection("entries").add({
        schoolId,
        actorId: caller.uid,
        actorName: caller.email ?? "Super administrateur",
        deletedCount: firestoreDeletion.deletedCount,
        authUsersFound: authDeletion.found,
        authDeleted: authDeletion.deleted,
        authAlreadyMissing: authDeletion.alreadyMissing,
        authFailed: authDeletion.failed.length,
        authSkipped: authDeletion.skipped.length,
        status,
        deletedAt: FieldValue.serverTimestamp(),
      });
      sendJson(res, 200, {
        schoolId,
        deletedCount: firestoreDeletion.deletedCount,
        firestoreDeletedCount: firestoreDeletion.deletedCount,
        authUsersFound: authDeletion.found,
        authDeleted: authDeletion.deleted,
        authAlreadyMissing: authDeletion.alreadyMissing,
        authFailed: authDeletion.failed.length,
        authSkipped: authDeletion.skipped.length,
        authFailures: authDeletion.failed,
        authSkippedUsers: authDeletion.skipped,
        collections: firestoreDeletion.collections,
        status,
      });
      return;
    }

    sendJson(res, 400, { error: "Action invalide." });
  } catch (error) {
    console.error("[Acadea platform] Gestion ecole echouee.", error);
    sendJson(res, 500, {
      error: "Operation ecole impossible. Verifiez les informations et reessayez.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
