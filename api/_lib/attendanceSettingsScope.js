import { GradingApiError } from "./teacherGrading.js";
import { staffLabels } from "./staffLabels.js";
import { attendanceSettingsId, getClassSection, getSchoolSections, schoolSectionOrder, userSectionIds } from "./timetableValidationBundle.js";

// Lot R3 (réglages par section) : réglages de présence du Directeur de discipline.
// - Un Directeur SANS section écrit directement dans Firestore, comme avant (il ne passe pas ici).
// - Un Directeur AVEC sections enregistre par le serveur :
//   * « non limité » si ses sections couvrent TOUTES les sections de l'école : il garde les droits
//     d'aujourd'hui (enregistrement complet) ;
//   * « limité » sinon : le serveur repart du document actuel et ne remplace que SES sections
//     (heures et jours de section) et les heures des classes de SES sections.
// Les autres Directeurs de discipline ne sont pas comptés : seule la comparaison des sections compte.

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_FIELDS = ["normalArrival", "lateAfter"];
const MAX_CLASS_RULES = 500;

const fail = (status, code, message) => { throw new GradingApiError(status, code, message); };
const invalid = () => fail(400, "invalid-argument", "Réglages de présence invalides.");
const validId = (value) => typeof value === "string" && value.length > 0 && value.length <= 300 && !value.includes("/");
const plainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const activeAccount = (user) => Boolean(user) && user.status !== "inactive" && user.active !== false;

function cleanDays(value) {
  if (!Array.isArray(value) || value.length > DAYS.length || value.some((day) => !DAYS.includes(day))) invalid();
  return DAYS.filter((day) => value.includes(day));
}

function cleanDaySchedule(value) {
  if (value === undefined || value === null) return {};
  if (!plainObject(value)) invalid();
  const cleaned = {};
  for (const [day, entry] of Object.entries(value)) {
    if (!DAYS.includes(day) || !plainObject(entry) || Object.keys(entry).some((field) => !SCHEDULE_FIELDS.includes(field))) invalid();
    const next = {};
    for (const field of SCHEDULE_FIELDS) {
      if (entry[field] === undefined || entry[field] === "") continue;
      if (typeof entry[field] !== "string" || !TIME.test(entry[field])) invalid();
      next[field] = entry[field];
    }
    if (Object.keys(next).length) cleaned[day] = next;
  }
  return cleaned;
}

function cleanSectionMap(value, cleanValue) {
  if (value === undefined || value === null) return {};
  if (!plainObject(value) || Object.keys(value).some((section) => !schoolSectionOrder.includes(section))) invalid();
  return Object.fromEntries(Object.entries(value).map(([section, item]) => [section, cleanValue(item)]).filter(([, item]) => Array.isArray(item) ? item.length > 0 : Object.keys(item).length > 0));
}

function cleanClassMap(value) {
  if (value === undefined || value === null) return {};
  if (!plainObject(value) || Object.keys(value).length > MAX_CLASS_RULES || Object.keys(value).some((key) => !validId(key) || key.length > 200)) invalid();
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDaySchedule(item)]).filter(([, item]) => Object.keys(item).length > 0));
}

/** Section d'une règle de classe « Classe » ou « Classe__Option » : même calcul que l'écran. */
export function classRuleSection(key) {
  return getClassSection(String(key).split("__")[0]);
}

/** Limité = Directeur avec sections qui ne couvrent pas toutes les sections de l'école (calcul de getSchoolSections). */
export function attendanceSettingsScope({ actor, school }) {
  const sections = userSectionIds(actor ?? {});
  if (!sections.length) return { limited: false, sections: [] };
  const configured = getSchoolSections(school ?? {});
  const schoolSections = configured.length ? configured : [...schoolSectionOrder];
  const coversAll = schoolSections.every((section) => sections.includes(section));
  return { limited: !coversAll, sections };
}

/** Document complet d'un compte non limité : mêmes champs que l'écran d'aujourd'hui. */
export function fullAttendanceSettings(input, { id, schoolId, schoolYearId, now, uid }) {
  if (!plainObject(input)) invalid();
  const sectionSchoolDays = cleanSectionMap(input.sectionSchoolDays, cleanDays);
  return {
    id, schoolId, schoolYearId,
    schoolDays: Array.isArray(input.schoolDays) && input.schoolDays.length ? cleanDays(input.schoolDays) : invalid(),
    ...(Object.keys(sectionSchoolDays).length ? { sectionSchoolDays } : {}),
    defaultSchedule: cleanDaySchedule(input.defaultSchedule),
    sectionSchedule: cleanSectionMap(input.sectionSchedule, cleanDaySchedule),
    classSchedule: cleanClassMap(input.classSchedule),
    updatedAt: now,
    updatedBy: uid,
  };
}

