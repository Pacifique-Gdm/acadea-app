import { createHash } from "node:crypto";
import { GradingApiError } from "./teacherGrading.js";
import { publicationReader, runPublicationTransaction } from "./publicationTransaction.js";
import { canManageSections, resolveSectionAuthority } from "./sectionAuthority.js";
import { validateTimetable, logicalStudyClasses, studyClassSection, userSectionIds, resolveAttendanceSchoolDays, timetableSection, activePublishedTimetables, sectionTimetableProblem, validateSectionTimetable } from "./timetableValidationBundle.js";

const fail = (status, code, message) => { throw new GradingApiError(status, code, message); };
const id = (value) => typeof value === "string" && value.length > 0 && value.length <= 300 && !value.includes("/");
const rows = (snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })).sort((a, b) => a.id.localeCompare(b.id));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

/** Lot R5 : celui qui agit sur la section (règle unique des sections, fonction
 * commune de R4). Point d'extension R6 : responsable désigné de la section, à
 * passer dans les options de resolveSectionAuthority. */
function timetableAuthority(actor, uid, school) {
  return resolveSectionAuthority({ ...actor, id: uid, uid }, school);
}

/** Lot R5 : horaire publié des autres sections, lu dans la même transaction. */
async function sectionValidationContext({ reader, schoolId, schoolYearId, section, schedules, classes, problem }) {
  const publishedIds = activePublishedTimetables(schedules).map((item) => item.id).sort();
  const [publishedEntries, stateSnapshot] = await Promise.all([
    publishedIds.length ? reader.collection("timetableEntries").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)
      .where("scheduleId", "in", publishedIds.slice(0, 30)).get().then(rows) : [],
    reader.doc(`timetablePublicationStates/${digest([schoolId, schoolYearId, section])}`).get(),
  ]);
  if (publishedIds.length > 30) fail(409, "ambiguous-publication", "Trop de publications actives existent. Aucune publication n’a été modifiée.");
  const scoped = sectionTimetableProblem({ problem, section, timetables: schedules, entries: publishedEntries.filter((item) => item.active !== false), classes });
  return { ...scoped, stateSnapshot };
}

/** All source queries, even empty ones, and the per-year publication lock are
 * read in the SAME serializable server transaction. No client source is trusted.
 * Bounded reads fail closed; maxAttempts=1 exposes contention instead of silently
 * validating different data. No change is made to legacy documents not selected.
 */
