import { randomUUID } from "node:crypto";
import { firebaseAdminPublicError, initAdmin } from "./_lib/firebaseAdmin.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./_lib/serverAudit.js";
import { API_RATE_LIMITS, enforceApiRateLimit, sendRateLimitError } from "./_lib/rateLimit.js";
import { requireActiveSchoolYear } from "./_lib/schoolYear.js";

const allowedRoles = new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "parent"]);
const parentDeleteConfirmation = "SUPPRIMER LE PARENT";
const adminRemovalConfirmation = "SUPPRIMER ADMINISTRATEUR";
const internalPersonnelRoles = new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]);
const schoolSections = new Set(["Maternelle", "Primaire", "CTEB", "Secondaire"]);

function normalizeSchoolSection(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "maternelle") return "Maternelle";
  if (normalized === "primaire") return "Primaire";
  if (normalized === "cteb" || normalized === "cetb") return "CTEB";
  if (normalized === "secondaire") return "Secondaire";
  return undefined;
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

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function optionalText(value, maxLength = 500) {
  const normalized = normalizeText(value);
  if (normalized.length > maxLength) throw Object.assign(new Error("Une information administrative est trop longue."), { statusCode: 400, code: "invalid-argument" });
  return normalized || null;
}

function normalizePersonnelProfile(value = {}) {
  const graduationYear = value.graduationYear === "" || value.graduationYear == null ? null : Number(value.graduationYear);
  if (graduationYear !== null && (!Number.isInteger(graduationYear) || graduationYear < 1900 || graduationYear > new Date().getFullYear() + 10)) throw Object.assign(new Error("Année d'obtention invalide."), { statusCode: 400, code: "invalid-argument" });
  const gender = optionalText(value.gender, 20);
  if (gender && !["F", "M", "Autre"].includes(gender)) throw Object.assign(new Error("Sexe invalide."), { statusCode: 400, code: "invalid-argument" });
  return {
    photoUrl: optionalText(value.photoUrl, 2000), photoPath: optionalText(value.photoPath, 500), gender,
    birthDate: optionalText(value.birthDate, 10), birthPlace: optionalText(value.birthPlace, 150), address: optionalText(value.address, 500),
    engagementDate: optionalText(value.engagementDate, 10), contractType: optionalText(value.contractType, 100),
    educationLevel: optionalText(value.educationLevel, 150), diploma: optionalText(value.diploma, 200), specialty: optionalText(value.specialty, 200),
    trainingInstitution: optionalText(value.trainingInstitution, 250), graduationYear,
    emergencyContactName: optionalText(value.emergencyContactName, 200), emergencyContactRelationship: optionalText(value.emergencyContactRelationship, 100),
    emergencyContactPhone: optionalText(value.emergencyContactPhone, 50), observations: optionalText(value.observations, 3000),
  };
}

export function normalizeSectionIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw Object.assign(new Error("Sections invalides."), { statusCode: 400, code: "invalid-argument" });
  const normalized = [...new Set(value.map(normalizeText).filter(Boolean).map(normalizeSchoolSection))];
  if (normalized.some((section) => !section || !schoolSections.has(section))) throw Object.assign(new Error("Section invalide."), { statusCode: 400, code: "invalid-argument" });
  return normalized;
}

function configuredSchoolSections(school = {}) {
  const canonical = (value) => {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === "maternelle uniquement") return "Maternelle uniquement";
    if (normalized === "primaire uniquement") return "Primaire uniquement";
    if (normalized === "cteb uniquement" || normalized === "cetb uniquement") return "CTEB uniquement";
    if (normalized === "secondaire uniquement") return "Secondaire uniquement";
    return normalizeSchoolSection(value) ?? normalized;
  };
  const levels = Array.isArray(school.educationLevels) ? school.educationLevels.map(canonical) : [];
  const type = canonical(school.schoolType);
  if (type === "mixte" || levels.includes("mixte")) return [...schoolSections];
  const mapped = [...schoolSections].filter((section) => levels.includes(section));
  if (mapped.length) return mapped;
  if (type === "Secondaire") return ["Maternelle", "Primaire", "CTEB", "Secondaire"];
  if (type === "CTEB") return ["Maternelle", "Primaire", "CTEB"];
  if (type === "Primaire") return ["Maternelle", "Primaire"];
  const only = type.replace(" uniquement", "");
  return schoolSections.has(only) ? [only] : [...schoolSections];
}

