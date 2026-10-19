import { createHash } from "node:crypto";
import { GradingApiError, loadConsolidatedSchoolClass } from "./teacherGrading.js";
import { calculateConsolidatedReport } from "./consolidatedGrading.js";
import { PUBLICATION_SLOTS, publicationFeeGroups, qualifiesForPublication, validatedFeePaidMinor, validatePublicationCriteria } from "./gradePublicationCriteria.js";
import { publicationReader, runPublicationTransaction, validatePublicationWrites } from "./publicationTransaction.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const required = (value, label) => {
  if (typeof value !== "string" || !value.trim()) throw new GradingApiError(400, "invalid-argument", `${label} invalide.`);
  return value.trim();
};
const serialize = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
const scopeId = (schoolId, schoolYearId, studentId, slot) => `published_grade_${digest(JSON.stringify([schoolId, schoolYearId, studentId, slot]))}`;
const publicationId = (schoolId, schoolYearId, classId, slot, requestId) => `grade_publication_${digest(JSON.stringify([schoolId, schoolYearId, classId, slot, requestId]))}`;
const slotLabels = {
  period_1: "1ère Période", period_2: "2ème Période", semester_1_exam: "Examen 1er Semestre",
  period_3: "3ème Période", period_4: "4ème Période", semester_2_exam: "Examen 2ème Semestre",
};

