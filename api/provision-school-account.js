import { randomUUID } from "node:crypto";
import { firebaseAdminPublicError, initAdmin } from "./_lib/firebaseAdmin.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./_lib/serverAudit.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { requireActiveSchoolYear } from "./_lib/schoolYear.js";

const allowedRoles = new Set(["school_admin", "cashier", "discipline_director", "secretary", "parent"]);
const parentDeleteConfirmation = "SUPPRIMER LE PARENT";
const adminRemovalConfirmation = "SUPPRIMER ADMINISTRATEUR";

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

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function publicError(error) {
  const code = error?.code ?? "";
  if (code === "auth/email-already-exists") return "Cet email Firebase est deja utilise.";
  if (code === "auth/invalid-email") return "Email invalide.";
  if (code === "auth/invalid-password") return "Mot de passe invalide.";
  return "Provisionnement impossible. Verifiez les informations et reessayez.";
}

async function commitBatches(db, refs, buildUpdate) {
  let deletedCount = 0;
  for (let index = 0; index < refs.length; index += 450) {
    const batch = db.batch();
    refs.slice(index, index + 450).forEach((ref) => {
      buildUpdate(batch, ref);
      deletedCount += 1;
    });
    await batch.commit();
  }
  return deletedCount;
}

async function cleanup({ auth, db, authUid, refs }) {
  const tasks = [];
  if (authUid) tasks.push(auth.deleteUser(authUid));
  for (const ref of refs) tasks.push(db.doc(ref).delete());
  await Promise.allSettled(tasks);
}

async function assertAuthorizedCaller({ db, caller, schoolId, allowSecretary = false }) {
  if (caller.role !== "school_admin" && caller.role !== "super_admin" && !(allowSecretary && caller.role === "secretary")) {
    throw Object.assign(new Error("Action reservee a un administrateur autorise."), { statusCode: 403 });
  }

  if ((caller.role === "school_admin" || caller.role === "secretary") && caller.schoolId !== schoolId) {
    throw Object.assign(new Error("Action refusee pour cette ecole."), { statusCode: 403 });
  }

  const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
  if (!schoolSnapshot.exists) {
    throw Object.assign(new Error("Ecole introuvable."), { statusCode: 400 });
  }
  if (["deleting", "inactive", "suspended"].includes(schoolSnapshot.data()?.status)) {
    throw Object.assign(new Error("Cette école n'accepte plus de nouveaux comptes."), { statusCode: 409, code: "failed-precondition" });
  }
}

async function deleteParentAccount({ auth, db, caller, body }) {
  const schoolId = normalizeText(body.schoolId);
  const parentId = normalizeText(body.parentId);
  const confirmation = normalizeText(body.confirmation);

  if (!schoolId || !parentId) {
    throw Object.assign(new Error("Ecole et parent requis."), { statusCode: 400 });
  }
  if (confirmation !== parentDeleteConfirmation) {
    throw Object.assign(new Error("Confirmation de suppression invalide."), { statusCode: 400 });
  }

  await assertAuthorizedCaller({ db, caller, schoolId, allowSecretary: true });

  const parentRef = db.doc(`parents/${parentId}`);
  const parentSnapshot = await parentRef.get();
  if (!parentSnapshot.exists) {
    throw Object.assign(new Error("Parent introuvable."), { statusCode: 404 });
  }
  const parent = parentSnapshot.data();
  if (parent.schoolId !== schoolId) {
    throw Object.assign(new Error("Parent hors de cette ecole."), { statusCode: 403 });
  }

  const authUid = normalizeText(parent.userId);
  let authStatus = authUid ? "skipped" : "missing-uid";
  let authError = "";
  if (authUid) {
    try {
      await auth.deleteUser(authUid);
      authStatus = "deleted";
    } catch (error) {
      if (error?.code === "auth/user-not-found") {
        authStatus = "already-missing";
      } else {
        authStatus = "failed";
        authError = error?.code ?? error?.message ?? "auth-delete-failed";
      }
    }
  }

  const userRefs = [];
  if (authUid) userRefs.push(db.doc(`users/${authUid}`));
  const linkedUserSnapshots = await db.collection("users").where("schoolId", "==", schoolId).where("parentId", "==", parentId).get();
  linkedUserSnapshots.docs.forEach((docSnapshot) => {
    if (!userRefs.some((ref) => ref.path === docSnapshot.ref.path)) userRefs.push(docSnapshot.ref);
  });

  const studentSnapshots = await db.collection("students").where("schoolId", "==", schoolId).where("parentId", "==", parentId).get();
  let firestoreUpdatedCount = 0;
  if (!studentSnapshots.empty) {
    firestoreUpdatedCount += await commitBatches(db, studentSnapshots.docs.map((docSnapshot) => docSnapshot.ref), (batch, ref) => {
      batch.update(ref, { parentId: null });
    });
  }

  const deleteRefs = [parentRef, ...userRefs];
  firestoreUpdatedCount += await commitBatches(db, deleteRefs, (batch, ref) => {
    batch.delete(ref);
  });

  const auditRef = db.collection("auditLogs").doc(uid("audit"));
  await auditRef.set(buildServerAudit({ eventType: AUDIT_EVENT_TYPES.USER_DELETED, actor: caller, schoolId, resourceType: "parent", resourceId: parentId, metadata: { authStatus } }));

  const status = authStatus === "failed" ? "partial" : "complete";
  return {
    status,
    parentId,
    authUid: authUid || undefined,
    authStatus,
    authError: authError || undefined,
    firestoreDeletedCount: deleteRefs.length,
    firestoreUpdatedCount,
  };
}

