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

export async function activeCoordinationSchoolIds(db, coordinationId) {
  const snapshot = await db.collection("coordinationSchools").where("coordinationId", "==", coordinationId).get();
  return [...new Set(snapshot.docs.filter((item) => item.data().active === true).map((item) => String(item.data().schoolId ?? "").trim()).filter(Boolean))];
}

export function chunks(values, size = 30) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
