import { allocationFail as fail, allocationIdentifier as id } from './feeAllocationRuntime.js';
import { readFeeAllocationScope, readFeeAllocationYear } from './feeAllocationPhase1.js';

/** Lot « 3 étapes » : consultation des justifications d'écritures (motif écrit, photo, preuve Acadéa),
 * avant comme après l'activation. Réservée à l'Administrateur de l'école et au Super administrateur.
 * Les photos ne sont jamais lisibles directement : le serveur joint une adresse de lecture valable 10 minutes. */
export const JUSTIFICATION_PHOTO_TTL_MS = 10 * 60 * 1000;
const MAX_ROWS = 200;
const PHOTO = /^fee-allocation-proofs\/([A-Za-z0-9_-]{1,160})\/[A-Za-z0-9_-]{1,160}\/[A-Za-z0-9_-]{8,80}\.(jpg|png|webp)$/;
const kinds = { payments: 'Paiement scolaire', expenses: 'Dépense', cashInflows: 'Autre entrée de caisse' };
const text = (value, max = 500) => (typeof value === 'string' ? value.slice(0, max) : null);
const inactive = (p) => !p || p.active === false || ['inactive', 'disabled', 'suspended', 'deleted', 'deleting'].includes(p.status);

export function justificationPhotoSigner(bucket, now = () => Date.now()) {
  return async (path) => {
    if (typeof path !== 'string' || !PHOTO.test(path)) throw new Error('Chemin de photo invalide.');
    const [url] = await bucket.file(path).getSignedUrl({ version: 'v4', action: 'read', expires: now() + JUSTIFICATION_PHOTO_TTL_MS });
    return url;
  };
}

/** Lecture commune : toutes les décisions de justification de l'école et de l'année, les plus récentes d'abord. */
export async function readJustifications({ db, schoolId, schoolYearId, signPhoto }) {
  if (!id(schoolId) || !id(schoolYearId)) fail('École ou année invalide.', 'invalid-argument', 400);
  const snapshot = await db.collection('feeAllocationHistoricalDecisions').where('schoolId', '==', schoolId).where('schoolYearId', '==', schoolYearId).limit(MAX_ROWS + 1).get();
  const decisions = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((d) => d.schoolId === schoolId && d.schoolYearId === schoolYearId)
    .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt))).slice(0, MAX_ROWS);
  const actorIds = [...new Set(decisions.map((d) => d.actorId).filter(id))];
  const actors = new Map(await Promise.all(actorIds.map(async (uid) => [uid, (await db.doc(`users/${uid}`).get()).data()])));
  const rows = await Promise.all(decisions.map(async (d) => {
    const [collection, sourceId] = String(d.sourcePath ?? '').split('/');
    const source = kinds[collection] && id(sourceId) ? (await db.doc(`${collection}/${sourceId}`).get()).data() : null;
    const sameSchool = source && source.schoolId === schoolId;
    const photoPath = typeof d.photoPath === 'string' && PHOTO.exec(d.photoPath)?.[1] === schoolId ? d.photoPath : null;
    let photoUrl = null;
    if (photoPath && signPhoto) photoUrl = await signPhoto(photoPath).catch(() => null);
    const actor = actors.get(d.actorId);
    return { id: d.id, decidedAt: text(d.decidedAt, 40), decision: d.decision === 'accepted' ? 'accepted' : 'rejected',
      kind: d.kind === 'declaration' ? 'declaration' : 'proof', reason: text(d.submittedReason ?? d.reason), refusal: d.decision === 'accepted' ? null : text(d.reason),
      nature: kinds[collection] ?? 'Écriture', amount: sameSchool && typeof source.amount === 'number' ? source.amount : null,
      currency: sameSchool && ['USD', 'CDF'].includes(source.currency) ? source.currency : null, receiptNumber: sameSchool ? text(source.receiptNumber, 60) : null,
      entryDate: sameSchool ? text(source.createdAt, 40) : null, actorName: text(actor?.name ?? actor?.displayName, 120) ?? 'Administrateur',
      hasPhoto: !!photoPath, photoUrl };
  }));
  return { schoolId, schoolYearId, rows, truncated: snapshot.docs.length > MAX_ROWS, photoUrlMinutes: JUSTIFICATION_PHOTO_TTL_MS / 60000 };
}

/** Administrateur de l'école : son école, son année active. Tout autre rôle est refusé. */
export async function readSchoolAdminJustifications({ db, caller, body, signPhoto }) {
  if (!['school_admin', 'admin'].includes(caller.role)) fail("Consultation réservée à l'Administrateur de l'école.", 'permission-denied', 403);
  if (Object.keys(body).some((key) => !['action'].includes(key))) fail('Demande invalide.', 'invalid-argument', 400);
  const profile = (await db.doc(`users/${caller.uid}`).get()).data();
  if (inactive(profile) || !['school_admin', 'admin'].includes(profile.role) || profile.schoolId !== caller.schoolId) fail('Compte non autorisé.', 'permission-denied', 403);
  const { school, schoolId } = await readFeeAllocationScope(db, caller, caller.schoolId);
  const { yearId } = await readFeeAllocationYear(db, schoolId, school, undefined, false);
  return { operational: false, ...(await readJustifications({ db, schoolId, schoolYearId: yearId, signPhoto })) };
}
