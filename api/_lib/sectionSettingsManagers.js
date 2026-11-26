import { randomId as uid } from "./randomId.js";
import { AUDIT_EVENT_TYPES, buildServerAudit } from "./serverAudit.js";

// Lot R6 (réglages par section) : « Responsable des réglages de la section ».
// La case n'existe que pour une section secondaire (CTEB ou Secondaire) qui a à la fois
// un Préfet d'études ET un Directeur des études. Un seul responsable par section.
// Le document sectionSettingsManagers/{école} est écrit ici seulement (jamais par l'application).
export const SECTION_MANAGERS_COLLECTION = "sectionSettingsManagers";
export const MANAGED_SECTIONS = Object.freeze(["CTEB", "Secondaire"]);
const STUDY_FUNCTIONS = new Set(["director_of_studies", "prefect_of_studies", "primary_director", "nursery_director"]);

const fail = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code });

/** Sections du compte : sectionIds, sinon section (comme l'écran). */
export function accountSections(user) {
  const ids = Array.isArray(user?.sectionIds) ? user.sectionIds.filter((value) => typeof value === "string" && value) : [];
  if (ids.length) return [...new Set(ids)];
  return typeof user?.section === "string" && user.section ? [user.section] : [];
}

/** Fonction d'un compte de la Direction des études ; sans fonction connue : Directeur des études. */
export function studyFunctionOf(user) {
  return STUDY_FUNCTIONS.has(user?.studyFunction) ? user.studyFunction : "director_of_studies";
}

function activeStudyAccount(user, schoolId) {
  return Boolean(user) && user.role === "study_director" && user.schoolId === schoolId && user.status !== "inactive" && user.active !== false;
}

/** Vrai si la section a à la fois un Préfet d'études et un Directeur des études (comptes actifs rattachés à la section). */
export function sectionNeedsManager(users, schoolId, section) {
  if (!MANAGED_SECTIONS.includes(section)) return false;
  const members = (users ?? []).filter((user) => activeStudyAccount(user, schoolId) && accountSections(user).includes(section));
  return members.some((user) => studyFunctionOf(user) === "prefect_of_studies") && members.some((user) => studyFunctionOf(user) === "director_of_studies");
}

/** Sections pour lesquelles la case est proposée à ce compte. */
export function eligibleManagerSections(users, schoolId, target) {
  if (!activeStudyAccount(target, schoolId)) return [];
  return accountSections(target).filter((section) => sectionNeedsManager(users, schoolId, section));
}

/** Désignations encore valables : le responsable est toujours actif, garde la section, et la section remplit encore la condition. */
export function validManagers(managers, users, schoolId) {
  const result = {};
  for (const section of MANAGED_SECTIONS) {
    const entry = managers?.[section];
    const manager = entry && (users ?? []).find((user) => user.id === entry.userId);
    if (manager && eligibleManagerSections(users, schoolId, manager).includes(section)) result[section] = entry;
  }
  return result;
}

/** Sections dont la désignation tombe quand un compte change (archivé, sections modifiées, fonction modifiée). */
export function staleManagerSections(managers, users, schoolId) {
  const valid = validManagers(managers, users, schoolId);
  return MANAGED_SECTIONS.filter((section) => managers?.[section] && !valid[section]);
}

async function schoolStudyAccounts(reader, db, schoolId) {
  const snapshot = await reader.get(db.collection("users").where("schoolId", "==", schoolId).where("role", "==", "study_director"));
  return snapshot.docs.map((item) => ({ ...item.data(), id: item.id }));
}

/**
 * Lit (dans la transaction) ce qu'il faut pour retirer les désignations devenues invalides après le changement d'un compte.
 * Renvoie une fonction d'écriture à appeler après toutes les lectures, ou null si rien ne change.
 */
