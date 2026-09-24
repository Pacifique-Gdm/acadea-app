export async function requireActiveApiUser(db, caller) {
  const snapshot = await db.doc(`users/${caller.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.status === "inactive" || profile.active === false) {
    throw Object.assign(new Error("Compte utilisateur inactif ou introuvable."), { statusCode: 403, code: "permission-denied" });
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
