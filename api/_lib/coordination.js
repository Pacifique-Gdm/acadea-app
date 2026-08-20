export function coordinationHttpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

export async function requireActiveCoordinator(auth, db, token) {
  const decoded = await auth.verifyIdToken(token, true);
  if (decoded.role !== "coordination_admin" || typeof decoded.coordinationId !== "string" || !decoded.coordinationId) {
    throw coordinationHttpError(403, "not-authorized", "Action réservée au Coordinateur.");
  }
  const [profileSnapshot, coordinationSnapshot] = await Promise.all([
    db.doc(`users/${decoded.uid}`).get(),
    db.doc(`coordinations/${decoded.coordinationId}`).get(),
  ]);
  const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
  const coordination = coordinationSnapshot.exists ? coordinationSnapshot.data() : undefined;
  if (!profile || profile.role !== "coordination_admin" || profile.coordinationId !== decoded.coordinationId || profile.active === false || profile.status === "inactive" || !coordination || coordination.status !== "active") {
    throw coordinationHttpError(403, "not-authorized", "Profil Coordination inactif ou invalide.");
  }
  return { uid: decoded.uid, role: decoded.role, coordinationId: decoded.coordinationId, profile, coordination };
}

export async function requireActiveCoordinationActor(auth, db, token) {
  const decoded = await auth.verifyIdToken(token, true);
  const role = decoded.role;
  if (!["coordination_admin", "sub_coordination_admin"].includes(role)
    || typeof decoded.coordinationId !== "string"
    || !decoded.coordinationId
    || (role === "sub_coordination_admin" && (typeof decoded.subCoordinationId !== "string" || !decoded.subCoordinationId))) {
    throw coordinationHttpError(403, "not-authorized", "Action réservée à la Coordination.");
  }
  const refs = [
    db.doc(`users/${decoded.uid}`),
    db.doc(`coordinations/${decoded.coordinationId}`),
    ...(role === "sub_coordination_admin" ? [db.doc(`subCoordinations/${decoded.subCoordinationId}`)] : []),
  ];
  const snapshots = await db.getAll(...refs);
  const profile = snapshots[0]?.exists ? snapshots[0].data() : undefined;
  const coordination = snapshots[1]?.exists ? snapshots[1].data() : undefined;
  const subCoordination = snapshots[2]?.exists ? snapshots[2].data() : undefined;
  const invalidProfile = !profile
    || profile.role !== role
    || profile.coordinationId !== decoded.coordinationId
    || profile.active === false
    || profile.status === "inactive";
  const invalidSubCoordination = role === "sub_coordination_admin"
    && (!subCoordination
      || profile.subCoordinationId !== decoded.subCoordinationId
      || subCoordination.id !== decoded.subCoordinationId
      || subCoordination.coordinationId !== decoded.coordinationId
      || subCoordination.coordinatorUserId !== decoded.uid
      || subCoordination.active !== true
      || subCoordination.status !== "active");
  if (invalidProfile || !coordination || coordination.status !== "active" || invalidSubCoordination) {
    throw coordinationHttpError(403, "not-authorized", "Profil Coordination inactif ou invalide.");
  }
  return { uid: decoded.uid, role, coordinationId: decoded.coordinationId, subCoordinationId: decoded.subCoordinationId, profile, coordination, subCoordination };
}

export async function activeCoordinationSchoolIds(db, coordinationId) {
  const snapshot = await db.collection("coordinationSchools").where("coordinationId", "==", coordinationId).get();
  return [...new Set(snapshot.docs.filter((item) => item.data().active === true).map((item) => String(item.data().schoolId ?? "").trim()).filter(Boolean))];
}

export async function activeSubCoordinationSchoolIds(db, coordinationId, subCoordinationId) {
  const snapshot = await db.collection("subCoordinationSchools").where("subCoordinationId", "==", subCoordinationId).get();
  const delegated = snapshot.docs
    .filter((item) => item.data().active === true && item.data().coordinationId === coordinationId)
    .map((item) => String(item.data().schoolId ?? "").trim())
    .filter(Boolean);
  if (!delegated.length) return [];
  const principalScope = new Set(await activeCoordinationSchoolIds(db, coordinationId));
  const candidateIds = [...new Set(delegated.filter((schoolId) => principalScope.has(schoolId)))];
  if (!candidateIds.length) return [];
  const schoolSnapshots = await db.getAll(...candidateIds.map((schoolId) => db.doc(`schools/${schoolId}`)));
  return schoolSnapshots.filter((snapshot) => snapshot.exists && snapshot.data()?.status === "active").map((snapshot) => snapshot.id);
}

export async function resolveCoordinationSchoolScope(db, actor) {
  return actor.role === "sub_coordination_admin"
    ? activeSubCoordinationSchoolIds(db, actor.coordinationId, actor.subCoordinationId)
    : activeCoordinationSchoolIds(db, actor.coordinationId);
}

export function chunks(values, size = 30) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
