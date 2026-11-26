import { profileSections, teacherUserIdsInSections } from "./studySectionScope.js";

export class PedagogicalHistoryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function listPedagogicalActivity({ db, caller, body }) {
  const role = caller.role === "admin" ? "school_admin" : caller.role;
  if (!["teacher", "study_director", "school_admin"].includes(role) || !caller.schoolId || caller.schoolId !== body.schoolId) {
    throw new PedagogicalHistoryError(403, "permission-denied", "Historique non autorisé.");
  }
  const schoolYearId = String(body.schoolYearId || "");
  if (!schoolYearId || schoolYearId.length > 180) throw new PedagogicalHistoryError(400, "invalid-argument", "Année scolaire invalide.");
  const [user, year, school] = await Promise.all([db.doc(`users/${caller.uid}`).get(), db.doc(`schoolYears/${schoolYearId}`).get(), db.doc(`schools/${caller.schoolId}`).get()]);
  if (!user.exists || (user.data()?.role === "admin" ? "school_admin" : user.data()?.role) !== role || user.data()?.schoolId !== caller.schoolId || user.data()?.status === "inactive" || user.data()?.active === false || !year.exists || year.data()?.schoolId !== caller.schoolId || !school.exists || ["suspended", "inactive", "deleting"].includes(school.data()?.status)) {
    throw new PedagogicalHistoryError(403, "permission-denied", "Profil ou année scolaire non autorisé.");
  }
  let query = db.collection("pedagogicalActivityLogs")
    .where("schoolId", "==", caller.schoolId)
    .where("schoolYearId", "==", schoolYearId);
  if (role === "teacher") query = query.where("subjectUserId", "==", caller.uid);
  query = query.orderBy("createdAt", "desc").orderBy("__name__", "desc");
  const cursor = body.cursor;
  if (cursor !== undefined) {
    if (!cursor || typeof cursor.createdAt !== "string" || typeof cursor.id !== "string" || cursor.createdAt.length > 50 || cursor.id.length > 250) {
      throw new PedagogicalHistoryError(400, "invalid-argument", "Curseur invalide.");
    }
    query = query.startAfter(cursor.createdAt, cursor.id);
  }
  // Lot R2 : un compte Direction des études AVEC sections ne voit que l'activité des enseignants de ses sections.
  // Sans section (ou autre rôle) : rien ne change.
  const sections = role === "study_director" ? profileSections(user.data()) : [];
  if (sections.length) return listScopedActivity({ db, query, schoolId: caller.schoolId, schoolYearId, sections });
  const snapshot = await query.limit(51).get();
  const page = snapshot.docs.slice(0, 50);
  const items = page.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.schoolId === caller.schoolId && item.schoolYearId === schoolYearId && (role !== "teacher" || item.subjectUserId === caller.uid));
  const last = page.at(-1);
  return { ok: true, items, nextCursor: snapshot.docs.length > 50 && last ? { createdAt: last.data().createdAt, id: last.id } : null };
}

const PAGE_SIZE = 50;
const SCAN_SIZE = 100;
const MAX_SCANS = 10;

async function listScopedActivity({ db, query, schoolId, schoolYearId, sections }) {
  const allowedUserIds = await teacherUserIdsInSections({ db, sections, schoolId, schoolYearId });
  const items = [];
  let scanQuery = query;
  for (let scan = 0; scan < MAX_SCANS; scan += 1) {
    const snapshot = await scanQuery.limit(SCAN_SIZE).get();
    const docs = snapshot.docs;
    for (let index = 0; index < docs.length; index += 1) {
      const doc = docs[index], item = { id: doc.id, ...doc.data() };
      if (item.schoolId !== schoolId || item.schoolYearId !== schoolYearId || !allowedUserIds.has(item.subjectUserId)) continue;
      items.push(item);
      if (items.length === PAGE_SIZE) {
        const more = index < docs.length - 1 || docs.length === SCAN_SIZE;
        return { ok: true, items, nextCursor: more ? { createdAt: doc.data().createdAt, id: doc.id } : null };
      }
    }
    if (docs.length < SCAN_SIZE) return { ok: true, items, nextCursor: null };
    const last = docs.at(-1);
    scanQuery = query.startAfter(last.data().createdAt, last.id);
    if (scan === MAX_SCANS - 1) return { ok: true, items, nextCursor: { createdAt: last.data().createdAt, id: last.id } };
  }
  return { ok: true, items, nextCursor: null };
}
