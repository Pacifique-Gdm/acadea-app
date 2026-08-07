import { FieldValue } from "firebase-admin/firestore";

export const SCHOOL_OWNED_COLLECTIONS = Object.freeze([
  "users", "schoolYears", "students", "teachers", "parents", "classes", "feeTypes",
  "payments", "expenses", "financialCounters", "financialIdempotency", "grades", "attendance",
  "attendanceSettings", "biometricTerminals", "bulletins", "documents", "announcements", "messages",
  "notifications", "auditLogs", "valves", "conversations", "parentDailyMessageLimits",
  "disciplineSanctions", "correspondences", "secretaryReports", "secretaryCounters",
  "studentMedicalRecords", "aiUsageLogs",
]);

export const SCHOOL_OWNED_SUBCOLLECTIONS = Object.freeze([
  { parent: "messageIdempotency", child: "signals" },
  { parent: "schools", child: "aiUsageReservations" },
]);

export const SCHOOL_STORAGE_PREFIXES = Object.freeze([
  (schoolId) => `valves/${schoolId}/`,
  (schoolId) => `schools/${schoolId}/`,
]);

const BATCH_SIZE = 250;

function text(value) { return typeof value === "string" ? value.trim() : ""; }

export function schoolDeletionInventory() {
  return {
    collections: [...SCHOOL_OWNED_COLLECTIONS],
    subcollections: SCHOOL_OWNED_SUBCOLLECTIONS.map((item) => ({ ...item })),
    storagePrefixes: ["valves/{schoolId}/", "schools/{schoolId}/"],
    auth: ["users/{uid}", "parents.userId", "schools.mainAdminId"],
  };
}

export async function deleteQueryPages(db, query, batchSize = BATCH_SIZE) {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < batchSize) return deleted;
  }
}

async function collectReferencedStoragePaths(db, schoolId) {
  const paths = new Set();
  for (const collectionName of ["valves", "correspondences", "studentMedicalRecords", "documents"]) {
    const snapshot = await db.collection(collectionName).where("schoolId", "==", schoolId).get();
    snapshot.docs.forEach((document) => {
      const data = document.data() ?? {};
      const candidates = [data.storagePath, data.filePath, data.attachmentPath, data.attachment?.path];
      if (Array.isArray(data.attachments)) candidates.push(...data.attachments.map((item) => item?.path ?? item?.storagePath));
      candidates.map(text).filter(Boolean).forEach((path) => paths.add(path));
    });
  }
  return [...paths];
}

export async function deleteSchoolStorage(bucket, db, schoolId) {
  const deletedPaths = new Set();
  for (const prefixFactory of SCHOOL_STORAGE_PREFIXES) {
    const [files] = await bucket.getFiles({ prefix: prefixFactory(schoolId) });
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deletedPaths.add(file.name);
    }
  }
  for (const path of await collectReferencedStoragePaths(db, schoolId)) {
    if (deletedPaths.has(path)) continue;
    await bucket.file(path).delete({ ignoreNotFound: true });
    deletedPaths.add(path);
  }
  return { deleted: deletedPaths.size, paths: [...deletedPaths] };
}

export async function collectSchoolAuthUsers(db, schoolId, schoolData = {}) {
  const candidates = new Map();
  const add = (uid, source, superAdmin = false) => {
    const normalized = text(uid);
    if (!normalized) return;
    const current = candidates.get(normalized) ?? { uid: normalized, sources: new Set(), superAdmin: false };
    current.sources.add(source);
    current.superAdmin ||= superAdmin;
    candidates.set(normalized, current);
  };
  const users = await db.collection("users").where("schoolId", "==", schoolId).get();
  users.docs.forEach((document) => {
    const user = document.data() ?? {};
    add(document.id, "users.docId", user.role === "super_admin");
    add(user.id, "users.id", user.role === "super_admin");
  });
  const parents = await db.collection("parents").where("schoolId", "==", schoolId).get();
  parents.docs.forEach((document) => add(document.data()?.userId, "parents.userId"));
  add(schoolData.mainAdminId, "schools.mainAdminId");
  return [...candidates.values()].map((entry) => ({ ...entry, sources: [...entry.sources] }));
}

