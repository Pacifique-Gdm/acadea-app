import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { buildServerAudit, AUDIT_EVENT_TYPES } from "./serverAudit.js";
import { getClassSection, promoteStudentForNewYear, studentForPersistence, studentImportKey } from "../../src/utils/studentYearTransition.js";

export const ARCHIVED_IMPORT_CHUNK_SIZE = 80;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (statusCode, code, message) => { throw Object.assign(new Error(message), { statusCode, code }); };
const identifier = (value) => typeof value === "string" && value.length <= 200 && value.length > 0 && !value.includes("/");
const docs = (snapshot) => snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
const scoped = (db, collection, schoolId, yearId) => {
  const query = db.collection(collection).where("schoolId", "==", schoolId);
  return yearId ? query.where("schoolYearId", "==", yearId) : query;
};

export function importedStudentDocument(source, schoolId, yearId, classes) {
  const promotion = promoteStudentForNewYear(source);
  const student = studentForPersistence({
    ...source,
    id: `import-${digest(`${schoolId}/${yearId}/${source.id}`)}`,
    schoolId, schoolYearId: yearId, annee_scolaire_id: yearId,
    className: promotion.className, section: getClassSection(promotion.className), option: promotion.option,
    status: "ACTIVE", importedFromStudentId: source.id, importedFromSchoolYearId: source.schoolYearId,
  });
  // These references identify annual records, not the student's identity.
  for (const key of ["exitReason", "exitReasonDetails", "deletedAt", "classId", "subClassId", "classOptionKey"]) delete student[key];
  const matches = classes.filter((item) => item.schoolId === schoolId && item.schoolYearId === yearId && item.active !== false
    && !item.parentClassId && item.name === promotion.className && (!item.option || item.option === promotion.option));
  if (matches.length === 1) {
    student.classId = matches[0].id;
    if (promotion.option && matches[0].classOptionKey) student.classOptionKey = matches[0].classOptionKey;
  }
  return student;
}

/** Each call commits at most 80 students and their identity links atomically.
 * Retrying is a continuation, never a second import. The server-owned job is
 * evidence; the old client-writable boolean is never accepted as evidence. */
