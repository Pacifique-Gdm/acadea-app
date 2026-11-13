import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'acadea-staging');
assert.equal(process.env.GOOGLE_CLOUD_QUOTA_PROJECT, 'acadea-staging');
assert.equal(process.env.ACADEA_ALLOCATION_STAGING, 'YES');
assert.ok(process.env.ACADEA_STAGING_ACCESS_TOKEN);
const base = 'https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/collectionGroups/feeAllocationMovements/indexes';
const headers = { Authorization: `Bearer ${process.env.ACADEA_STAGING_ACCESS_TOKEN}`, 'x-goog-user-project': 'acadea-staging', 'Content-Type': 'application/json' };
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Index Staging : HTTP ${response.status}`);
  return response.json();
}
const current = await request(base);
mkdirSync('diagnostics/allocation-staging-prerequisites', { recursive: true });
writeFileSync(`diagnostics/allocation-staging-prerequisites/indexes-${Date.now()}.json`, JSON.stringify(current, null, 2));
const candidate = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes.find(i => i.collectionGroup === 'feeAllocationMovements');
assert.ok(candidate); assert.equal(candidate.queryScope, 'COLLECTION');
const sameFields = fields => JSON.stringify(fields.map(({ fieldPath, order }) => ({ fieldPath, order }))) === JSON.stringify(candidate.fields);
let existing = current.indexes?.find(i => i.queryScope === candidate.queryScope && sameFields(i.fields));
if (!existing && process.env.ACADEA_CREATE_STAGING_INDEX === 'YES') {
  const operation = await request(base, { method: 'POST', body: JSON.stringify({ queryScope: candidate.queryScope, fields: candidate.fields }) });
  console.log(JSON.stringify({ project: 'acadea-staging', createdIndexOperation: operation.name }));
  existing = (await request(base)).indexes?.find(i => sameFields(i.fields));
}
console.log(JSON.stringify({ project: 'acadea-staging', index: existing?.name ?? null, state: existing?.state ?? 'MISSING' }));
if (existing?.state !== 'READY') process.exitCode = 2;
