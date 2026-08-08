const ALLOWED_SENDERS = new Set(["school_admin", "admin", "cashier", "discipline_director", "secretary"]);

const RECIPIENTS_BY_ROLE = Object.freeze({
  school_admin: new Set(["secretary", "parent"]),
  cashier: new Set(["secretary", "parent"]),
  discipline_director: new Set(["secretary", "parent"]),
  secretary: new Set(["school_admin", "cashier", "discipline_director", "parent"]),
});

export function normalizedMessagingRole(value) {
  return value === "admin" ? "school_admin" : value;
}

export function allowedRecipientRoles(role) {
  return RECIPIENTS_BY_ROLE[normalizedMessagingRole(role)] ?? new Set();
}

export async function requireMessagingCaller(auth, db, token) {
  const decoded = await auth.verifyIdToken(token, true);
  const role = normalizedMessagingRole(decoded.role);
  if (!decoded.schoolId || !ALLOWED_SENDERS.has(decoded.role) || allowedRecipientRoles(role).size === 0) {
    throw Object.assign(new Error("Action non autorisee."), { statusCode: 403, code: "not-authorized" });
  }
  const snapshot = await db.doc(`users/${decoded.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || normalizedMessagingRole(profile.role) !== role || profile.schoolId !== decoded.schoolId || profile.active === false || profile.status === "inactive") {
    throw Object.assign(new Error("Profil utilisateur non autorise."), { statusCode: 403, code: "not-authorized" });
  }
  return { uid: decoded.uid, schoolId: decoded.schoolId, role, profile };
}

export async function listAllowedMessageRecipients(db, caller) {
  const allowed = allowedRecipientRoles(caller.role);
  if (allowed.size === 0) throw Object.assign(new Error("Action non autorisee."), { statusCode: 403, code: "not-authorized" });
  const snapshot = await db.collection("users").where("schoolId", "==", caller.schoolId).get();
  return snapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((profile) => profile.id !== caller.uid && profile.active !== false && profile.status !== "inactive" && allowed.has(normalizedMessagingRole(profile.role)))
    .map((profile) => ({
      uid: profile.id,
      name: String(profile.displayName ?? profile.name ?? "Utilisateur").trim() || "Utilisateur",
      role: normalizedMessagingRole(profile.role),
    }))
    .sort((first, second) => first.name.localeCompare(second.name, "fr"));
}