export async function prepareManagerCleanup({ reader, db, schoolId, changedUser }) {
  const ref = db.doc(`${SECTION_MANAGERS_COLLECTION}/${schoolId}`);
  const snapshot = await reader.get(ref);
  const managers = snapshot.exists ? snapshot.data()?.managers ?? {} : {};
  if (!MANAGED_SECTIONS.some((section) => managers[section])) return null;
  const users = (await schoolStudyAccounts(reader, db, schoolId)).filter((user) => user.id !== changedUser.id);
  users.push(changedUser);
  const stale = staleManagerSections(managers, users, schoolId);
  if (!stale.length) return null;
  const next = { ...managers };
  stale.forEach((section) => { delete next[section]; });
  return (writer, now, actorId) => writer.set(ref, { schoolId, managers: next, updatedAt: now, updatedBy: actorId });
}

/** Action « set-section-settings-manager » : réservée à l'administrateur de l'école. */
export async function setSectionSettingsManager({ db, caller, body }) {
  const schoolId = typeof body?.schoolId === "string" ? body.schoolId.trim() : "";
  const section = typeof body?.section === "string" ? body.section : "";
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const enabled = body?.enabled === true;
  const expectedUserId = typeof body?.expectedUserId === "string" && body.expectedUserId ? body.expectedUserId : null;
  if (caller?.role !== "school_admin" || !schoolId || caller.schoolId !== schoolId) throw fail(403, "permission-denied", "Seul l'administrateur de l'école désigne le responsable des réglages.");
  if (!MANAGED_SECTIONS.includes(section) || !userId || userId.includes("/")) throw fail(400, "invalid-argument", "Section ou personnel invalide.");
  const callerSnapshot = await db.doc(`users/${caller.uid}`).get();
  const callerProfile = callerSnapshot.data();
  if (!callerSnapshot.exists || callerProfile?.role !== "school_admin" || callerProfile?.schoolId !== schoolId || callerProfile?.status === "inactive" || callerProfile?.active === false) {
    throw fail(403, "permission-denied", "Compte administrateur non autorisé.");
  }
  const ref = db.doc(`${SECTION_MANAGERS_COLLECTION}/${schoolId}`);
  const auditRef = db.collection("auditLogs").doc(uid("audit"));
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const users = await schoolStudyAccounts(transaction, db, schoolId);
    const managers = validManagers(snapshot.exists ? snapshot.data()?.managers ?? {} : {}, users, schoolId);
    const currentUserId = managers[section]?.userId ?? null;
    const now = new Date().toISOString();
    const next = { ...managers };
    if (enabled) {
      const target = users.find((user) => user.id === userId);
      if (!eligibleManagerSections(users, schoolId, target).includes(section)) throw fail(409, "failed-precondition", "Cette personne ne peut pas être responsable de cette section : la section doit avoir un Préfet d'études et un Directeur des études.");
      if (currentUserId === userId) return { managers };
      if (currentUserId !== expectedUserId) throw fail(409, "conflict", "Le responsable a déjà été modifié, rechargez.");
      next[section] = { userId, updatedAt: now, updatedBy: caller.uid };
    } else {
      if (currentUserId !== userId) return { managers };
      delete next[section];
    }
    transaction.set(ref, { schoolId, managers: next, updatedAt: now, updatedBy: caller.uid });
    transaction.create(auditRef, buildServerAudit({ id: auditRef.id, eventType: AUDIT_EVENT_TYPES.USER_UPDATED, actor: caller, schoolId, resourceType: "user", resourceId: userId, metadata: { sectionSettingsManager: section, enabled, previousUserId: currentUserId } }));
    return { managers: next };
  });
}

/** Format attendu par resolveSectionAuthority(…, { sectionSettingsManagers }) : section → identifiant du compte désigné. */
export function toAuthorityManagers(managers) {
  const result = {};
  for (const section of MANAGED_SECTIONS) {
    const userId = managers?.[section]?.userId;
    if (typeof userId === "string" && userId) result[section] = userId;
  }
  return result;
}

/** Lit le document de l'école et renvoie la correspondance section → compte désigné (vide s'il n'y en a pas). */
export async function loadSectionSettingsManagers(db, schoolId, reader = { get: (ref) => ref.get() }) {
  if (!schoolId) return {};
  const snapshot = await reader.get(db.doc(`${SECTION_MANAGERS_COLLECTION}/${schoolId}`));
  const data = snapshot.exists ? snapshot.data() : undefined;
  return data?.schoolId === schoolId ? toAuthorityManagers(data.managers) : {};
}
