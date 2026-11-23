import { createHash } from 'node:crypto';
import { allocationHash, allocationStateId } from './feeAllocationRuntime.js';

export const cashRevisionRef = (db, schoolId, yearId, currency) => db.doc(`financialCashLocks/${createHash('sha256').update(`${schoolId}:${yearId}:${currency}`).digest('hex')}`);
export const evidenceRevisionRef = (db, schoolId, yearId) => db.doc(`feeAllocationEvidenceRevisions/${allocationHash([schoolId, yearId])}`);
const stamp = snap => snap.updateTime?.toDate ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : allocationHash(snap.data() ?? null);

// Every financial API mutation (including payroll/corrections) writes the same
// cash lock atomically. Both currencies are read: resolving an unknown currency
// must never let another-currency mutation escape invalidation.
export async function readAllocationRevision(db, tx, schoolId, yearId) {
  return (await readAllocationRevisionDetail(db, tx, schoolId, yearId)).revision;
}

/** Lot « 3 étapes » : mêmes lectures, avec en plus la marque de chaque verrou de caisse et celle des pièces.
 * Elles permettent de reconnaître qu'il ne s'est passé que des encaissements pendant la mise en route. */
export async function readAllocationRevisionDetail(db, tx, schoolId, yearId) {
  const refs = ['USD', 'CDF'].map(c => cashRevisionRef(db, schoolId, yearId, c));
  refs.push(evidenceRevisionRef(db, schoolId, yearId));
  const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
  return { revision: allocationHash(snaps.map(stamp)), evidence: stamp(snaps[2]),
    locks: { USD: snaps[0].data()?.revision ?? null, CDF: snaps[1].data()?.revision ?? null } };
}

export const allocationRunRef = (db, runId) => db.doc(`feeAllocationReconciliationRuns/${runId}`);
export const allocationScopeStateRef = (db, schoolId, yearId, currency) => db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`);
