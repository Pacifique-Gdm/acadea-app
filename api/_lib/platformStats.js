// Lot SA-3 : statistiques du Dashboard Super administrateur, calculées par le serveur
// avec des comptages (1 lecture par tranche de 1 000 documents), gardées dans platform/stats.
// Le Dashboard ne relit plus toutes les écoles pour afficher ses chiffres.

export const PLATFORM_STATS_PATH = "platform/stats";
/** Au-delà, les nombres d'élèves, de parents et d'administrateurs sont recalculés. */
export const PLATFORM_STATS_MAX_AGE_MS = 10 * 60_000;
/** Même demandé, un recalcul complet n'est pas refait à moins de 30 secondes du précédent. */
export const PLATFORM_STATS_MIN_FORCE_INTERVAL_MS = 30_000;
export const SCHOOL_STATUSES = Object.freeze(["active", "suspended", "pending", "inactive"]);
/** Écoles qui ne comptent plus : supprimées ou en cours de suppression. */
const GONE_SCHOOL_STATUSES = Object.freeze(["deleted", "deleting"]);

async function countOf(query) {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count ?? 0);
}

export async function computeSchoolCounts(db) {
  const schools = db.collection("schools");
  const [all, ...rest] = await Promise.all([
    countOf(schools),
    ...GONE_SCHOOL_STATUSES.map((status) => countOf(schools.where("status", "==", status))),
    ...SCHOOL_STATUSES.map((status) => countOf(schools.where("status", "==", status))),
  ]);
  const gone = rest.slice(0, GONE_SCHOOL_STATUSES.length).reduce((sum, value) => sum + value, 0);
  const byStatus = rest.slice(GONE_SCHOOL_STATUSES.length);
  return {
    total: Math.max(0, all - gone),
    ...Object.fromEntries(SCHOOL_STATUSES.map((status, index) => [status, byStatus[index]])),
  };
}

function timeOf(value) {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

export function isPlatformStatsShape(value) {
  const count = (item) => Number.isInteger(item) && item >= 0;
  return Boolean(value)
    && typeof value === "object"
    && value.schools && typeof value.schools === "object"
    && count(value.schools.total)
    && SCHOOL_STATUSES.every((status) => count(value.schools[status]))
    && count(value.students) && count(value.parents) && count(value.admins)
    && timeOf(value.computedAt) !== null;
}

/** Vrai si les chiffres gardés peuvent être servis tels quels. */
export function isPlatformStatsFresh(stats, nowMs, maxAgeMs = PLATFORM_STATS_MAX_AGE_MS) {
  if (!isPlatformStatsShape(stats) || stats.stale === true) return false;
  const computed = timeOf(stats.computedAt);
  return computed !== null && computed <= nowMs + 60_000 && nowMs - computed < maxAgeMs;
}

function publicStats(stats) {
  const { schools, students, parents, admins, computedAt, schoolsComputedAt } = stats;
  return { schools, students, parents, admins, computedAt, schoolsComputedAt: schoolsComputedAt ?? computedAt };
}

/**
 * Lit les chiffres du Dashboard.
 * - Écoles et administrateurs : recomptés à CHAQUE lecture (peu coûteux : 1 lecture par tranche
 *   de 1 000), donc toujours conformes à la base, même après un script ou une modification directe.
 * - Élèves et parents (coûteux à grande échelle) : gardés dans platform/stats et recalculés si
 *   absents, périmés (10 min) ou demandés par « Actualiser » (au plus toutes les 30 s).
 */
export async function readPlatformStats(db, { force = false, now = new Date() } = {}) {
  const ref = db.doc(PLATFORM_STATS_PATH);
  const nowMs = now.getTime();
  const [snapshot, schools, admins] = await Promise.all([
    ref.get(),
    computeSchoolCounts(db),
    countOf(db.collection("users").where("role", "==", "school_admin")),
  ]);
  const stored = snapshot.exists ? snapshot.data() : null;
  const recentEnough = stored && isPlatformStatsShape(stored) && stored.stale !== true
    && nowMs - (timeOf(stored.computedAt) ?? 0) < PLATFORM_STATS_MIN_FORCE_INTERVAL_MS;
  const nowIso = now.toISOString();
  if (isPlatformStatsFresh(stored, nowMs) && (!force || recentEnough)) {
    const stats = { ...publicStats(stored), schools, admins, schoolsComputedAt: nowIso };
    await ref.set({ schools, admins, schoolsComputedAt: nowIso }, { merge: true });
    return stats;
  }
  const [students, parents] = await Promise.all([countOf(db.collection("students")), countOf(db.collection("parents"))]);
  const stats = { schools, students, parents, admins, computedAt: nowIso, schoolsComputedAt: nowIso };
  await ref.set({ ...stats, stale: false });
  return stats;
}
