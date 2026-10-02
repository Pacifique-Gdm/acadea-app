export async function requireActiveApiUser(db, caller) {
  const snapshot = await db.doc(`users/${caller.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.status === "inactive" || profile.active === false) {
    throw Object.assign(new Error("Compte utilisateur inactif ou introuvable."), { statusCode: 403, code: "permission-denied" });
  }
  if (["admin", "school_admin", "secretary", "cashier", "study_director", "discipline_director", "teacher", "parent"].includes(caller.role)) {
    if (!caller.schoolId || profile.schoolId !== caller.schoolId) {
      throw Object.assign(new Error("École du compte invalide."), { statusCode: 403, code: "permission-denied" });
    }
    const schoolSnapshot = await db.doc(`schools/${caller.schoolId}`).get();
    if (!schoolSnapshot.exists || ["suspended", "inactive", "deleting"].includes(schoolSnapshot.data()?.status)) {
      throw Object.assign(new Error("École indisponible."), { statusCode: 403, code: "permission-denied" });
    }
  }
  return caller;
}

const INVALID_ID_TOKEN_CODES = new Set([
  "auth/argument-error",
  "auth/invalid-id-token",
  "auth/id-token-expired",
  "auth/id-token-revoked",
  "auth/user-disabled",
]);

export async function verifyActorIdToken(auth, token) {
  try {
    return await auth.verifyIdToken(token, true);
  } catch (error) {
    if (!INVALID_ID_TOKEN_CODES.has(error?.code)) throw error;
    throw Object.assign(new Error("Session invalide ou expirée."), { statusCode: 401, code: "unauthenticated" });
  }
}
