import { randomUUID } from 'node:crypto';
import { manageAllocationReconciliation } from './feeAllocationReconciliation.js';
import { cashRevisionRef } from './feeAllocationRevision.js';

export async function reconcileFixture(db, caller = { uid: 'admin', role: 'school_admin', schoolId: 'school' }, now = '2026-11-13T10:00:00.000Z') {
  let response = await manageAllocationReconciliation({ db, caller, now, body: { action: 'start-reconciliation', requestId: randomUUID() } });
  while (response.run.status === 'RUNNING') response = await manageAllocationReconciliation({ db, caller, now,
    body: { action: 'advance-reconciliation', runId: response.run.id, sequence: response.run.sequence } });
  return response.run;
}

// Direct fixture edits must model the revision that every real financial API
// transaction updates; they are not an alternative application write path.
export function markFixtureFinancialChange(db) {
  db.records.set(cashRevisionRef(db, 'school', 'year', 'USD').path, { revision: randomUUID() });
}
