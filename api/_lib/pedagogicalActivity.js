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
  const snapshot = await query.limit(51).get();
  const page = snapshot.docs.slice(0, 50);
  const items = page.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.schoolId === caller.schoolId && item.schoolYearId === schoolYearId && (role !== "teacher" || item.subjectUserId === caller.uid));
  const last = page.at(-1);
  return { ok: true, items, nextCursor: snapshot.docs.length > 50 && last ? { createdAt: last.data().createdAt, id: last.id } : null };
}
