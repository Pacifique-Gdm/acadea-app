import { requireActiveSchoolYear } from "./schoolYear.js";

/** Adapter for existing recipient validators: every authorization read joins
 * the transaction that commits the message (including parent/child links). */
export async function transactionalMessagingContext(db, transaction, caller, schoolYearId) {
  const view = {
    doc(path) {
      const ref = db.doc(path);
      return { path, ref, get: () => transaction.get(ref) };
    },
    getAll: (...refs) => transaction.getAll(...refs.map((item) => item.ref)),
  };
  const profileSnapshot = await view.doc(`users/${caller.uid}`).get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  const schoolSnapshot = await view.doc(`schools/${caller.schoolId}`).get();
  if (!profile || profile.role !== caller.role || profile.schoolId !== caller.schoolId
      || profile.status !== "active" || profile.active === false
      || !schoolSnapshot.exists || schoolSnapshot.data()?.status !== "active"
      || caller.role === "parent" && profile.parentId !== caller.parentId) {
    throw Object.assign(new Error("Les autorisations ont changé. Actualisez puis réessayez."), { statusCode: 403, code: "permission-denied" });
  }
  await requireActiveSchoolYear(view, caller.schoolId, schoolYearId);
  return { db: view, caller: { ...caller, profile } };
}