export async function deleteSchoolAuthUsers(auth, candidates, schoolId) {
  const completeCandidates = new Map(candidates.map((candidate) => [candidate.uid, candidate]));
  if (typeof auth.listUsers === "function") {
    let pageToken;
    do {
      const page = await auth.listUsers(1000, pageToken);
      page.users.filter((user) => user.customClaims?.schoolId === schoolId).forEach((user) => {
        if (!completeCandidates.has(user.uid)) completeCandidates.set(user.uid, { uid: user.uid, sources: ["auth.customClaims"], superAdmin: user.customClaims?.role === "super_admin" });
      });
      pageToken = page.pageToken;
    } while (pageToken);
  }
  const report = { found: completeCandidates.size, deleted: 0, alreadyMissing: 0, skipped: 0, failed: [] };
  for (const candidate of completeCandidates.values()) {
    if (candidate.superAdmin) { report.skipped += 1; continue; }
    try {
      const user = await auth.getUser(candidate.uid);
      const claims = user.customClaims ?? {};
      if (claims.role === "super_admin" || (claims.schoolId && claims.schoolId !== schoolId)) { report.skipped += 1; continue; }
      await auth.deleteUser(candidate.uid);
      report.deleted += 1;
    } catch (error) {
      if (error?.code === "auth/user-not-found") report.alreadyMissing += 1;
      else report.failed.push({ uid: candidate.uid, code: error?.code ?? "unknown" });
    }
  }
  return report;
}

export async function deleteSchoolFirestoreData(db, schoolId) {
  const collections = [];
  const usersGroup = await db.collection("users").where("schoolId", "==", schoolId).get();
  let pushTokens = 0;
  for (const user of usersGroup.docs) pushTokens += await deleteQueryPages(db, user.ref.collection("pushTokens"));
  collections.push({ collection: "users/{uid}/pushTokens", deleted: pushTokens });
  for (const item of SCHOOL_OWNED_SUBCOLLECTIONS) {
    const deleted = await deleteQueryPages(db, db.collection(item.parent).doc(schoolId).collection(item.child));
    collections.push({ collection: `${item.parent}/{schoolId}/${item.child}`, deleted });
    if (item.parent !== "schools") await db.doc(`${item.parent}/${schoolId}`).delete();
  }
  for (const collectionName of SCHOOL_OWNED_COLLECTIONS) {
    const deleted = await deleteQueryPages(db, db.collection(collectionName).where("schoolId", "==", schoolId));
    collections.push({ collection: collectionName, deleted });
  }
  return { deleted: collections.reduce((sum, item) => sum + item.deleted, 0), collections };
}

export async function deleteSchoolCompletely({ db, auth, bucket, schoolId, schoolData, actor }) {
  const schoolRef = db.doc(`schools/${schoolId}`);
  const startedAt = new Date().toISOString();
  await schoolRef.update({ status: "deleting", deletion: { status: "running", startedAt, startedBy: actor.uid } });
  const auditRef = await db.collection("platform").doc("schoolDeletionLog").collection("entries").add({ eventType: "school.deletion.started", actorId: actor.uid, actorRole: actor.role, schoolId, resourceType: "school", resourceId: schoolId, source: "server", status: "running", startedAt, createdAt: FieldValue.serverTimestamp() });
  const authCandidates = await collectSchoolAuthUsers(db, schoolId, schoolData);
  let schoolDeleted = false;
  try {
    const storage = await deleteSchoolStorage(bucket, db, schoolId);
    const authReport = await deleteSchoolAuthUsers(auth, authCandidates, schoolId);
    if (authReport.failed.length > 0) throw Object.assign(new Error("Suppression Auth incomplète."), { step: "auth", authReport });
    const firestore = await deleteSchoolFirestoreData(db, schoolId);
    await schoolRef.delete();
    schoolDeleted = true;
    const report = { schoolId, status: "complete", startedAt, finishedAt: new Date().toISOString(), storageDeleted: storage.deleted, auth: authReport, firestore };
    await auditRef.set({ ...report, eventType: "school.deletion.completed", actorId: actor.uid, actorRole: actor.role, source: "server", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return report;
  } catch (error) {
    if (!schoolDeleted) await schoolRef.set({ status: "deleting", deletion: { status: "failed", failedStep: error?.step ?? "unknown", startedAt, failedAt: new Date().toISOString(), startedBy: actor.uid } }, { merge: true }).catch(() => undefined);
    await auditRef.set({ eventType: "school.deletion.failed", status: schoolDeleted ? "deleted-log-failed" : "failed", failedStep: error?.step ?? "unknown", failedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => undefined);
    throw error;
  }
}