async function actorContext(db, caller, schoolId, schoolYearId, role, write = false) {
  if (caller.role !== role || caller.schoolId !== schoolId) throw new GradingApiError(403, "permission-denied", "Accès non autorisé.");
  const [user, school, year] = await Promise.all([
    db.doc(`users/${caller.uid}`).get(), db.doc(`schools/${schoolId}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(),
  ]);
  if (!user.exists || user.data()?.role !== role || user.data()?.schoolId !== schoolId || user.data()?.active === false || user.data()?.status === "inactive"
    || !school.exists || ["suspended", "inactive", "deleting"].includes(school.data()?.status)
    || !year.exists || year.data()?.schoolId !== schoolId) throw new GradingApiError(403, "permission-denied", "Compte, école ou année scolaire invalide.");
  if (write && (year.data()?.status !== "active" || school.data()?.activeSchoolYearId !== schoolYearId)) {
    throw new GradingApiError(403, "permission-denied", "Une année archivée est en consultation uniquement.");
  }
  return { user: user.data(), school: school.data(), year: year.data() };
}

async function classReport(db, schoolId, schoolYearId, classId) {
  const source = await loadConsolidatedSchoolClass(db, schoolId, schoolYearId, classId);
  return calculateConsolidatedReport(source);
}

async function authorizedDirectorClass(db, schoolId, schoolYearId, classId, user) {
  const snapshot = await db.doc(`classes/${classId}`).get();
  if (!snapshot.exists || snapshot.data()?.schoolId !== schoolId || snapshot.data()?.schoolYearId !== schoolYearId) {
    throw new GradingApiError(403, "permission-denied", "Classe hors établissement.");
  }
  const permittedSections = Array.isArray(user.sectionIds) ? user.sectionIds : user.section ? [user.section] : [];
  if (snapshot.data()?.section && permittedSections.length && !permittedSections.includes(snapshot.data().section)) {
    throw new GradingApiError(403, "permission-denied", "Section hors du périmètre autorisé.");
  }
  return snapshot;
}

function individualSnapshot(row, courses, slot) {
  return {
    courses: courses.filter((course) => row.statuses[course.key]?.[slot] !== undefined).map((course) => ({
      classId: course.classId, subjectId: course.subjectId, name: course.name,
      score: row.scores[course.key]?.[slot] ?? null,
      maximum: row.maxima[course.key]?.[slot] ?? null,
      status: row.statuses[course.key]?.[slot] ?? "not_graded",
    })),
    percentage: row.evaluations[slot].percentage,
    rank: row.evaluations[slot].rank,
  };
}

async function linkedParentUsers(db, schoolId, schoolYearId, studentId) {
  // Query on the indexed child identifier, then enforce tenant/year on the server.
  // This avoids requiring a new composite index for a protected publication path.
  const parentSnapshot = await db.collection("parents").where("studentIds", "array-contains", studentId).get();
  const parents = serialize(parentSnapshot).filter((item) => item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.status === "active" && Array.isArray(item.studentIds) && item.studentIds.includes(studentId));
  if (!parents.length) return [];
  const parentIds = parents.map((item) => item.id);
  const chunks = Array.from({ length: Math.ceil(parentIds.length / 30) }, (_, index) => parentIds.slice(index * 30, index * 30 + 30));
  const users = (await Promise.all(chunks.map((chunk) => db.collection("users").where("parentId", "in", chunk).get()))).flatMap(serialize);
  return users.filter((item) => item.schoolId === schoolId && item.role === "parent" && item.status !== "inactive" && item.active !== false && parentIds.includes(item.parentId));
}

async function parentProfile(db, caller, schoolId, schoolYearId) {
  const { user } = await actorContext(db, caller, schoolId, schoolYearId, "parent");
  const parentId = required(user.parentId, "Profil Parent");
  const profile = await db.doc(`parents/${parentId}`).get();
  if (!profile.exists || profile.data()?.schoolId !== schoolId || profile.data()?.schoolYearId !== schoolYearId
    || profile.data()?.status !== "active" || !Array.isArray(profile.data()?.studentIds)) {
    throw new GradingApiError(403, "permission-denied", "Profil Parent introuvable pour cette année.");
  }
  return { parentId, studentIds: profile.data().studentIds };
}

async function authorizedChild(db, schoolId, schoolYearId, parentId, studentIds, studentId, listing = false) {
  if (!studentIds.includes(studentId)) throw new GradingApiError(403, "permission-denied", "Élève non lié au Parent.");
  const student = await db.doc(`students/${studentId}`).get();
  // A current parent profile can retain archived child links. They are not
  // current-year results, but must not make the whole current list fail.
  if (listing && student.exists && student.data()?.schoolId === schoolId && student.data()?.schoolYearId !== schoolYearId) return null;
  if (!student.exists || student.data()?.schoolId !== schoolId || student.data()?.schoolYearId !== schoolYearId) {
    throw new GradingApiError(403, "permission-denied", "Élève hors du périmètre autorisé.");
  }
  // The profile's current studentIds is authoritative; a stale direct student.parentId
  // cannot re-grant access after the parent profile has been unlinked.
  return { id: studentId, ...student.data(), parentId };
}

async function readPublishedGrade(db, schoolId, schoolYearId, studentId, slot) {
  const access = await db.doc(`publishedGradeResults/${scopeId(schoolId, schoolYearId, studentId, slot)}`).get();
  if (!access.exists || access.data()?.status !== "published" || access.data()?.studentId !== studentId
    || access.data()?.schoolId !== schoolId || access.data()?.schoolYearId !== schoolYearId || access.data()?.slot !== slot) return null;
  const run = await db.doc(`gradePublicationRuns/${access.data().publicationId}`).get();
  if (!run.exists || run.data()?.status !== "published" || run.data()?.schoolId !== schoolId || run.data()?.schoolYearId !== schoolYearId) return null;
  return access.data();
}

export async function executeGradePublication({ db, caller, body }) {
  const action = required(body.action, "Action");
  const schoolId = required(body.schoolId, "École");
  const schoolYearId = required(body.schoolYearId, "Année scolaire");
  if (action === "grades-parent-list" || action === "grades-parent-read") {
    const { parentId, studentIds } = await parentProfile(db, caller, schoolId, schoolYearId);
    if (action === "grades-parent-read") {
      const studentId = required(body.studentId, "Élève");
      const slot = required(body.slot, "Période");
      if (!PUBLICATION_SLOTS.includes(slot)) throw new GradingApiError(400, "invalid-argument", "Période invalide.");
      await authorizedChild(db, schoolId, schoolYearId, parentId, studentIds, studentId);
      const result = await readPublishedGrade(db, schoolId, schoolYearId, studentId, slot);
      if (!result) throw new GradingApiError(404, "not-found", "Ces cotes ne sont pas publiées pour cet enfant.");
      // Never send recipients, publication criteria or administrative metadata
      // to the parent, even when several parents are linked to the same child.
      return { result: {
        id: result.id, studentId: result.studentId, studentName: result.studentName,
        schoolYearId: result.schoolYearId, className: result.className, yearName: result.yearName,
        slot: result.slot, publishedAt: result.publishedAt, result: result.result,
      } };
    }
    if (studentIds.length > 30) throw new GradingApiError(400, "failed-precondition", "Trop de liens enfants : contactez l’établissement.");
    const children = [];
    for (const studentId of [...new Set(studentIds)]) {
      const student = await authorizedChild(db, schoolId, schoolYearId, parentId, studentIds, studentId, true);
      if (!student) continue;
      const publications = (await Promise.all(PUBLICATION_SLOTS.map((slot) => readPublishedGrade(db, schoolId, schoolYearId, studentId, slot))))
        .filter(Boolean).map(({ slot, publicationId, publishedAt }) => ({ slot, publicationId, publishedAt }));
      if (publications.length) children.push({ studentId, studentName: [student.nom, student.postnom, student.prenom].filter(Boolean).join(" "), className: student.className, publications });
    }
    return { children };
  }

  if (action === "grades-publish") {
    return runPublicationTransaction(db, (transaction) => publishGrades(db, transaction, caller, body, schoolId, schoolYearId));
  }
  const write = action === "grades-withdraw";
  const { user, school, year } = await actorContext(db, caller, schoolId, schoolYearId, "study_director", write);
  if (action === "grades-options") {
    const classId = required(body.classId, "Classe");
    await authorizedDirectorClass(db, schoolId, schoolYearId, classId, user);
    const report = await classReport(db, schoolId, schoolYearId, classId);
    const fees = await db.collection("feeTypes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get();
    const currency = year.currency === "USD" || year.currency === "CDF" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
    return { currency, feeTypes: publicationFeeGroups(serialize(fees), report.students.map((row) => row.student)).map(({ id, name }) => ({ id, name })) };
  }
  if (action === "grades-report") {
    const classId = required(body.classId, "Classe");
    await authorizedDirectorClass(db, schoolId, schoolYearId, classId, user);
    return { report: await classReport(db, schoolId, schoolYearId, classId) };
  }
  if (action === "grades-withdraw") {
    const runId = required(body.publicationId, "Publication");
    return db.runTransaction(async (transaction) => {
      const ref = db.doc(`gradePublicationRuns/${runId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.schoolId !== schoolId || snapshot.data()?.schoolYearId !== schoolYearId) {
        throw new GradingApiError(404, "not-found", "Publication introuvable.");
      }
      if (snapshot.data().status === "withdrawn") return { ok: true, alreadyWithdrawn: true };
      if (snapshot.data().status !== "published") throw new GradingApiError(409, "failed-precondition", "Publication non retirable.");
      const accessIds = snapshot.data().accessIds ?? [];
      if (!Array.isArray(accessIds) || accessIds.length > 400) throw new GradingApiError(409, "failed-precondition", "Publication trop volumineuse pour un retrait atomique.");
      const accessSnapshots = await Promise.all(accessIds.map((id) => transaction.get(db.doc(`publishedGradeResults/${id}`))));
      transaction.update(ref, { status: "withdrawn", withdrawnAt: new Date().toISOString(), withdrawnBy: caller.uid });
      accessIds.forEach((id, index) => {
        if (accessSnapshots[index].exists && accessSnapshots[index].data()?.publicationId === runId) {
          transaction.update(db.doc(`publishedGradeResults/${id}`), { status: "withdrawn" });
        }
      });
      return { ok: true, withdrawn: true };
    });
  }
  throw new GradingApiError(400, "invalid-argument", "Action inconnue.");
}

