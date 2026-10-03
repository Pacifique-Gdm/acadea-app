import { coordinationHttpError } from "./coordination.js";

const fail = (status, code, message) => { throw coordinationHttpError(status, code, message); };
const text = (value, max = 160) => typeof value === "string" && value.trim().length <= max ? value.trim() : "";
function keys(input, allowed) {
  if (Object.keys(input).some((key) => !["action", "coordinationId", ...allowed].includes(key))) fail(400, "invalid-argument", "Champ non autorisé.");
}
function identity(input) {
  const name = text(input.name), email = text(input.email, 254).toLowerCase(), phone = text(input.phone, 40);
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, "invalid-argument", "Nom et e-mail valides requis.");
  return { name, email, phone };
}

export async function manageCoordinationAdministrator({ auth, db, caller, input, coordination, now }) {
  if (caller.role !== "super_admin") fail(403, "permission-denied", "Action réservée au Super Administrateur.");
  const actor = await db.doc(`users/${caller.uid}`).get();
  if (!actor.exists || actor.data().role !== "super_admin" || actor.data().status === "inactive" || actor.data().active === false) fail(403, "permission-denied", "Super Administrateur actif requis.");
  const coordinationId = coordination.id;
  const action = input.action;
  const auditRef = db.collection("auditLogs").doc();
  const audit = (userId) => ({ id: auditRef.id, eventType: `coordination.${action}`, coordinationId, actorId: caller.uid, actorRole: caller.role, action, resourceType: userId ? "user" : "coordination", resourceId: userId || coordinationId, result: "success", source: "server", createdAt: now });

  if (action === "update-coordination") {
    keys(input, ["name", "code", "phone", "email", "address"]);
    const values = { name: text(input.name), code: text(input.code, 40), phone: text(input.phone, 40), email: text(input.email, 254).toLowerCase(), address: text(input.address, 500) };
    if (!values.name || (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))) fail(400, "invalid-argument", "Nom et e-mail valides requis.");
    const batch = db.batch();
    batch.update(db.doc(`coordinations/${coordinationId}`), { ...values, updatedAt: now, updatedBy: caller.uid });
    batch.create(auditRef, audit());
    await batch.commit();
    return { coordinationId };
  }
  if (action === "create-coordinator") {
    keys(input, ["name", "email", "phone", "password"]);
    if (coordination.status !== "active") fail(409, "failed-precondition", "La Coordination n'est pas active.");
    const values = identity(input);
    if (typeof input.password !== "string" || input.password.length < 6 || input.password.length > 128) fail(400, "invalid-argument", "Mot de passe temporaire invalide.");
    let user;
    try { user = await auth.createUser({ email: values.email, password: input.password, displayName: values.name, disabled: false }); }
    catch (error) { if (error.code === "auth/email-already-exists") fail(409, "already-exists", "Cet e-mail est déjà utilisé."); throw error; }
    try {
      await auth.setCustomUserClaims(user.uid, { role: "coordination_admin", coordinationId });
      await db.runTransaction(async (transaction) => {
        const current = await transaction.get(db.doc(`coordinations/${coordinationId}`));
        if (!current.exists || current.data().status !== "active") fail(409, "failed-precondition", "La Coordination n'est plus active.");
        transaction.create(db.doc(`users/${user.uid}`), { id: user.uid, ...values, role: "coordination_admin", coordinationId, status: "active", active: true, createdAt: now, createdBy: caller.uid, updatedAt: now, updatedBy: caller.uid });
        transaction.create(auditRef, audit(user.uid));
      });
    } catch (error) { await auth.deleteUser(user.uid); throw error; }
    return { userId: user.uid };
  }
  const isEdit = action === "update-coordinator";
  keys(input, isEdit ? ["userId", "name", "email", "phone"] : ["userId", "confirmation"]);
  const userId = text(input.userId, 128);
  if (!userId || userId.includes("/")) fail(400, "invalid-argument", "Coordinateur requis.");
  const ref = db.doc(`users/${userId}`), snapshot = await ref.get();
  const profile = snapshot.data();
  if (!snapshot.exists || profile.role !== "coordination_admin" || profile.coordinationId !== coordinationId) fail(404, "not-found", "Coordinateur introuvable dans cette Coordination.");
  if (profile.removedAt) fail(409, "failed-precondition", "Ce Coordinateur a été supprimé.");
  if (action === "remove-coordinator" && input.confirmation !== "SUPPRIMER CE COORDINATEUR") fail(400, "invalid-argument", "Confirmation de suppression invalide.");
  if (!["update-coordinator", "suspend-coordinator", "reactivate-coordinator", "remove-coordinator"].includes(action)) fail(400, "invalid-argument", "Action invalide.");
  if (action === "reactivate-coordinator" && coordination.status !== "active") fail(409, "failed-precondition", "La Coordination n'est pas active.");
  const previous = await auth.getUser(userId);
  const values = isEdit ? identity(input) : null;
  const active = action === "reactivate-coordinator";
  try { await auth.updateUser(userId, values ? { displayName: values.name, email: values.email } : { disabled: !active }); }
  catch (error) { if (error.code === "auth/email-already-exists") fail(409, "already-exists", "Cet e-mail est déjà utilisé."); throw error; }
  try {
    if (!isEdit && !active) await auth.revokeRefreshTokens(userId);
    const batch = db.batch();
    batch.update(ref, { ...(values || { active, status: active ? "active" : "inactive" }), ...(action === "remove-coordinator" ? { removedAt: now, removedBy: caller.uid } : {}), updatedAt: now, updatedBy: caller.uid });
    batch.create(auditRef, audit(userId));
    await batch.commit();
  } catch (error) {
    await auth.updateUser(userId, values ? { displayName: previous.displayName || "", email: previous.email } : { disabled: previous.disabled });
    throw error;
  }
  return { userId, ...(isEdit ? values : { active, status: active ? "active" : "inactive" }) };
}
