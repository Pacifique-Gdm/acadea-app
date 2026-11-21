// Lot SA-4 : drawer d'école léger pour le Super administrateur.
// Le serveur calcule les nombres affichés (élèves, parents, comptes, répartition par classe) et envoie
// l'historique page par page. Le navigateur ne lit plus les élèves, parents, paiements, dépenses,
// messages, notifications, valves, frais et journaux complets de l'école.
// Aucune règle Firestore. Historique : index `SCHOOL_HISTORY_INDEX` (accord de l'utilisateur), avec repli sans index.
import { FieldPath, Timestamp } from "firebase-admin/firestore";

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

/** Page `page` (à partir de 0) de l'historique déjà trié (méthode de repli, sans index). */
export function pageSchoolHistory(sorted, page, pageSize = SCHOOL_HISTORY_PAGE_SIZE) {
  const safePage = Number.isInteger(page) && page >= 0 ? page : 0;
  const start = safePage * pageSize;
  const hasMore = start + pageSize < sorted.length;
  return { logs: sorted.slice(start, start + pageSize), hasMore, cursor: hasMore ? `m:${safePage + 1}` : null, mode: "memory" };
}

const historyCache = new Map();

/** Vide les pages gardées (tests, ou après une action qui écrit dans le journal de l'école). */
export function forgetSchoolHistory(schoolId) {
  for (const key of historyCache.keys()) if (!schoolId || key.startsWith(`${schoolId}__`)) historyCache.delete(key);
}

const HISTORY_FIELDS = ["action", "details", "actorName", "createdAt", "schoolYearId"];

/**
 * Méthode de repli (tant que l'index n'est pas installé) : le serveur lit tout le journal de l'année
 * (champs utiles seulement), le trie et garde le résultat 2 minutes. La première page est toujours relue.
 */