export async function executeTimetableWorkflow({ db, caller, body }) {
  const { action, schoolId, schoolYearId, scheduleId, expectedUpdatedAt, requestId } = body;
  if (!["timetable-validate", "timetable-publish"].includes(action) || ![schoolId, schoolYearId, scheduleId, requestId].every(id)
      || typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length > 100) fail(400, "invalid-argument", "Demande d’horaire invalide.");
  if (caller.role !== "study_director" || caller.schoolId !== schoolId) fail(403, "permission-denied", "Périmètre pédagogique non autorisé.");
  const publishing = action === "timetable-publish";
  return runPublicationTransaction(db, async (transaction) => {
    const reader = publicationReader(db, transaction);
    const [actorSnapshot, schoolSnapshot, yearSnapshot, scheduleSnapshot, stateSnapshot] = await Promise.all([
      reader.doc(`users/${caller.uid}`).get(), reader.doc(`schools/${schoolId}`).get(), reader.doc(`schoolYears/${schoolYearId}`).get(),
      reader.doc(`timetables/${scheduleId}`).get(), reader.doc(`timetablePublicationStates/${digest([schoolId, schoolYearId])}`).get(),
    ]);
    const actor = actorSnapshot.data(), school = schoolSnapshot.data(), year = yearSnapshot.data(), schedule = scheduleSnapshot.data();
    if (!actor || actor.role !== "study_director" || actor.schoolId !== schoolId || actor.active === false || actor.status === "inactive"
      || !school || ["suspended", "inactive", "deleting"].includes(school.status)) fail(403, "permission-denied", "Compte ou établissement indisponible.");
    if (!year || year.schoolId !== schoolId || year.status !== "active") fail(403, "permission-denied", "L’année scolaire doit être active dans cet établissement.");
    if (!schedule || schedule.schoolId !== schoolId || schedule.schoolYearId !== schoolYearId || schedule.persistenceState === "PENDING") fail(409, "failed-precondition", "Horaire absent ou incomplet.");
    // Lot R5 : horaire d'une section (sectionId) ; sans sectionId, horaire de toute l'école comme avant.
    const section = timetableSection(schedule);
    if (schedule.sectionId !== undefined && !section) fail(409, "failed-precondition", "Section de l’horaire invalide.");
    const scoped = (collection) => reader.collection(collection).where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId).get().then(rows);
    const [teachers, users, subjects, sourceClasses, assignments, availabilities, periods, rooms, settings, allEntries, schedules] = await Promise.all([
      scoped("teachers"), reader.collection("users").where("schoolId", "==", schoolId).where("role", "==", "teacher").get().then(rows),
      scoped("subjects"), scoped("classes"), scoped("pedagogicalAssignments"), scoped("teacherAvailabilities"), scoped("schedulePeriods"),
      scoped("rooms"), scoped("attendanceSettings"), reader.collection("timetableEntries").where("scheduleId", "==", scheduleId).get().then(rows), scoped("timetables"),
    ]);
    const classes = [...new Map([...sourceClasses, ...logicalStudyClasses(sourceClasses)].map((item) => [item.id, item])).values()];
    const sections = userSectionIds(actor);
    // Horaire de section : celui qui agit sur cette section le valide et le publie.
    // Horaire de toute l'école : réservé à un compte qui agit pour toute l'école.
    const authority = timetableAuthority(actor, caller.uid, school);
    if (!canManageSections(authority, section ? [section] : [])) fail(403, "permission-denied", section ? "Cet horaire concerne une section hors de votre périmètre." : "Votre périmètre ne couvre pas toutes les sections de cet horaire d’établissement.");
    // Whole-school timetable: a section-limited director may not replace the
    // other sections' active timetable (unchanged check, kept).
    const activeAssignments = assignments.filter((item) => item.active);
    if (!section && sections.length && activeAssignments.some((item) => {
      const schoolClass = classes.find((row) => row.id === item.classId);
      return !schoolClass || !sections.includes(studyClassSection(schoolClass));
    })) fail(403, "permission-denied", "Votre périmètre ne couvre pas toutes les sections de cet horaire d’établissement.");
    const operationField = publishing ? "publicationRequestId" : "validationRequestId";
    const targetStatus = publishing ? "PUBLISHED" : "VALID";
    // A lost response can be retried without changing timestamps or publications.
    if (schedule[operationField] === requestId && schedule[`${operationField}Actor`] === caller.uid && schedule.status === targetStatus) {
      return { ok: true, status: schedule.status, replayed: true };
    }
    if (schedule.status !== (publishing ? "VALID" : "DRAFT") || schedule.updatedAt !== expectedUpdatedAt) fail(409, "schedule-conflict", "La version a changé. Rechargez les horaires et réessayez.");
    if (settings.length > 1) fail(409, "failed-precondition", "Plusieurs configurations de jours scolaires existent. Faites corriger cette ambiguïté.");
    const entries = allEntries.filter((item) => item.scheduleId === scheduleId && item.active !== false);
    const effectiveTeachers = teachers.map((teacher) => {
      const account = users.find((user) => user.id === teacher.userId);
      return { ...teacher, status: teacher.status !== "active" || teacher.userId && (!account || account.status === "inactive" || account.active === false) ? "inactive" : "active" };
    });
    const problem = { schoolId, schoolYearId, teachers: effectiveTeachers, subjects, classes, assignments, availabilities, periods, rooms,
      days: resolveAttendanceSchoolDays(settings[0]), maxSameAssignmentPeriodsPerDay: 2 };
    // Section : ses classes seulement, en respectant l'horaire publié des autres sections.
    const sectionContext = section ? await sectionValidationContext({ reader, schoolId, schoolYearId, section, schedules, classes: problem.classes, problem }) : undefined;
    const scopedProblem = sectionContext?.problem ?? problem;
    const report = sectionContext ? validateSectionTimetable(scopedProblem, entries, sectionContext.foreignEntries) : validateTimetable(problem, entries);
    if (!report.valid) {
      const error = new GradingApiError(409, "invalid-timetable", "L’horaire comporte des erreurs. Consultez le rapport et régénérez le brouillon.");
      error.report = report;
      throw error;
    }
    const sourceDigest = digest(sectionContext ? { problem: scopedProblem, entries, foreignEntries: sectionContext.foreignEntries } : { problem, entries });
    if (publishing && (!schedule.validationDigest || schedule.validationDigest !== sourceDigest)) fail(409, "stale-timetable", "Les sources ont changé ou cette ancienne validation n’est pas certifiée. Générez et validez un nouveau brouillon.");
    const allActive = activePublishedTimetables(schedules);
    // Une publication active par périmètre : toute l'école, et au plus une par section.
    const previous = allActive.filter((item) => (timetableSection(item) ?? null) === (section ?? null));
    if (previous.length > 1) fail(409, "ambiguous-publication", "Plusieurs publications actives historiques existent. Aucune publication n’a été modifiée.");
    if (publishing && (!Array.isArray(body.expectedPublishedIds) || JSON.stringify([...body.expectedPublishedIds].sort()) !== JSON.stringify(allActive.map((item) => item.id).sort()))) {
      fail(409, "publication-conflict", "La publication active a changé. Rechargez les horaires avant de réessayer.");
    }
    const now = new Date().toISOString();
    // Toute l'école : remplace toutes les publications (comme avant). Section : seulement la sienne.
    if (publishing) for (const item of section ? previous : allActive) transaction.update(db.doc(`timetables/${item.id}`), { activePublished: false, updatedAt: now });
    transaction.update(db.doc(`timetables/${scheduleId}`), {
      status: targetStatus, activeDraft: false, activePublished: publishing, updatedAt: now, workflowVersion: 1, validationDigest: sourceDigest,
      [publishing ? "publishedAt" : "validatedAt"]: now, [publishing ? "publishedBy" : "validatedBy"]: caller.uid,
      [operationField]: requestId, [`${operationField}Actor`]: caller.uid,
    });
    if (section) {
      transaction.set(db.doc(`timetablePublicationStates/${digest([schoolId, schoolYearId, section])}`), {
        schoolId, schoolYearId, sectionId: section, revision: (sectionContext.stateSnapshot.data()?.revision ?? 0) + 1,
        activeScheduleId: publishing ? scheduleId : previous[0]?.id ?? null, updatedAt: now, updatedBy: caller.uid,
      });
    } else transaction.set(db.doc(`timetablePublicationStates/${digest([schoolId, schoolYearId])}`), {
      schoolId, schoolYearId, revision: (stateSnapshot.data()?.revision ?? 0) + 1,
      activeScheduleId: publishing ? scheduleId : previous[0]?.id ?? null, updatedAt: now, updatedBy: caller.uid,
    });
    return { ok: true, status: targetStatus, report, replayed: false };
  });
}
