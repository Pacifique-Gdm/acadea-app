import { GradingApiError } from "./teacherGrading.js";
import { resolveAttendanceSchoolDays, studyClassSection, userSectionIds } from "./timetableValidationBundle.js";

const fail = (status, code, message) => { throw new GradingApiError(status, code, message); };
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 300 && !value.includes("/");
const DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]);
const VACATIONS = new Set(["morning", "afternoon", "full", "none"]);
const scopedRows = (snapshot) => snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
function periodTargetsOverlap(left, right) {
  if (left.targetPairs && right.targetPairs) return left.targetPairs.some((pair) => right.targetPairs.includes(pair));
  if (!left.targetPairs && !right.targetPairs) return (left.dayScope ?? "weekdays") === (right.dayScope ?? "weekdays");
  const targeted = left.targetPairs ?? right.targetPairs, legacy = left.targetPairs ? right : left;
  return targeted.some((pair) => legacy.dayScope === "saturday" ? pair.endsWith("|saturday") : !pair.endsWith("|saturday"));
}

export async function executeStudyPeriodMutation({ db, caller, body }) {
  const { action, schoolId, schoolYearId } = body;
  if (![schoolId, schoolYearId].every(validId) || !["study-period-save", "study-period-active", "study-class-vacations"].includes(action)) {
    fail(400, "invalid-argument", "Demande de périodes invalide.");
  }
  if (caller.role !== "study_director" || caller.schoolId !== schoolId) fail(403, "permission-denied", "Périmètre pédagogique non autorisé.");
  try {
    return await db.runTransaction(async (tx) => {
      const ref = (path) => db.doc(path);
      const [actorSnap, schoolSnap, yearSnap, classSnap, periodSnap, settingsSnap, scheduleSnap] = await Promise.all([
        tx.get(ref(`users/${caller.uid}`)), tx.get(ref(`schools/${schoolId}`)), tx.get(ref(`schoolYears/${schoolYearId}`)),
        tx.get(db.collection("classes").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
        tx.get(db.collection("schedulePeriods").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
        tx.get(db.collection("attendanceSettings").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
        tx.get(db.collection("timetables").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)),
      ]);
      const actor = actorSnap.data(), school = schoolSnap.data(), year = yearSnap.data();
      if (!actor || actor.role !== "study_director" || actor.schoolId !== schoolId || actor.active === false || actor.status === "inactive"
        || !school || ["suspended", "inactive", "deleting"].includes(school.status)
        || !year || year.schoolId !== schoolId || year.status !== "active") fail(403, "permission-denied", "Compte, école ou année scolaire indisponible.");
      const classes = scopedRows(classSnap), periods = scopedRows(periodSnap), settings = scopedRows(settingsSnap), schedules = scopedRows(scheduleSnap);
      if (classes.length > 400 || periods.length > 400 || schedules.length > 100 || settings.length > 1) fail(409, "failed-precondition", "Configuration trop volumineuse ou ambiguë ; aucune donnée modifiée.");
      const allowedSections = userSectionIds(actor);
      const allowedClass = (item) => item && item.schoolId === schoolId && item.schoolYearId === schoolYearId && item.active !== false
        && (!allowedSections.length || allowedSections.includes(studyClassSection(item)));
      const schoolDays = new Set(resolveAttendanceSchoolDays(settings[0]));
      const established = schedules.filter((item) => item.status === "VALID" || item.status === "PUBLISHED");
      const entrySnaps = await Promise.all(established.map((item) => tx.get(db.collection("timetableEntries").where("scheduleId", "==", item.id))));
      const entries = entrySnaps.flatMap(scopedRows);
      if (entries.length > 4000 || entries.some((item) => item.schoolId !== schoolId || item.schoolYearId !== schoolYearId)) fail(409, "failed-precondition", "Horaire établi trop volumineux ou incohérent ; aucune donnée modifiée.");
      const now = new Date().toISOString();
      if (action === "study-class-vacations") {
        const updates = body.updates;
        if (!Array.isArray(updates) || updates.length < 1 || updates.length > 400 || new Set(updates.map((item) => item.id)).size !== updates.length) fail(400, "invalid-argument", "Sélection de classes invalide.");
        for (const update of updates) {
          const item = classes.find((row) => row.id === update.id);
          if (!allowedClass(item) || !update.dayVacations || typeof update.dayVacations !== "object" || Array.isArray(update.dayVacations)
            || Object.keys(update.dayVacations).some((day) => !DAYS.has(day) || !VACATIONS.has(update.dayVacations[day])
              || !schoolDays.has(day) && update.dayVacations[day] !== item.dayVacations?.[day])) fail(403, "permission-denied", "Classe ou vacation hors périmètre.");
          if (item.updatedAt !== update.expectedUpdatedAt) fail(409, "schedule-conflict", "La classe a changé. Rechargez et réessayez.");
          if (entries.some((entry) => entry.active !== false && entry.classId === item.id)) fail(409, "established-schedule", "Un horaire validé ou publié utilise cette classe. Aucune vacation modifiée.");
        }
        for (const update of updates) tx.update(ref(`classes/${update.id}`), { dayVacations: update.dayVacations, updatedAt: now });
        return { ok: true, updated: updates.length };
      }
      const item = body.item;
      if (!item || !validId(item.id) || item.schoolId !== schoolId || item.schoolYearId !== schoolYearId) fail(400, "invalid-argument", "Période hors périmètre.");
      const previous = periods.find((row) => row.id === item.id);
      if ((previous?.updatedAt ?? null) !== (body.expectedUpdatedAt ?? null)) fail(409, "schedule-conflict", "La période a changé. Rechargez et réessayez.");
      if (action === "study-period-active") {
        if (!previous || previous.createdBy !== item.createdBy || item.active !== false) fail(400, "invalid-argument", "Désactivation invalide.");
        if (entries.some((entry) => entry.active !== false && entry.periodId === item.id)) fail(409, "established-schedule", "Un horaire validé ou publié utilise cette période.");
        tx.update(ref(`schedulePeriods/${item.id}`), { active: false, updatedAt: now });
        return { ok: true };
      }
      const keys = Object.keys(item);
      if (keys.some((key) => !["id", "schoolId", "schoolYearId", "label", "startTime", "endTime", "order", "type", "vacation", "dayScope", "targetPairs", "active", "createdBy", "createdAt", "updatedAt"].includes(key))
        || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120
        || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime) || item.startTime >= item.endTime
        || !Number.isInteger(item.order) || item.order < 1 || item.order > 100 || !["course", "break", "recess"].includes(item.type)
        || !["morning", "afternoon"].includes(item.vacation) || !["weekdays", "saturday"].includes(item.dayScope)
        || typeof item.active !== "boolean" || (item.targetPairs !== undefined && (!Array.isArray(item.targetPairs) || item.targetPairs.length < 1 || item.targetPairs.length > 400
        || new Set(item.targetPairs).size !== item.targetPairs.length))) fail(400, "invalid-argument", "Période ou groupe invalide.");
      if (!previous && !item.targetPairs) fail(400, "invalid-argument", "Une nouvelle période doit cibler un groupe de classes et de jours.");
      if (previous && Boolean(previous.targetPairs) !== Boolean(item.targetPairs)) fail(409, "failed-precondition", "La portée historique de cette période ne peut pas être changée.");
      for (const pair of item.targetPairs ?? []) {
        if (typeof pair !== "string" || pair.length > 350 || pair.split("|").length !== 2) fail(400, "invalid-argument", "Couple classe/jour invalide.");
        const [classId, day] = pair.split("|");
        const schoolClass = classes.find((row) => row.id === classId);
        const classVacation = schoolClass?.dayVacations?.[day] ?? (day === "saturday" && schoolClass?.saturdayEnabled === false ? "none" : day === "saturday" ? schoolClass?.saturdayVacation ?? schoolClass?.vacation ?? "morning" : schoolClass?.vacation ?? "morning");
        if (!DAYS.has(day) || !schoolDays.has(day) || !allowedClass(schoolClass) || (classVacation !== item.vacation && classVacation !== "full")) fail(403, "permission-denied", "Classe, jour ou vacation hors périmètre.");
      }
      if (previous && (previous.createdBy !== item.createdBy || previous.createdAt !== item.createdAt || previous.schoolId !== schoolId || previous.schoolYearId !== schoolYearId)) fail(403, "permission-denied", "Identité de période modifiée.");
      if (!previous && (item.createdBy !== caller.uid || !item.id.startsWith(`${schoolId}__${schoolYearId}__`))) fail(403, "permission-denied", "Création de période non autorisée.");
      if (previous && entries.some((entry) => entry.active !== false && entry.periodId === item.id)) fail(409, "established-schedule", "Un horaire validé ou publié utilise cette période.");
      if (periods.some((other) => other.id !== item.id && other.active !== false && (other.vacation ?? "morning") === item.vacation
        && periodTargetsOverlap(other, item)
        && (other.order === item.order || other.startTime < item.endTime && item.startTime < other.endTime))) {
        fail(409, "overlapping-period", "Une période existante chevauche ce groupe ou utilise le même ordre.");
      }
      tx.set(ref(`schedulePeriods/${item.id}`), { ...item, updatedAt: now });
      return { ok: true };
    }, { maxAttempts: 3 });
  } catch (error) {
    if (error?.code === 10 || error?.code === "aborted") fail(409, "schedule-conflict", "La configuration a changé. Rechargez et réessayez.");
    throw error;
  }
}
