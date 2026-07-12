import { existsSync, readFileSync } from "node:fs";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
  "disciplineSanctions",
];

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

async function deleteQueryBatch(db, query, batchSize = 250) {
  const snapshot = await query.limit(batchSize).get();
  if (snapshot.empty) return 0;

  const batch = db.batch();
  snapshot.docs.forEach((document) => batch.delete(document.ref));
  await batch.commit();
  return snapshot.size + (snapshot.size >= batchSize ? await deleteQueryBatch(db, query, batchSize) : 0);
}

async function deleteSchoolData(db, schoolId) {
  let deleted = 0;
  for (const collectionName of schoolScopedCollections) {
    deleted += await deleteQueryBatch(db, db.collection(collectionName).where("schoolId", "==", schoolId));
  }
  await db.doc(`schools/${schoolId}`).delete();
  return deleted + 1;
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
      const deletedCount = await deleteSchoolData(db, schoolId);
      await db.collection("platform").doc("schoolDeletionLog").collection("entries").add({
        schoolId,
        actorId: caller.uid,
        actorName: caller.email ?? "Super administrateur",
        deletedCount,
        deletedAt: FieldValue.serverTimestamp(),
      });
      sendJson(res, 200, { schoolId, deletedCount });
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
