import { requireActiveApiUser, verifyActorIdToken } from "./activeUser.js";
import { requireActiveSchoolYear } from "./schoolYear.js";
import { isSectionAdministrator, requireActiveSectionAdministratorActor, sectionAdministratorScope } from "./sectionAdministrators.js";

const ALLOWED_SENDERS = new Set(["school_admin", "admin", "cashier", "discipline_director", "study_director", "secretary", "teacher", "parent", "kindergarten_admin", "primary_admin", "studies_prefect"]);

const RECIPIENTS_BY_ROLE = Object.freeze({
  school_admin: new Set(["cashier", "secretary", "discipline_director", "study_director", "teacher", "parent", "coordination_admin", "sub_coordination_admin"]),
  cashier: new Set(["school_admin", "secretary", "discipline_director", "study_director", "teacher", "parent"]),
  discipline_director: new Set(["school_admin", "cashier", "secretary", "study_director", "teacher", "parent"]),
  study_director: new Set(["school_admin", "cashier", "secretary", "discipline_director", "teacher", "parent"]),
  secretary: new Set(["school_admin", "cashier", "discipline_director", "study_director", "teacher", "parent"]),
  teacher: new Set(["school_admin", "cashier", "secretary", "discipline_director", "study_director", "parent"]),
  parent: new Set(["school_admin", "cashier", "discipline_director", "study_director", "secretary", "teacher"]),
  kindergarten_admin: new Set(["school_admin", "cashier", "secretary", "discipline_director", "study_director", "teacher", "parent"]),
  primary_admin: new Set(["school_admin", "cashier", "secretary", "discipline_director", "study_director", "teacher", "parent"]),
  studies_prefect: new Set(["school_admin", "cashier", "secretary", "discipline_director", "study_director", "teacher", "parent"]),
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
  const base = RECIPIENTS_BY_ROLE[normalizedMessagingRole(role)];
  return base ? new Set([...base, "kindergarten_admin", "primary_admin", "studies_prefect"]) : new Set();
}

/** Reciprocal contact grants no access to a parent's other children. */
export async function reciprocalSectionContact(db, caller, recipient, schoolYearId) {
  const target = sectionAdministratorScope(recipient);
  if (target.schoolId !== caller.schoolId) return [];
  if (!schoolYearId) return [];
  await requireActiveSchoolYear(db, caller.schoolId, schoolYearId);
  if (caller.role === "parent") {
    if (!caller.parentId && !caller.profile?.parentId) return [];
    const parentId = caller.parentId ?? caller.profile.parentId;
    const snapshot = await db.doc(`parents/${parentId}`).get();
    const parent = snapshot.exists ? snapshot.data() : null;
    if (!parent || parent.schoolId !== caller.schoolId || !Array.isArray(parent.studentIds)
      || parent.studentIds.length > 100 || parent.studentIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(id))) return [];
    const children = parent.studentIds.length ? await db.getAll(...parent.studentIds.map((id) => db.doc(`students/${id}`))) : [];
    return target.sectionIds.filter((section) => children.some((child) => child.exists && child.data()?.schoolId === caller.schoolId
      && child.data()?.schoolYearId === schoolYearId && child.data()?.section === section && !child.data()?.deletedAt
      && (child.data()?.status ?? "ACTIVE") === "ACTIVE"));
  }
  const source = callerSectionScope(caller);
  return source.size ? target.sectionIds.filter((section) => source.has(section)) : target.sectionIds;
}

export function requireSectionMessageContext(caller, section) {
  if (!isSectionAdministrator(caller?.role)) return null;
  const scope = sectionAdministratorScope(caller.profile);
  if (scope.schoolId !== caller.schoolId || !scope.sectionIds.includes(section)) {
    throw Object.assign(new Error("Section de message hors du périmètre autorisé."), { statusCode: 403, code: "invalid-recipient" });
  }
  return section;
}

export function sectionMessageStaffRecipientAllowed(recipient, section) {
  if (normalizedMessagingRole(recipient?.role) === "school_admin") return true;
  return Array.isArray(recipient?.sectionIds)
    ? recipient.sectionIds.includes(section)
    : recipient?.section === section;
}

function callerSectionScope(caller) {
  const profile = caller?.profile ?? {};
  const values = Array.isArray(profile.sectionIds) ? profile.sectionIds : profile.section ? [profile.section] : [];
  return new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()));
}

