export async function requireActiveApiUser(db, caller) {
  const snapshot = await db.doc(`users/${caller.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.status === "inactive" || profile.active === false) {
    throw Object.assign(new Error("Compte utilisateur inactif ou introuvable."), { statusCode: 403, code: "permission-denied" });
  }
  return caller;
}