export async function importArchivedStudents({ db, caller, body }) {
  const { schoolId, schoolYearId, sourceYearId } = body;
  const perform = body.mode === "import";
  if (![schoolId, schoolYearId, sourceYearId].every(identifier) || schoolYearId === sourceYearId) fail(400, "invalid-argument", "École et années source/cible distinctes requises.");
  if (caller.role !== "secretary" || caller.schoolId !== schoolId) fail(403, "permission-denied", "Import réservé au Secrétaire de cette école.");
  if (perform && body.confirmation !== "IMPORTER LES ELEVES") fail(400, "invalid-argument", "Veuillez saisir exactement IMPORTER LES ELEVES.");
  const jobId = digest(`${schoolId}/${schoolYearId}`);
  const jobRef = db.doc(`archivedStudentImports/${jobId}`);
  const yearRef = db.doc(`schoolYears/${schoolYearId}`);

  return db.runTransaction(async (transaction) => {
    const [userSnap, schoolSnap, sourceSnap, yearSnap, jobSnap] = await Promise.all([
      transaction.get(db.doc(`users/${caller.uid}`)), transaction.get(db.doc(`schools/${schoolId}`)),
      transaction.get(db.doc(`schoolYears/${sourceYearId}`)), transaction.get(yearRef), transaction.get(jobRef),
    ]);
    const user = userSnap.data(), school = schoolSnap.data(), sourceYear = sourceSnap.data(), year = yearSnap.data(), job = jobSnap.data();
    if (!userSnap.exists || user.role !== "secretary" || user.schoolId !== schoolId || user.status !== "active" || user.active === false || user.archivedAt) fail(403, "permission-denied", "Compte Secrétaire actif requis.");
    if (!schoolSnap.exists || school.status !== "active") fail(403, "permission-denied", "École inactive ou inaccessible.");
    if (!sourceSnap.exists || !yearSnap.exists || sourceYear.schoolId !== schoolId || year.schoolId !== schoolId) fail(403, "permission-denied", "Les deux années doivent appartenir à cette école.");
    if (sourceYear.status !== "archived" || year.status !== "active" || school.activeSchoolYearId !== schoolYearId) fail(409, "failed-precondition", "Import autorisé uniquement depuis une archive vers l'année active de l'école.");
    if (job && (job.schoolId !== schoolId || job.sourceYearId !== sourceYearId || job.schoolYearId !== schoolYearId)) fail(409, "failed-precondition", "Un import d'une autre année source existe déjà pour cette année cible.");

    const [sourceRows, targetRows, classRows, parentRows, userRows] = await Promise.all([
      transaction.get(scoped(db, "students", schoolId, sourceYearId)), transaction.get(scoped(db, "students", schoolId, schoolYearId)),
      transaction.get(scoped(db, "classes", schoolId, schoolYearId)), transaction.get(scoped(db, "parents", schoolId)),
      transaction.get(scoped(db, "users", schoolId).where("role", "==", "parent")),
    ]);
    const sources = docs(sourceRows).sort((a, b) => a.id.localeCompare(b.id));
    const uniqueSources = new Map();
    for (const source of sources) {
      const key = studentImportKey(source);
      if (!uniqueSources.has(key)) uniqueSources.set(key, source);
    }
    const unique = [...uniqueSources.values()];
    if (unique.some((item) => !item.nom || !item.prenom || !item.className || studentImportKey(item) === "|||")) fail(409, "failed-precondition", "Une fiche source ne possède pas l'identité ou la classe nécessaire à l'import.");
    const signature = digest(JSON.stringify(sources.map((item) => [item.id, studentImportKey(item), item.className, item.option ?? null, item.parentId ?? null])));
    if (job && job.signature !== signature) fail(409, "failed-precondition", "Les élèves source ont changé depuis le début de l'import. Une vérification administrative est nécessaire.");
    if (!sources.length) {
      if (perform) fail(409, "failed-precondition", "Aucun élève dans l'année source archivée.");
      return { status: "empty", sourceCount: 0, remaining: 0, importedCount: 0, existingCount: 0, complete: false, sourceYearId, schoolYearId };
    }
    const targets = docs(targetRows), byId = new Map(targets.map((item) => [item.id, item]));
    const byKey = new Map();
    for (const target of targets) {
      const key = studentImportKey(target);
      if (byKey.has(key) && unique.some((item) => studentImportKey(item) === key)) fail(409, "failed-precondition", "Des doublons existent déjà dans l'année cible. Aucun élève n'a été écrasé.");
      byKey.set(key, target);
    }
    // A legacy flag alone is not a lock. Real rows from its recorded source
    // are: resume that source instead of silently mixing two annual imports.
    if (!job && year.studentsImportedFromArchivedYear && identifier(year.studentsImportedFromYearId) && year.studentsImportedFromYearId !== sourceYearId) {
      const previousYear = await transaction.get(db.doc(`schoolYears/${year.studentsImportedFromYearId}`));
      if (previousYear.exists && previousYear.data().schoolId === schoolId && previousYear.data().status === "archived") {
        const previousSources = docs(await transaction.get(scoped(db, "students", schoolId, year.studentsImportedFromYearId)));
        if (previousSources.some((item) => byKey.has(studentImportKey(item)))) fail(409, "failed-precondition", "Des élèves de l'année source précédente sont déjà présents. Sélectionnez cette année pour vérifier ou reprendre son import.");
      }
    }
    const parents = new Map(docs(parentRows).map((item) => [item.id, item]));
    const parentUsers = new Map(docs(userRows).map((item) => [item.id, item]));
    const classes = docs(classRows);
    const pending = [];
    for (const source of unique) {
      const proposed = importedStudentDocument(source, schoolId, schoolYearId, classes);
      const existing = byKey.get(studentImportKey(source));
      if (!existing && byId.has(proposed.id)) fail(409, "failed-precondition", "Une référence d'import est déjà utilisée par une autre fiche.");
      const target = existing ?? proposed;
      if (existing && source.parentId && existing.parentId !== source.parentId) fail(409, "failed-precondition", "Un lien parent existant diffère de l'archive. Vérification requise sans écrasement.");
      const parent = source.parentId ? parents.get(source.parentId) : undefined;
      if (source.parentId && !parent) fail(409, "failed-precondition", "Un parent source est absent ou appartient à une autre école.");
      const linkedUsers = parent ? [...parentUsers.values()].filter((item) => item.parentId === parent.id) : [];
      if (linkedUsers.length > 1) fail(409, "failed-precondition", "Plusieurs comptes désignent le même parent. Vérification administrative requise.");
      // Older parent profiles can have no userId; users.parentId remains the
      // existing authoritative reverse link, without creating another account.
      const parentUser = parent?.userId ? parentUsers.get(parent.userId) : linkedUsers[0];
      if (parent?.userId && (!parentUser || parentUser.parentId !== parent.id)) fail(409, "failed-precondition", "Le compte du parent source est incohérent.");
      const parentLinkMissing = parent && !(parent.studentIds ?? []).includes(target.id);
      const userLinkMissing = parentUser && !(parentUser.studentIds ?? []).includes(target.id);
      if (!existing || parentLinkMissing || userLinkMissing) pending.push({ target, create: !existing, parent, parentUser });
    }
    const chunk = perform ? pending.slice(0, ARCHIVED_IMPORT_CHUNK_SIZE) : [];
    const complete = pending.length === chunk.length;
    const importedCount = (job?.importedCount ?? 0) + chunk.filter((item) => item.create).length;
    const remaining = pending.length - chunk.length;
    const result = { status: complete ? "complete" : job ? "partial" : year.studentsImportedFromArchivedYear ? "legacy-incomplete" : "ready", sourceCount: sources.length, uniqueCount: unique.length,
      importedCount, existingCount: unique.length - pending.filter((item) => item.create).length, remaining, complete, sourceYearId, schoolYearId };
    if (!perform || (job?.status === "complete" && !pending.length)) return result;

    const parentLinks = new Map(), userLinks = new Map();
    for (const item of chunk) {
      if (item.create) transaction.create(db.doc(`students/${item.target.id}`), item.target);
      if (item.parent) parentLinks.set(item.parent.id, [...(parentLinks.get(item.parent.id) ?? []), item.target.id]);
      if (item.parentUser) userLinks.set(item.parentUser.id, [...(userLinks.get(item.parentUser.id) ?? []), item.target.id]);
    }
    for (const [id, ids] of parentLinks) transaction.update(db.doc(`parents/${id}`), { studentIds: FieldValue.arrayUnion(...ids) });
    for (const [id, ids] of userLinks) transaction.update(db.doc(`users/${id}`), { studentIds: FieldValue.arrayUnion(...ids) });
    transaction.set(jobRef, { version: 1, schoolId, sourceYearId, schoolYearId, signature, importedCount, total: unique.length, remaining,
      status: complete ? "complete" : "partial", createdBy: job?.createdBy ?? caller.uid, updatedAt: FieldValue.serverTimestamp() });
    if (complete) {
      transaction.update(yearRef, { studentsImportedFromArchivedYear: true, studentsImportedFromYearId: sourceYearId, studentsImportedAt: new Date().toISOString() });
      const auditRef = db.doc(`auditLogs/archived-import-${jobId}`);
      transaction.set(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.STUDENTS_IMPORTED, actor: caller, schoolId, schoolYearId, resourceType: "schoolYear", resourceId: schoolYearId, metadata: { sourceYearId, importedCount, total: unique.length } }));
    } else if (year.studentsImportedFromArchivedYear) {
      transaction.update(yearRef, { studentsImportedFromArchivedYear: false });
    }
    return result;
  });
}