/** Compte limité : seules SES sections et les classes de SES sections sont remplacées. */
export function sectionLimitedAttendanceSettings(current, input, sections, { id, schoolId, schoolYearId, now, uid }) {
  if (!plainObject(input)) invalid();
  const proposedSectionSchedule = cleanSectionMap(input.sectionSchedule, cleanDaySchedule);
  const proposedSectionDays = cleanSectionMap(input.sectionSchoolDays, cleanDays);
  const proposedClassSchedule = cleanClassMap(input.classSchedule);
  const sectionSchedule = { ...(current?.sectionSchedule ?? {}) };
  const sectionSchoolDays = { ...(current?.sectionSchoolDays ?? {}) };
  for (const section of sections) {
    if (proposedSectionSchedule[section]) sectionSchedule[section] = proposedSectionSchedule[section];
    else delete sectionSchedule[section];
    if (proposedSectionDays[section]) sectionSchoolDays[section] = proposedSectionDays[section];
    else delete sectionSchoolDays[section];
  }
  const classSchedule = { ...(current?.classSchedule ?? {}) };
  for (const key of new Set([...Object.keys(classSchedule), ...Object.keys(proposedClassSchedule)])) {
    if (!sections.includes(classRuleSection(key))) continue;
    if (proposedClassSchedule[key]) classSchedule[key] = proposedClassSchedule[key];
    else delete classSchedule[key];
  }
  if (Object.keys(classSchedule).length > MAX_CLASS_RULES) invalid();
  return { ...(current ?? {}), id, schoolId, schoolYearId, sectionSchedule, sectionSchoolDays, classSchedule, updatedAt: now, updatedBy: uid };
}

async function readScope(reader, caller, schoolId) {
  const [actorSnapshot, schoolSnapshot] = await Promise.all([
    reader.get(`users/${caller.uid}`),
    reader.get(`schools/${schoolId}`),
  ]);
  const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
  if (!actor || actor.role !== "discipline_director" || actor.schoolId !== schoolId || !activeAccount(actor)) fail(403, "permission-denied", "Compte non autorisé.");
  return { actor, ...attendanceSettingsScope({ actor, school: schoolSnapshot.exists ? schoolSnapshot.data() : {} }) };
}

export async function executeAttendanceSettings({ db, caller, body }) {
  const action = body?.action;
  const schoolId = body?.schoolId;
  if (!["attendance-settings-scope", "attendance-settings-save"].includes(action) || !validId(schoolId)) fail(400, "invalid-argument", "Demande invalide.");
  if (caller?.role !== "discipline_director" || caller.schoolId !== schoolId) fail(403, "permission-denied", "Réglages de présence non autorisés.");

  if (action === "attendance-settings-scope") {
    const scope = await readScope({ get: (path) => db.doc(path).get() }, caller, schoolId);
    return { limited: scope.limited, sections: scope.sections };
  }

  const schoolYearId = body.schoolYearId;
  if (!validId(schoolYearId) || !plainObject(body.settings)) fail(400, "invalid-argument", "Demande invalide.");
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;
  const id = attendanceSettingsId(schoolId, schoolYearId);
  const result = await db.runTransaction(async (transaction) => {
    const scope = await readScope({ get: (path) => transaction.get(db.doc(path)) }, caller, schoolId);
    // Un compte sans section écrit directement (règles Firestore) : rien à faire ici.
    if (!scope.sections.length) fail(403, "permission-denied", "Ce compte enregistre directement ses réglages.");
    const [yearSnapshot, settingsSnapshot] = await Promise.all([transaction.get(db.doc(`schoolYears/${schoolYearId}`)), transaction.get(db.doc(`attendanceSettings/${id}`))]);
    const year = yearSnapshot.exists ? yearSnapshot.data() : undefined;
    if (!year || year.schoolId !== schoolId || year.status !== "active") fail(403, "permission-denied", "L’année scolaire doit être active dans cet établissement.");
    const current = settingsSnapshot.exists ? settingsSnapshot.data() : undefined;
    if (current && (current.schoolId !== schoolId || current.schoolYearId !== schoolYearId)) fail(409, "failed-precondition", "Réglages incohérents ; aucune donnée modifiée.");
    if ((current?.updatedAt ?? null) !== expectedUpdatedAt) return { conflict: current?.updatedBy };
    const context = { id, schoolId, schoolYearId, now: new Date().toISOString(), uid: caller.uid };
    const next = scope.limited ? sectionLimitedAttendanceSettings(current, body.settings, scope.sections, context) : fullAttendanceSettings(body.settings, context);
    transaction.set(db.doc(`attendanceSettings/${id}`), next);
    return { settings: next, limited: scope.limited };
  });
  if ("conflict" in result) {
    let who = "une autre personne";
    if (result.conflict) {
      const label = (await staffLabels(db, schoolId, [result.conflict]).catch(() => ({})))[result.conflict];
      if (label) who = `${label.name}, ${label.functionLabel}`;
    }
    fail(409, "settings-conflict", `Déjà modifié par ${who}, rechargez avec la flèche ronde de l'en-tête.`);
  }
  return result;
}