function assertSectionsBelongToSchool(sectionIds, school) {
  const available = configuredSchoolSections(school);
  if (sectionIds.some((section) => !available.includes(section))) throw Object.assign(new Error("Une section ne fait pas partie de cette ecole."), { statusCode: 400, code: "invalid-argument" });
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

export async function managePersonnel({ auth, db, caller, body, action }) {
  const schoolId = normalizeText(body.schoolId);
  const personnelId = normalizeText(body.personnelId);
  if (caller.role !== "school_admin" || caller.schoolId !== schoolId) {
    throw Object.assign(new Error("Action reservee a l'Administrateur de cette ecole."), { statusCode: 403, code: "permission-denied" });
  }
  if (!schoolId || !personnelId) throw Object.assign(new Error("Ecole et personnel requis."), { statusCode: 400, code: "invalid-argument" });
  const callerSnapshot = await db.doc(`users/${caller.uid}`).get();
  const callerProfile = callerSnapshot.data();
  if (!callerSnapshot.exists || callerProfile?.role !== "school_admin" || callerProfile?.schoolId !== schoolId || callerProfile?.status === "inactive" || callerProfile?.active === false) {
    throw Object.assign(new Error("Compte Administrateur non autorise."), { statusCode: 403, code: "permission-denied" });
  }
  const targetRef = db.doc(`users/${personnelId}`);
  const targetSnapshot = await targetRef.get();
  if (!targetSnapshot.exists) throw Object.assign(new Error("Personnel introuvable."), { statusCode: 404, code: "not-found" });
  const target = targetSnapshot.data() ?? {};
  if (target.schoolId !== schoolId || !internalPersonnelRoles.has(target.role)) {
    throw Object.assign(new Error("Personnel hors de cette ecole ou role non autorise."), { statusCode: 403, code: "permission-denied" });
  }
  if (action === "archive-personnel" && target.role === "school_admin") {
    throw Object.assign(new Error("Seul le Super Administrateur peut archiver un compte Administrateur."), { statusCode: 403, code: "permission-denied" });
  }
  const now = new Date().toISOString();
  const auditRef = db.collection("auditLogs").doc(uid("audit"));
  if (action === "update-personnel") {
    const name = normalizeText(body.name);
    const phone = normalizeText(body.phone);
    const section = normalizeText(body.section);
    const sectionIds = normalizeSectionIds(body.sectionIds ?? (section ? [section] : []));
    const email = normalizeEmail(body.email);
    const profile = normalizePersonnelProfile(body.profile);
    if (!name || !phone || !email) throw Object.assign(new Error("Nom, telephone et email sont requis."), { statusCode: 400, code: "invalid-argument" });
    const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
    assertSectionsBelongToSchool(sectionIds, schoolSnapshot.data());
    const previousAuth = await auth.getUser(personnelId);
    await auth.updateUser(personnelId, { displayName: name, email });
    const profileRef = db.doc(`personnelProfiles/${personnelId}`);
    const counterRef = db.doc(`schools/${schoolId}/counters/personnelMatricules`);
    let savedProfile;
    try {
      savedProfile = await db.runTransaction(async (transaction) => {
        const profileSnapshot = await transaction.get(profileRef);
        const existing = profileSnapshot.data();
        let matricule = existing?.matricule;
        if (!matricule) {
          const counterSnapshot = await transaction.get(counterRef);
          const next = Number(counterSnapshot.data()?.lastNumber ?? 0) + 1;
          matricule = `PER-${String(next).padStart(6, "0")}`;
          transaction.set(counterRef, { lastNumber: next, updatedAt: now, updatedBy: caller.uid }, { merge: true });
        }
        const administrativeProfile = { id: personnelId, schoolId, personnelId, matricule, ...profile, createdAt: existing?.createdAt ?? now, createdBy: existing?.createdBy ?? caller.uid, updatedAt: now, updatedBy: caller.uid };
        transaction.update(targetRef, { name, phone, email, section: sectionIds[0] ?? null, sectionIds, updatedAt: now, updatedBy: caller.uid });
        transaction.set(profileRef, administrativeProfile);
        transaction.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.USER_UPDATED, actor: caller, schoolId, resourceType: "user", resourceId: personnelId, metadata: { role: target.role } }));
        return administrativeProfile;
      });
    } catch (error) {
      const rollback = {};
      if (previousAuth.displayName !== undefined && previousAuth.displayName !== null) rollback.displayName = previousAuth.displayName;
      if (previousAuth.email) rollback.email = previousAuth.email;
      await auth.updateUser(personnelId, rollback).catch(() => undefined);
      throw error;
    }
    return { user: { ...target, id: personnelId, name, phone, email, section: sectionIds[0], sectionIds, updatedAt: now, updatedBy: caller.uid }, profile: savedProfile };
  }
  const archive = action === "archive-personnel";
  if (archive && (target.status === "inactive" || target.active === false)) return { user: { ...target, id: personnelId }, authStatus: "disabled" };
  if (!archive && target.status !== "inactive" && target.active !== false) return { user: { ...target, id: personnelId }, authStatus: "enabled" };
  await auth.updateUser(personnelId, { disabled: archive });
  if (archive) await auth.revokeRefreshTokens(personnelId);
  const patch = archive
    ? { status: "inactive", active: false, archivedAt: now, archivedBy: caller.uid, updatedAt: now, updatedBy: caller.uid }
    : { status: "active", active: true, archivedAt: null, archivedBy: null, reactivatedAt: now, reactivatedBy: caller.uid, updatedAt: now, updatedBy: caller.uid };
  const batch = db.batch();
  batch.update(targetRef, patch);
  batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: archive ? AUDIT_EVENT_TYPES.USER_DISABLED : AUDIT_EVENT_TYPES.USER_REACTIVATED, actor: caller, schoolId, resourceType: "user", resourceId: personnelId, metadata: { role: target.role } }));
  try { await batch.commit(); } catch (error) {
    await auth.updateUser(personnelId, { disabled: !archive }).catch(() => undefined);
    throw error;
  }
  return { user: { ...target, id: personnelId, ...patch }, authStatus: archive ? "disabled" : "enabled" };
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
    const destructive = action === "delete-parent" || action === "remove-school-admin" || action === "archive-personnel" || action === "reactivate-personnel";
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

    if (["update-personnel", "archive-personnel", "reactivate-personnel"].includes(action)) {
      const result = await managePersonnel({ auth, db, caller, body, action });
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
    const section = normalizeText(body.section);
    const sectionIds = normalizeSectionIds(body.sectionIds ?? (section ? [section] : []));
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
    const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
    assertSectionsBelongToSchool(sectionIds, schoolSnapshot.data());
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

    if (role === "school_admin" || role === "cashier" || role === "discipline_director" || role === "study_director" || role === "secretary" || role === "teacher") {
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
        ...(sectionIds.length ? { section: sectionIds[0], sectionIds } : {}),
      };

      const userRef = db.doc(`users/${authUser.uid}`);
      if (role === "teacher") {
        const teacherId = `${schoolId}__${schoolYearId}__${authUser.uid}`;
        const teacherRef = db.doc(`teachers/${teacherId}`);
        const auditRef = db.collection("auditLogs").doc(uid("audit"));
        const batch = db.batch();
        batch.set(userRef, schoolUser);
        batch.set(teacherRef, {
          id: teacherId,
          userId: authUser.uid,
          schoolId,
          schoolYearId,
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdBy: caller.uid,
        });
        batch.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: caller, schoolId, schoolYearId, resourceType: "user", resourceId: authUser.uid, metadata: { role } }));
        await batch.commit();
        createdRefs.push(userRef.path, teacherRef.path);
      } else {
        await userRef.set(schoolUser);
        createdRefs.push(userRef.path);
        await db.collection("auditLogs").doc(uid("audit")).set(buildServerAudit({ eventType: AUDIT_EVENT_TYPES.USER_CREATED, actor: caller, schoolId, schoolYearId, resourceType: "user", resourceId: authUser.uid, metadata: { role } }));
      }
      await auth.setCustomUserClaims(authUser.uid, { role, schoolId });

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
    const statusCode = typeof error?.statusCode === "number"
      ? error.statusCode
      : error?.code === "auth/email-already-exists"
        ? 409
        : 500;
    const diagnostic = firebaseAdminPublicError(error, "provision-school-account");
    const safeAuthError = error?.code === "auth/email-already-exists";
    sendJson(res, statusCode, {
      error: statusCode === 500 || safeAuthError ? diagnostic.message : error.message,
      code: statusCode === 500 || safeAuthError ? diagnostic.code : error?.code ?? (statusCode === 404 ? "not-found" : statusCode === 403 ? "permission-denied" : "invalid-argument"),
      ...(statusCode === 500 && diagnostic.correlationId ? { correlationId: diagnostic.correlationId } : {}),
    });
  }
}