async function readSchoolHistoryFromMemory(db, schoolId, schoolYearId, page, now, meter) {
  const key = `${schoolId}__${schoolYearId}`;
  const cached = historyCache.get(key);
  let sorted = page > 0 && cached && now - cached.at < SCHOOL_HISTORY_CACHE_MS ? cached.sorted : null;
  if (!sorted) {
    const snapshot = await db.collection("auditLogs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId)
      .select(...HISTORY_FIELDS).get();
    meter.reads += Math.max(1, snapshot.docs.length);
    sorted = sortSchoolHistory(rowsOf(snapshot));
    historyCache.delete(key);
    historyCache.set(key, { at: now, sorted });
    while (historyCache.size > SCHOOL_HISTORY_CACHE_MAX) historyCache.delete(historyCache.keys().next().value);
  }
  return pageSchoolHistory(sorted, page);
}

/**
 * Index Firestore de la lecture page par page (collection `auditLogs`).
 * Le même index sert aux deux formats de date du journal : horodatage du serveur et texte ISO des anciennes lignes.
 */
export const SCHOOL_HISTORY_INDEX = Object.freeze({
  collectionGroup: "auditLogs",
  queryScope: "COLLECTION",
  fields: Object.freeze([
    Object.freeze({ fieldPath: "schoolId", order: "ASCENDING" }),
    Object.freeze({ fieldPath: "schoolYearId", order: "ASCENDING" }),
    Object.freeze({ fieldPath: "createdAt", order: "DESCENDING" }),
  ]),
});

/** Vrai quand Firestore refuse la requête faute d'index (code 9, FAILED_PRECONDITION). */
export function isMissingIndexError(error) {
  return error?.code === 9 || error?.code === "failed-precondition" || /FAILED_PRECONDITION|requires an index/i.test(String(error?.message ?? ""));
}

/** Deux suites triées du plus récent au plus ancien : dates en texte (anciennes lignes) et horodatages du serveur. */
function historyStreams(db, schoolId, schoolYearId) {
  const base = () => db.collection("auditLogs").where("schoolId", "==", schoolId).where("schoolYearId", "==", schoolYearId);
  const ordered = (query) => query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
  return {
    s: {
      query: () => ordered(base().where("createdAt", ">=", "")),
      after: (position) => [position[0], position[1]],
      position: (doc) => [doc.get("createdAt"), doc.id],
    },
    t: {
      query: () => ordered(base().where("createdAt", ">=", Timestamp.fromMillis(0))),
      after: (position) => [new Timestamp(position[0], position[1]), position[2]],
      position: (doc) => { const value = doc.get("createdAt"); return [value.seconds, value.nanoseconds, doc.id]; },
    },
  };
}

const encodeCursor = (value) => `i:${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;

function decodeCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length > 2000) return null;
  if (/^m:\d{1,4}$/.test(cursor)) return { mode: "memory", page: Number(cursor.slice(2)) };
  if (!cursor.startsWith("i:")) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor.slice(2), "base64url").toString("utf8"));
    const valid = (position, size) => position === null || position === "end"
      || (Array.isArray(position) && position.length === size && position.every((item) => typeof item === "string" || Number.isInteger(item)));
    if (!value || !valid(value.s, 2) || !valid(value.t, 3)) return null;
    return { mode: "index", s: value.s, t: value.t };
  } catch { return null; }
}

/** Lit dans une suite jusqu'à `want` lignes visibles (les connexions sont sautées), par petits paquets. */
async function takeVisible(stream, cursor, want, meter) {
  const visible = [];
  if (cursor === "end") return { visible, exhausted: true };
  let after = cursor;
  let exhausted = false;
  const batch = want + 2;
  while (visible.length < want && !exhausted) {
    let query = stream.query().select(...HISTORY_FIELDS).limit(batch);
    if (after) query = query.startAfter(...stream.after(after));
    const snapshot = await query.get();
    meter.reads += Math.max(1, snapshot.docs.length);
    for (const doc of snapshot.docs) {
      after = stream.position(doc);
      const row = publicAuditLog({ id: doc.id, ...doc.data() });
      if (!isSessionAuditAction(row.action)) visible.push({ row, position: after });
    }
    if (snapshot.docs.length < batch) exhausted = true;
  }
  return { visible, exhausted };
}

/** Avec l'index : environ 2 × 13 documents lus par page, quelle que soit la taille du journal. */
async function readSchoolHistoryWithIndex(db, schoolId, schoolYearId, position, pageSize, meter) {
  const streams = historyStreams(db, schoolId, schoolYearId);
  const [fromText, fromTime] = await Promise.all([
    takeVisible(streams.s, position.s, pageSize + 1, meter),
    takeVisible(streams.t, position.t, pageSize + 1, meter),
  ]);
  const merged = [...fromText.visible.map((item) => ({ ...item, stream: "s" })), ...fromTime.visible.map((item) => ({ ...item, stream: "t" }))]
    .sort((first, second) => Date.parse(second.row.createdAt || 0) - Date.parse(first.row.createdAt || 0) || second.row.id.localeCompare(first.row.id));
  const taken = merged.slice(0, pageSize);
  const next = { s: position.s, t: position.t };
  for (const [name, result] of [["s", fromText], ["t", fromTime]]) {
    const mine = taken.filter((item) => item.stream === name);
    if (mine.length) next[name] = mine[mine.length - 1].position;
    if (result.exhausted && mine.length === result.visible.length) next[name] = "end";
  }
  const hasMore = merged.length > taken.length;
  return { logs: taken.map((item) => item.row), hasMore, cursor: hasMore ? encodeCursor(next) : null, mode: "index" };
}

/**
 * Historique d'une école et d'une année, page par page. `cursor` vient de la page précédente (rien pour la première).
 * Avec l'index `SCHOOL_HISTORY_INDEX`, seule la page demandée est lue dans la base. Sans index (pas encore installé),
 * repli automatique sur la lecture complète gardée 2 minutes : le drawer marche dans les deux cas.
 */
export async function readSchoolHistoryPage(db, schoolId, schoolYearId, cursor = null, { now = Date.now(), pageSize = SCHOOL_HISTORY_PAGE_SIZE, meter = { reads: 0 } } = {}) {
  const position = cursor ? decodeCursor(cursor) : { mode: "index", s: null, t: null };
  if (!position) throw Object.assign(new Error("Page d'historique invalide."), { statusCode: 400, code: "invalid-argument" });
  if (position.mode === "memory") return readSchoolHistoryFromMemory(db, schoolId, schoolYearId, position.page, now, meter);
  try {
    return await readSchoolHistoryWithIndex(db, schoolId, schoolYearId, position, pageSize, meter);
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    return readSchoolHistoryFromMemory(db, schoolId, schoolYearId, 0, now, meter);
  }
}
