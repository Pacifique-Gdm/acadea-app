import { createHash } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

const studentFields = ['schoolId', 'schoolYearId', 'className', 'option', 'status', 'deletedAt', 'financialSupport'];
const feeFields = ['schoolId', 'schoolYearId', 'className', 'classOptionKey', 'amount', 'currency', 'name'];
export function forecastScopes(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined, kind: 'student' | 'fee') {
  const fields = kind === 'student' ? studentFields : feeFields;
  const projection = (data: typeof before) => data ? fields.map(k => data[k] ?? null) : null;
  if (JSON.stringify(projection(before)) === JSON.stringify(projection(after))) return [];
  const scopes = new Map<string, { schoolId: string; schoolYearId: string }>();
  for (const data of [before, after]) {
    if (!data || typeof data.schoolId !== 'string' || typeof data.schoolYearId !== 'string'
      || ![data.schoolId, data.schoolYearId].every(id => /^[A-Za-z0-9_-]{1,160}$/.test(id))) continue;
    const id = createHash('sha256').update(JSON.stringify([data.schoolId, data.schoolYearId])).digest('hex');
    scopes.set(id, { schoolId: data.schoolId, schoolYearId: data.schoolYearId });
  }
  return [...scopes].map(([id, scope]) => ({ id, ...scope }));
}
function signal(kind: 'student' | 'fee', document: string) {
  return onDocumentWritten({ document, region: 'europe-west1', maxInstances: 3, retry: true }, async event => {
    const scopes = forecastScopes(event.data?.before.data(), event.data?.after.data(), kind);
    // O(1) metadata per affected school/year, never re-read an entire school
    // from the trigger and never write a student, a fee or the financial ledger.
    await Promise.all(scopes.map(({ id, ...scope }) => getFirestore().doc(`feeAllocationForecastSignals/${id}`).set({
      ...scope, revision: event.id, changedAt: event.time,
    })));
  });
}
export const onStudentAllocationForecastChanged = signal('student', 'students/{studentId}');
export const onFeeAllocationForecastChanged = signal('fee', 'feeTypes/{feeId}');
