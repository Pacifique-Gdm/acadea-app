// Lot SA-4 : drawer d'école léger pour le Super administrateur.
// Le serveur calcule les nombres affichés (élèves, parents, comptes, répartition par classe) et envoie
// l'historique page par page. Le navigateur ne lit plus les élèves, parents, paiements, dépenses,
// messages, notifications, valves, frais et journaux complets de l'école.
// Aucune règle Firestore ni aucun index nouveau : requêtes « == » seulement, avec projection des champs utiles.

/** Lignes d'historique envoyées par page. */
export const SCHOOL_HISTORY_PAGE_SIZE = 10;
/** Pages d'historique gardées par le serveur (même instance) avant une nouvelle lecture. */
export const SCHOOL_HISTORY_CACHE_MS = 2 * 60_000;
const SCHOOL_HISTORY_CACHE_MAX = 50;
/** Comptes comptés dans « Utilisateurs » (même liste que l'écran avant le lot 4). */
export const SCHOOL_USER_ROLES = Object.freeze(["school_admin", "parent", "cashier", "discipline_director", "secretary"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

export const isSafeSchoolScopeId = (value) => typeof value === "string" && SAFE_ID.test(value);

const isArchivedStudent = (student) => Boolean(student.deletedAt) || (student.status ?? "ACTIVE") !== "ACTIVE";
const text = (value) => (typeof value === "string" ? value : "");

/**
 * Calcule les nombres du drawer, avec exactement les mêmes règles que l'écran avant le lot 4
 * (`getPlatformSchoolStats` et la répartition par classe de `PlatformModule`).
 */
export function summarizeSchoolDrawer({ students, parents, users, schoolYearId }) {
  const studentIds = new Set(students.map((student) => student.id));
  const parentIdsOfStudents = new Set(students.map((student) => student.parentId).filter(Boolean));
  const parentCount = parents.filter((parent) => (Array.isArray(parent.studentIds) && parent.studentIds.some((id) => studentIds.has(id)))
    || parentIdsOfStudents.has(parent.id)).length;
  const usersForYear = users.filter((item) => !item.removedAt && (!item.activeSchoolYearId || item.activeSchoolYearId === schoolYearId));
  const classes = new Map();
  for (const student of students) {
    if (isArchivedStudent(student)) continue;
    const className = text(student.className);
    const option = text(student.option);
    const key = `${className}::${option}`;
    const current = classes.get(key);
    classes.set(key, { className, option, count: (current?.count ?? 0) + 1 });
  }
  return {
    students: students.length,
    parents: parentCount,
    admins: usersForYear.filter((item) => item.role === "school_admin").length,
    users: usersForYear.filter((item) => SCHOOL_USER_ROLES.includes(item.role)).length,
    classes: [...classes.values()],
  };
}

const rowsOf = (snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));

/** Nombres du drawer d'une école et d'une année. Seuls les champs utiles sont lus et rien n'est envoyé d'autre. */
export async function readSchoolDrawerSummary(db, schoolId, schoolYearId) {
  const [students, parents, users] = await Promise.all([
    db.collection("students").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)
      .select("className", "option", "status", "deletedAt", "parentId").get(),
    db.collection("parents").where("schoolId", "==", schoolId).select("studentIds").get(),
    db.collection("users").where("schoolId", "==", schoolId).select("role", "removedAt", "activeSchoolYearId").get(),
  ]);
  return summarizeSchoolDrawer({ students: rowsOf(students), parents: rowsOf(parents), users: rowsOf(users), schoolYearId });
}

/** Date d'une ligne de journal en millisecondes (horodatage du serveur ou texte ISO des anciennes lignes). */
export function auditTime(value) {
  if (!value) return 0;
  if (typeof value === "string") { const time = Date.parse(value); return Number.isFinite(time) ? time : 0; }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

/** Une ligne d'historique réduite à ce que le drawer affiche. */
function publicAuditLog(row) {
  const time = auditTime(row.createdAt);
  return {
    id: row.id,
    action: text(row.action) || text(row.details),
    actorName: text(row.actorName),
    createdAt: time ? new Date(time).toISOString() : "",
    ...(text(row.schoolYearId) ? { schoolYearId: row.schoolYearId } : {}),
  };
}

/** Lignes de connexion et de déconnexion : jamais affichées dans l'historique de l'école (même règle que l'écran). */
export function isSessionAuditAction(action) {
  const normalized = text(action).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return ["connexion", "deconnexion", "login", "logout", "sign in", "sign out"].some((item) => normalized.includes(item));
}

/** Lignes du journal triées de la plus récente à la plus ancienne, sans les connexions. */
export function sortSchoolHistory(rows) {
  return rows.map(publicAuditLog).filter((row) => !isSessionAuditAction(row.action)).sort((first, second) => Date.parse(second.createdAt || 0) - Date.parse(first.createdAt || 0)
    || second.id.localeCompare(first.id));
}

/** Page `page` (à partir de 0) de l'historique déjà trié. */
export function pageSchoolHistory(sorted, page, pageSize = SCHOOL_HISTORY_PAGE_SIZE) {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const start = safePage * pageSize;
  return { logs: sorted.slice(start, start + pageSize), page: safePage, total: sorted.length, hasMore: start + pageSize < sorted.length };
}

const historyCache = new Map();

/** Vide les pages gardées (tests, ou après une action qui écrit dans le journal de l'école). */
export function forgetSchoolHistory(schoolId) {
  for (const key of historyCache.keys()) if (!schoolId || key.startsWith(`${schoolId}__`)) historyCache.delete(key);
}

/**
 * Historique d'une école et d'une année, page par page. Le serveur lit le journal (champs utiles seulement),
 * le trie et garde le résultat 2 minutes : « Voir plus » ne relit pas tout. La page 0 est toujours relue.
 */
export async function readSchoolHistoryPage(db, schoolId, schoolYearId, page = 0, { now = Date.now() } = {}) {
  const key = `${schoolId}__${schoolYearId}`;
  const cached = historyCache.get(key);
  let sorted = page > 0 && cached && now - cached.at < SCHOOL_HISTORY_CACHE_MS ? cached.sorted : null;
  if (!sorted) {
    const snapshot = await db.collection("auditLogs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)
      .select("action", "details", "actorName", "createdAt", "schoolYearId").get();
    sorted = sortSchoolHistory(rowsOf(snapshot));
    historyCache.delete(key);
    historyCache.set(key, { at: now, sorted });
    while (historyCache.size > SCHOOL_HISTORY_CACHE_MAX) historyCache.delete(historyCache.keys().next().value);
  }
  return pageSchoolHistory(sorted, page);
}
