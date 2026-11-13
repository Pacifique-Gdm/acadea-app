import { createHash } from 'node:crypto';
import { allocationHash, allocationStateId } from './feeAllocationRuntime.js';

export const cashRevisionRef = (db, schoolId, yearId, currency) => db.doc(`financialCashLocks/${createHash('sha256').update(`${schoolId}:${yearId}:${currency}`).digest('hex')}`);
export const evidenceRevisionRef = (db, schoolId, yearId) => db.doc(`feeAllocationEvidenceRevisions/${allocationHash([schoolId, yearId])}`);
const stamp = snap => snap.updateTime?.toDate ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : allocationHash(snap.data() ?? null);

// Every financial API mutation (including payroll/corrections) writes the same
// cash lock atomically. Both currencies are read: resolving an unknown currency
// must never let another-currency mutation escape invalidation.
export async function readAllocationRevision(db, tx, schoolId, yearId) {
  const refs = ['USD', 'CDF'].map(c => cashRevisionRef(db, schoolId, yearId, c));
  refs.push(evidenceRevisionRef(db, schoolId, yearId));
  const snaps = await Promise.all(refs.map(ref => tx.get(ref)));
  return allocationHash(snaps.map(stamp));
}

export const allocationRunRef = (db, runId) => db.doc(`feeAllocationReconciliationRuns/${runId}`);
export const allocationScopeStateRef = (db, schoolId, yearId, currency) => db.doc(`feeAllocationStates/${allocationStateId(schoolId, yearId, currency)}`);