async function createAuthUser(auth, { email, password, displayName }) {
  return auth.createUser({
    email,
    password,
    displayName,
    disabled: false,
  });
}

async function loadParentStudents(db, { studentIds, schoolId, schoolYearId, parentId }) {
  const uniqueIds = [...new Set(studentIds)];
  const snapshots = await Promise.all(uniqueIds.map((studentId) => db.doc(`students/${studentId}`).get()));
  const invalid = snapshots.find((snapshot) => !snapshot.exists || snapshot.data()?.schoolId !== schoolId || snapshot.data()?.schoolYearId !== schoolYearId || (snapshot.data()?.status && snapshot.data()?.status !== "ACTIVE") || (snapshot.data()?.parentId && snapshot.data()?.parentId !== parentId));
  if (invalid) throw Object.assign(new Error("Un élève sélectionné est introuvable, inactif ou hors de cette école et année scolaire."), { statusCode: 400, code: "invalid-student-link" });
  return snapshots;
}

export async function removeSchoolAdmin({ auth, db, caller, body }) {
  if (caller.role !== "super_admin") {
    throw Object.assign(new Error("Action reservee au Super Administrateur."), { statusCode: 403 });
  }

  const schoolId = normalizeText(body.schoolId);
  const adminId = normalizeText(body.adminId);
  const confirmation = String(body.confirmation ?? "");
  if (!schoolId || !adminId) {
    throw Object.assign(new Error("Ecole et administrateur requis."), { statusCode: 400 });
  }
  if (confirmation !== adminRemovalConfirmation) {
    throw Object.assign(new Error("Confirmation de retrait invalide."), { statusCode: 400 });
  }

  const adminRef = db.doc(`users/${adminId}`);
  const adminSnapshot = await adminRef.get();
  if (!adminSnapshot.exists) {
    throw Object.assign(new Error("Administrateur introuvable."), { statusCode: 404 });
  }

  const admin = adminSnapshot.data() ?? {};
  if (admin.role !== "school_admin" || admin.schoolId !== schoolId) {
    throw Object.assign(new Error("Administrateur hors de cette ecole."), { statusCode: 403 });
  }

  const removedAt = new Date().toISOString();
  await auth.updateUser(adminId, { disabled: true });
  const auditRef = db.collection("auditLogs").doc(uid("audit"));
  const batch = db.batch();
  batch.update(adminRef, { status: "inactive", removedAt, removedBy: caller.uid });
  batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.USER_DISABLED, actor: caller, schoolId, resourceType: "user", resourceId: adminId, metadata: { role: "school_admin" } }));
  try {
    await batch.commit();
  } catch (error) {
    await auth.updateUser(adminId, { disabled: false }).catch(() => undefined);
    throw error;
  }
  return { adminId, status: "inactive", authStatus: "disabled", removedAt };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Methode non autorisee." });
    return;
  }

  let createdAuthUid = "";
  const createdRefs = [];
  let adminAuth;
  let adminDb;

  try {
    const authorization = req.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";

    if (!token) {
      sendJson(res, 401, { error: "Authentification requise.", code: "unauthenticated" });
      return;
    }

    const { auth, db } = initAdmin();
    adminAuth = auth;
    adminDb = db;

    const caller = await auth.verifyIdToken(token, true);
    const body = await readBody(req);
    const action = normalizeText(body.action);
    const destructive = action === "delete-parent" || action === "remove-school-admin";
    await enforceApiRateLimit({ db, actorId: caller.uid, schoolId: String(caller.schoolId ?? "platform"), action: destructive ? `provision.${action}` : "provision.account", ...(destructive ? API_RATE_LIMITS.PROVISION_DESTRUCTIVE : API_RATE_LIMITS.PROVISION_ACCOUNT) });

    if (action === "delete-parent") {
      const result = await deleteParentAccount({ auth, db, caller, body });
      sendJson(res, result.status === "partial" ? 207 : 200, result);
      return;
    }

    if (action === "remove-school-admin") {
      const result = await removeSchoolAdmin({ auth, db, caller, body });
      sendJson(res, 200, result);
      return;
    }

    const role = normalizeText(body.role);
    const schoolId = normalizeText(body.schoolId);
    const schoolYearId = normalizeText(body.schoolYearId);
    const name = normalizeText(body.name);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const phone = normalizeText(body.phone);
    const address = normalizeText(body.address);
    const now = new Date().toISOString();

    if (!allowedRoles.has(role)) {
      sendJson(res, 400, { error: "Role a provisionner invalide.", code: "invalid-argument" });
      return;
    }

    if (!schoolId || !schoolYearId || !name || !email || password.length < 6) {
      sendJson(res, 400, { error: "Ecole, annee scolaire, nom, email et mot de passe valide sont requis.", code: "invalid-argument" });
      return;
    }

    await assertAuthorizedCaller({ db, caller, schoolId, allowSecretary: role === "parent" });
    await requireActiveSchoolYear(db, schoolId, schoolYearId);

    const parentId = role === "parent" ? normalizeText(body.parentId) || uid("parent") : "";
    const studentIds = role === "parent" && Array.isArray(body.studentIds) ? [...new Set(body.studentIds.map(normalizeText).filter(Boolean))] : [];
    const parentStudentSnapshots = role === "parent" ? await loadParentStudents(db, { studentIds, schoolId, schoolYearId, parentId }) : [];

    const authUser = await createAuthUser(auth, {
      email,
      password,
      displayName: name,
    });
    createdAuthUid = authUser.uid;

    if (role === "school_admin" || role === "cashier" || role === "discipline_director" || role === "secretary") {
      const schoolUser = {
        id: authUser.uid,
        name,
        email,
        role,
        schoolId,
        activeSchoolYearId: schoolYearId,
        phone,
        status: "active",
        active: true,
        createdAt: now,
      };

      await db.doc(`users/${authUser.uid}`).set(schoolUser);
      createdRefs.push(`users/${authUser.uid}`);
      await auth.setCustomUserClaims(authUser.uid, { role, schoolId });
      await db.collection("auditLogs").doc(uid("audit")).set(buildServerAudit({ eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: caller, schoolId, schoolYearId, resourceType: "user", resourceId: authUser.uid, metadata: { role } }));

      sendJson(res, 200, { user: schoolUser });
      return;
    }

    const status = body.status === "inactive" ? "inactive" : "active";
    const parent = {
      id: parentId,
      schoolId,
      schoolYearId,
      userId: authUser.uid,
      fullName: name,
      phone,
      email,
      address,
      studentIds,
      status,
    };
    const parentUser = {
      id: authUser.uid,
      name,
      email,
      role: "parent",
      schoolId,
      activeSchoolYearId: schoolYearId,
      parentId,
      studentIds,
      status,
      phone,
      address,
      createdAt: now,
    };

    await auth.setCustomUserClaims(authUser.uid, { role: "parent", schoolId, parentId });
    const parentRef = db.doc(`parents/${parentId}`);
    const userRef = db.doc(`users/${authUser.uid}`);
    const batch = db.batch();
    batch.set(parentRef, parent);
    batch.set(userRef, parentUser);
    const auditRef = db.collection("auditLogs").doc(uid("audit"));
    batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: caller, schoolId, schoolYearId, resourceType: "parent", resourceId: parentId, metadata: { role: "parent" } }));
    parentStudentSnapshots.forEach((snapshot) => batch.update(snapshot.ref, { parentId }));
    await batch.commit();
    createdRefs.push(parentRef.path, userRef.path);

    sendJson(res, 200, { parent, user: parentUser });
  } catch (error) {
    if (adminAuth && adminDb) {
      await cleanup({ auth: adminAuth, db: adminDb, authUid: createdAuthUid, refs: createdRefs });
    }

    if (sendRateLimitError(res, error)) return;
    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
    console.error("[Acadea provisioning] Provisionnement compte ecole echoue.", error);
    const diagnostic = firebaseAdminPublicError(error);
    sendJson(res, statusCode, {
      error: statusCode === 500 ? publicError(error) : error.message,
      code: statusCode === 500 ? diagnostic.code : error?.code ?? (statusCode === 404 ? "not-found" : statusCode === 403 ? "permission-denied" : "invalid-argument"),
      ...(statusCode === 500 ? { details: diagnostic.details } : {}),
    });
  }
}
