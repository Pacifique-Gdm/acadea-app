import { isSectionAdministrator, requireSectionAdministratorConfirmation, sectionAdministratorScope } from './sectionAdministrators.js';
const fail = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode, code: 'permission-denied' });
export async function manageSectionAdministrators({ db, auth, caller, body }) {
  if (caller.role !== 'super_admin') throw fail('Action réservée au Super Administrateur.');
  const schoolId = body.schoolId;
  if (typeof schoolId !== 'string' || !schoolId || schoolId.includes('/')) throw fail('Établissement invalide.', 400);
  const school = await db.doc(`schools/${schoolId}`).get();
  if (!school.exists) throw fail('Établissement introuvable.', 404);
  if (body.operation === 'list') {
    const result = await db.collection('users').where('schoolId', '==', schoolId).get();
    return { users: result.docs.filter(doc => isSectionAdministrator(doc.data().role) && !doc.data().deletedAt).map(doc => {
      const value = doc.data();
      return { id: doc.id, name: value.name, role: value.role, sectionIds: value.sectionIds ?? [], status: value.status, active: value.active };
    }) };
  }
  requireSectionAdministratorConfirmation(body.operation, body.confirmation);
  if (typeof body.userId !== 'string' || !body.userId || body.userId.includes('/')) throw fail('Utilisateur invalide.', 400);
  const ref = db.doc(`users/${body.userId}`);
  const snapshot = await ref.get();
  const target = snapshot.data();
  if (!snapshot.exists || target.schoolId !== schoolId || !isSectionAdministrator(target.role) || target.deletedAt) throw fail('Profil introuvable dans cet établissement.');
  if (body.operation === 'activate') {
    sectionAdministratorScope({ ...target, status: 'active', active: true });
    // Auth stays disabled until the authoritative transaction succeeds. A failure
    // in the final Auth step leaves access closed and can safely be retried.
    await auth.updateUser(body.userId, { disabled: true });
    await auth.revokeRefreshTokens(body.userId);
    await auth.setCustomUserClaims(body.userId, { role: target.role, schoolId });
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const actor = await tx.get(db.doc(`users/${caller.uid}`));
      const currentSchool = await tx.get(db.doc(`schools/${schoolId}`));
      if (!actor.exists || actor.data().role !== 'super_admin' || actor.data().active === false || actor.data().status === 'inactive') throw fail('Acteur inactif.');
      if (!currentSchool.exists || currentSchool.data().status !== 'active') throw fail('Établissement inactif.');
      if (!current.exists || current.data().role !== target.role || current.data().schoolId !== schoolId || current.data().deletedAt) throw fail('Profil modifié.');
      sectionAdministratorScope({ ...current.data(), status: 'active', active: true });
      const now = new Date().toISOString();
      tx.update(ref, { status: 'active', active: true, updatedAt: now, updatedBy: caller.uid });
      const audit = db.collection('auditLogs').doc();
      tx.create(audit, { id: audit.id, schoolId, actorId: caller.uid, actorRole: caller.role, action: 'section-admin.activate', resourceId: body.userId, createdAt: now });
    });
    await auth.updateUser(body.userId, { disabled: false });
    return { userId: body.userId, status: 'active', deleted: false };
  }
  await auth.updateUser(body.userId, { disabled: true }).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
  await auth.revokeRefreshTokens(body.userId).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
  const now = new Date().toISOString();
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    const actor = await tx.get(db.doc(`users/${caller.uid}`));
    if (!actor.exists || actor.data().role !== 'super_admin' || actor.data().active === false || actor.data().status === 'inactive') throw fail('Acteur inactif.');
    if (!current.exists || current.data().schoolId !== schoolId || !isSectionAdministrator(current.data().role) || current.data().deletedAt) throw fail('Profil modifié.');
    tx.update(ref, { status: 'inactive', active: false, updatedAt: now, updatedBy: caller.uid, ...(body.operation === 'delete' ? { deletedAt: now, deletedBy: caller.uid } : {}) });
    const audit = db.collection('auditLogs').doc();
    tx.create(audit, { id: audit.id, schoolId, actorId: caller.uid, actorRole: caller.role, action: `section-admin.${body.operation}`, resourceId: body.userId, createdAt: now });
  });
  // Preserve attribution and financial history; delete access, not historical records.
  if (body.operation === 'delete') await auth.deleteUser(body.userId).catch(error => { if (error.code !== 'auth/user-not-found') throw error; });
  return { userId: body.userId, status: 'inactive', deleted: body.operation === 'delete' };
}