async function publishGrades(writer, transaction, caller, body, schoolId, schoolYearId) {
  const db = publicationReader(writer, transaction);
  const { user, school, year } = await actorContext(db, caller, schoolId, schoolYearId, "study_director", true);
  let criteria;
  try { criteria = validatePublicationCriteria(body); } catch (error) { throw new GradingApiError(400, "invalid-argument", error.message); }
  const classId = required(body.classId, "Classe");
  const requestId = required(body.requestId, "Identifiant de demande");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId)) throw new GradingApiError(400, "invalid-argument", "Identifiant de demande invalide.");
  const runId = publicationId(schoolId, schoolYearId, classId, criteria.slot, requestId);
  const runRef = writer.doc(`gradePublicationRuns/${runId}`);
  const classSnapshot = await authorizedDirectorClass(db, schoolId, schoolYearId, classId, user);
  const prior = await db.doc(`gradePublicationRuns/${runId}`).get();
  const criteriaHash = digest(JSON.stringify([criteria, caller.uid]));
  if (prior.exists) {
    if (prior.data()?.criteriaHash !== criteriaHash) throw new GradingApiError(409, "conflict", "Cette demande a déjà été utilisée avec d’autres critères.");
    if (prior.data()?.status !== "published") throw new GradingApiError(409, "failed-precondition", "Cette publication a été retirée.");
    return { ok: true, publicationId: runId, publishedCount: prior.data()?.publishedCount ?? 0, notificationCount: prior.data()?.notificationCount ?? 0, repeated: true };
  }
  const report = await classReport(db, schoolId, schoolYearId, classId);
  if (report.students.length > 150) throw new GradingApiError(409, "failed-precondition", "Classe trop volumineuse pour une publication atomique.");
  let feeTypeIds, currency;
  if (criteria.fee) {
    const fees = await db.collection("feeTypes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get();
    const group = publicationFeeGroups(serialize(fees), report.students.map((row) => row.student)).find((item) => item.id === criteria.fee.feeTypeId);
    if (!group) throw new GradingApiError(400, "invalid-argument", "Frais non applicable à la classe ou à l’option.");
    feeTypeIds = group.feeTypeIds;
    currency = year.currency === "USD" || year.currency === "CDF" ? year.currency : school.currency === "CDF" ? "CDF" : "USD";
  }
  const selected = [];
  for (const row of report.students) {
    let paidMinor = null;
    if (criteria.fee && row.evaluations[criteria.slot].complete) {
      const payments = (await Promise.all(feeTypeIds.map((id) => db.collection("payments").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)
        .where("studentId", "==", row.student.id).where("feeTypeId", "==", id).get()))).flatMap(serialize);
      try { paidMinor = validatedFeePaidMinor(payments, { schoolId, schoolYearId, studentId: row.student.id, feeTypeId: criteria.fee.feeTypeId, feeTypeIds, currency }); }
      catch (error) { throw new GradingApiError(409, "failed-precondition", error.message); }
    }
    if (!qualifiesForPublication(row.evaluations[criteria.slot], criteria, paidMinor)) continue;
    const recipients = await linkedParentUsers(db, schoolId, schoolYearId, row.student.id);
    if (recipients.length) selected.push({ row, recipients });
  }
  const writeCount = 1 + selected.length + selected.reduce((sum, item) => sum + item.recipients.length, 0);
  if (writeCount > 400) throw new GradingApiError(409, "failed-precondition", "Publication trop volumineuse pour une opération atomique.");
  const now = new Date().toISOString();
  const accessRecords = selected.map(({ row, recipients }) => ({
    id: scopeId(schoolId, schoolYearId, row.student.id, criteria.slot),
    schoolId, schoolYearId, classId, studentId: row.student.id, slot: criteria.slot, publicationId: runId,
    status: "published", publishedAt: now, publishedBy: caller.uid, studentName: [row.student.nom, row.student.postnom, row.student.prenom].filter(Boolean).join(" "),
    className: classSnapshot.data()?.name ?? row.student.className, yearName: year.name,
    result: individualSnapshot(row, report.courses, criteria.slot), recipients: recipients.map((item) => item.id),
  }));
  const notifications = selected.flatMap(({ row, recipients }) => recipients.map((recipient) => ({
    id: `grade_notice_${digest(JSON.stringify([runId, row.student.id, recipient.id]))}`,
    schoolId, schoolYearId, recipientRole: "parent", recipientUserId: recipient.id, parentId: recipient.parentId,
    studentId: row.student.id, type: "grade_publication", module: "grades", event: "grades_published", destination: "/dashboard",
    publicationId: runId, slot: criteria.slot, title: "Publication des cotes",
    body: `Madame, Monsieur,\n\nNous vous informons que les cotes de votre enfant ${[row.student.nom, row.student.postnom, row.student.prenom].filter(Boolean).join(" ")}, inscrit(e) en ${classSnapshot.data()?.name ?? row.student.className}, pour la ${slotLabels[criteria.slot]}, sont désormais disponibles.\n\nNous vous invitons à les consulter dans votre espace « Côtes de mes enfants » sur Acadéa.\n\nLa Direction des études.`,
    createdAt: now, read: false,
  })));
  const run = {
      id: runId, schoolId, schoolYearId, classId, slot: criteria.slot, status: "published", criteriaHash,
      criteria, publishedAt: now, publishedBy: caller.uid, publishedCount: accessRecords.length,
      notificationCount: notifications.length, accessIds: accessRecords.map((item) => item.id),
  };
  validatePublicationWrites([run, ...accessRecords, ...notifications]);
  transaction.create(runRef, run);
  accessRecords.forEach((record) => transaction.set(writer.doc(`publishedGradeResults/${record.id}`), record));
  notifications.forEach((record) => transaction.set(writer.doc(`notifications/${record.id}`), record));
  return { ok: true, publicationId: runId, publishedCount: accessRecords.length, notificationCount: notifications.length, repeated: false };
}
