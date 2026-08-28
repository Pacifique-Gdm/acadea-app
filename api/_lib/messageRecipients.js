const ALLOWED_SENDERS = new Set(["school_admin", "admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "parent"]);

const RECIPIENTS_BY_ROLE = Object.freeze({
  school_admin: new Set(["cashier", "secretary", "discipline_director", "study_director", "teacher", "parent", "coordination_admin", "sub_coordination_admin"]),
  cashier: new Set(["school_admin", "secretary", "discipline_director", "study_director", "teacher", "parent"]),
  discipline_director: new Set(["school_admin", "cashier", "secretary", "study_director", "teacher", "parent"]),
  study_director: new Set(["school_admin", "cashier", "secretary", "discipline_director", "teacher", "parent"]),
  secretary: new Set(["school_admin", "cashier", "discipline_director", "study_director", "teacher", "parent"]),
  teacher: new Set(["school_admin", "cashier", "secretary", "discipline_director", "study_director", "parent"]),
  parent: new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]),
});

export function normalizedMessagingRole(value) {
  return value === "admin" ? "school_admin" : value;
}

export function messagingSenderIdentity(caller) {
  const profile = caller?.profile ?? {};
  const senderName = String(profile.displayName ?? profile.name ?? profile.fullName ?? "").trim();
  return {
    senderName: senderName || "Utilisateur administratif",
    senderRole: normalizedMessagingRole(caller?.role),
  };
}

export function allowedRecipientRoles(role) {
  return RECIPIENTS_BY_ROLE[normalizedMessagingRole(role)] ?? new Set();
}

function isActive(value) {
  return Boolean(value) && value.active !== false && value.status !== "inactive" && value.status !== "archived";
}

async function loadActiveCoordinationForSchool(db, schoolId) {
  const schoolSnapshot = await db.doc(`schools/${schoolId}`).get();
  const school = schoolSnapshot.exists ? schoolSnapshot.data() : undefined;
  const coordinationId = typeof school?.activeCoordinationId === "string" ? school.activeCoordinationId.trim() : "";
  if (!coordinationId) return null;
  const [coordinationSnapshot, relationSnapshot] = await Promise.all([
    db.doc(`coordinations/${coordinationId}`).get(),
    db.doc(`coordinationSchools/${coordinationId}__${schoolId}`).get(),
  ]);
  const coordination = coordinationSnapshot.exists ? coordinationSnapshot.data() : undefined;
  const relation = relationSnapshot.exists ? relationSnapshot.data() : undefined;
  if (!isActive(coordination) || !isActive(relation) || relation.coordinationId !== coordinationId || relation.schoolId !== schoolId) return null;
  return { id: coordinationId, ...coordination };
}

export async function isRelatedCoordinationRecipient(db, caller, recipient) {
  if (normalizedMessagingRole(caller.role) !== "school_admin") return false;
  const role = normalizedMessagingRole(recipient?.role);
  if (!isActive(recipient) || !["coordination_admin", "sub_coordination_admin"].includes(role)) return false;
  const coordination = await loadActiveCoordinationForSchool(db, caller.schoolId);
  if (!coordination || recipient.coordinationId !== coordination.id) return false;
  if (role === "coordination_admin") return coordination.principalCoordinatorUserId === recipient.id;
  const subCoordinationId = typeof recipient.subCoordinationId === "string" ? recipient.subCoordinationId : "";
  if (!subCoordinationId) return false;
  const [subSnapshot, relationSnapshot] = await Promise.all([
    db.doc(`subCoordinations/${subCoordinationId}`).get(),
    db.doc(`subCoordinationSchools/${subCoordinationId}__${caller.schoolId}`).get(),
  ]);
  const subCoordination = subSnapshot.exists ? subSnapshot.data() : undefined;
  const relation = relationSnapshot.exists ? relationSnapshot.data() : undefined;
  return isActive(subCoordination)
    && isActive(relation)
    && subCoordination.coordinationId === coordination.id
    && subCoordination.coordinatorUserId === recipient.id
    && relation.coordinationId === coordination.id
    && relation.subCoordinationId === subCoordinationId
    && relation.schoolId === caller.schoolId;
}

async function relatedCoordinationRecipients(db, caller) {
  if (normalizedMessagingRole(caller.role) !== "school_admin") return [];
  const coordination = await loadActiveCoordinationForSchool(db, caller.schoolId);
  if (!coordination) return [];
  const candidateIds = new Set();
  if (typeof coordination.principalCoordinatorUserId === "string" && coordination.principalCoordinatorUserId) {
    candidateIds.add(coordination.principalCoordinatorUserId);
  }
  const relationSnapshot = await db.collection("subCoordinationSchools")
    .where("schoolId", "==", caller.schoolId)
    .where("coordinationId", "==", coordination.id)
    .get();
  const subIds = [...new Set(relationSnapshot.docs.map((document) => document.data()).filter((relation) => relation?.coordinationId === coordination.id && isActive(relation)).map((relation) => relation.subCoordinationId).filter((value) => typeof value === "string" && value))];
  if (subIds.length) {
    const subSnapshots = await db.getAll(...subIds.map((id) => db.doc(`subCoordinations/${id}`)));
    subSnapshots.forEach((snapshot) => {
      const sub = snapshot.exists ? snapshot.data() : undefined;
      if (isActive(sub) && sub.coordinationId === coordination.id && typeof sub.coordinatorUserId === "string") candidateIds.add(sub.coordinatorUserId);
    });
  }
  if (!candidateIds.size) return [];
  const userSnapshots = await db.getAll(...[...candidateIds].map((id) => db.doc(`users/${id}`)));
  const recipients = [];
  for (const snapshot of userSnapshots) {
    const recipient = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
    if (recipient && await isRelatedCoordinationRecipient(db, caller, recipient)) recipients.push(recipient);
  }
  return recipients;
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
  const relatedRecipients = await relatedCoordinationRecipients(db, caller);
  const recipients = [...snapshot.docs.map((document) => ({ id: document.id, ...document.data() })), ...relatedRecipients];
  return [...new Map(recipients.map((profile) => [profile.id, profile])).values()]
    .filter((profile) => profile.id !== caller.uid && profile.active !== false && profile.status !== "inactive" && allowed.has(normalizedMessagingRole(profile.role)))
    .map((profile) => ({
      uid: profile.id,
      name: String(profile.displayName ?? profile.name ?? "Utilisateur").trim() || "Utilisateur",
      role: normalizedMessagingRole(profile.role),
    }))
    .sort((first, second) => first.name.localeCompare(second.name, "fr"));
}