async function scopedParentIds(db, caller, schoolYearId) {
  if (!schoolYearId || !["discipline_director", "study_director"].includes(normalizedMessagingRole(caller.role))) return null;
  const sections = callerSectionScope(caller);
  if (!sections.size) {
    await requireActiveSchoolYear(db, caller.schoolId, schoolYearId);
    return null;
  }
  const [studentSnapshot, parentSnapshot] = await Promise.all([
    db.collection("students").where("schoolId", "==", caller.schoolId).where("schoolYearId", "==", schoolYearId).get(),
    db.collection("parents").where("schoolId", "==", caller.schoolId).get(),
  ]);
  const scopedStudents = studentSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data() }))
    .filter((student) => sections.has(student.section));
  const scopedStudentIds = new Set(scopedStudents.map((student) => student.id));
  const parentIds = new Set(scopedStudents.map((student) => student.parentId).filter((value) => typeof value === "string" && value));
  parentSnapshot.docs.forEach((document) => {
    const parent = document.data();
    if (Array.isArray(parent.studentIds) && parent.studentIds.some((studentId) => scopedStudentIds.has(studentId))) parentIds.add(document.id);
  });
  return parentIds;
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
  const decoded = await verifyActorIdToken(auth, token);
  const role = normalizedMessagingRole(decoded.role);
  if (!decoded.schoolId || !ALLOWED_SENDERS.has(decoded.role) || allowedRecipientRoles(role).size === 0) {
    throw Object.assign(new Error("Action non autorisee."), { statusCode: 403, code: "not-authorized" });
  }
  await requireActiveApiUser(db, decoded);
  const snapshot = await db.doc(`users/${decoded.uid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || normalizedMessagingRole(profile.role) !== role || profile.schoolId !== decoded.schoolId || profile.active === false || profile.status === "inactive") {
    throw Object.assign(new Error("Profil utilisateur non autorise."), { statusCode: 403, code: "not-authorized" });
  }
  // Preserve the verified parent identity through the transactional send path.
  // requireActiveApiUser has already matched this claim against the active profile.
  return { uid: decoded.uid, schoolId: decoded.schoolId, role,
    ...(role === "parent" ? { parentId: decoded.parentId } : {}), profile };
}

export async function listAllowedMessageRecipients(db, caller, schoolYearId = "") {
  if (isSectionAdministrator(caller.role)) {
    const scope = await requireActiveSectionAdministratorActor(db, caller);
    await requireActiveSchoolYear(db, scope.schoolId, schoolYearId);
    const [userSnapshot, studentSnapshot] = await Promise.all([
      db.collection("users").where("schoolId", "==", scope.schoolId).get(),
      db.collection("students").where("schoolId", "==", scope.schoolId).where("schoolYearId", "==", schoolYearId).get(),
    ]);
    const currentStudents = new Map(studentSnapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
    const users = userSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
    const eligible = [];
    for (const user of users) {
      const role = normalizedMessagingRole(user.role);
      if (user.id === caller.uid || user.schoolId !== scope.schoolId || !isActive(user) || !allowedRecipientRoles(caller.role).has(role)) continue;
      let sections = scope.sectionIds.filter((section) => sectionMessageStaffRecipientAllowed(user, section));
      if (role === "parent") {
        sections = [];
        if (typeof user.parentId !== "string" || !user.parentId) continue;
        const parentSnapshot = await db.doc(`parents/${user.parentId}`).get();
        const parent = parentSnapshot.exists ? parentSnapshot.data() : null;
        if (!parent || parent.schoolId !== scope.schoolId || !Array.isArray(parent.studentIds) || !parent.studentIds.length
          || parent.studentIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) continue;
        const linked = await db.getAll(...parent.studentIds.map((id) => db.doc(`students/${id}`)));
        if (linked.some((document) => !document.exists || document.data()?.schoolId !== scope.schoolId)) continue;
        const active = linked.filter((document) => document.data()?.schoolYearId === schoolYearId);
        // A parent belongs to the school, not to one section. Return only the
        // contact and the caller's eligible sections, never sibling records.
        sections = scope.sectionIds.filter((section) => active.some((document) =>
          currentStudents.has(document.id) && document.data()?.section === section));
      }
      if (sections.length) eligible.push({ uid: user.id,
        name: String(user.displayName ?? user.name ?? "Utilisateur").trim() || "Utilisateur", role, sections });
    }
    return eligible.sort((first, second) => first.name.localeCompare(second.name, "fr"));
  }
  const allowed = allowedRecipientRoles(caller.role);
  if (allowed.size === 0) throw Object.assign(new Error("Action non autorisee."), { statusCode: 403, code: "not-authorized" });
  const snapshot = await db.collection("users").where("schoolId", "==", caller.schoolId).get();
  const relatedRecipients = await relatedCoordinationRecipients(db, caller);
  const allowedParentIds = await scopedParentIds(db, caller, schoolYearId);
  const recipients = [...snapshot.docs.map((document) => ({ id: document.id, ...document.data() })), ...relatedRecipients];
  const reciprocal = new Map();
  for (const recipient of recipients) {
    if (!isSectionAdministrator(recipient.role)) continue;
    try { reciprocal.set(recipient.id, await reciprocalSectionContact(db, caller, recipient, schoolYearId)); }
    catch { reciprocal.set(recipient.id, []); }
  }
  return [...new Map(recipients.map((profile) => [profile.id, profile])).values()]
    .filter((profile) => profile.id !== caller.uid && profile.active !== false && profile.status !== "inactive" && allowed.has(normalizedMessagingRole(profile.role))
      && (!isSectionAdministrator(profile.role) || reciprocal.get(profile.id)?.length)
      && (normalizedMessagingRole(profile.role) !== "parent" || allowedParentIds === null || allowedParentIds.has(profile.parentId)))
    .map((profile) => ({
      uid: profile.id,
      name: String(profile.displayName ?? profile.name ?? "Utilisateur").trim() || "Utilisateur",
      role: normalizedMessagingRole(profile.role),
      ...(isSectionAdministrator(profile.role) ? { sections: reciprocal.get(profile.id) } : {}),
    }))
    .sort((first, second) => first.name.localeCompare(second.name, "fr"));
}
