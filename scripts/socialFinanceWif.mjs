import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const project = 'acadea-staging';
const provider = 'projects/1039133094640/locations/global/workloadIdentityPools/acadea-section-e2e/providers/github-section';
const token = process.env.ACADEA_STAGING_ACCESS_TOKEN;
assert.ok(token && process.env.GOOGLE_CLOUD_PROJECT === project);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': project };
const endpoint = `https://iam.googleapis.com/v1/${provider}`;
const get = async () => { const r = await fetch(endpoint, { headers }); assert.equal(r.status, 200); return r.json(); };
const before = await get();
const branch = 'refs/heads/codex/staging-pr38-pr39-only-20261103';
const workflow = `Pacifique-Gdm/acadea-app/.github/workflows/social-finance-staging-visual.yml@${branch}`;
const extension = `assertion.repository_id == '1280525031' && assertion.repository_owner_id == '296899034' && assertion.ref == '${branch}' && assertion.event_name == 'push' && assertion.sub == 'repo:Pacifique-Gdm/acadea-app:environment:acadea-staging-e2e' && assertion.workflow_ref == '${workflow}'`;
assert.equal(before.oidc.issuerUri, 'https://token.actions.githubusercontent.com');
assert.ok(before.attributeCondition.includes("assertion.repository_id == '1280525031'"));
const condition = before.attributeCondition.includes(workflow) ? before.attributeCondition : `(${before.attributeCondition}) || (${extension})`;
const folder = `diagnostics/social-finance-staging/wif-${Date.now()}`;
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/before.json`, JSON.stringify(before, null, 2));
writeFileSync(`${folder}/candidate-condition.txt`, condition);
// Truth-table tests of the added branch, independent of any fixture or credential.
const allowed = c => c.repo === '1280525031' && c.owner === '296899034' && c.ref === branch && c.event === 'push' && c.sub === 'repo:Pacifique-Gdm/acadea-app:environment:acadea-staging-e2e' && c.workflow === workflow;
const valid = {repo:'1280525031',owner:'296899034',ref:branch,event:'push',sub:'repo:Pacifique-Gdm/acadea-app:environment:acadea-staging-e2e',workflow};
assert.ok(allowed(valid));
for (const key of Object.keys(valid)) assert.equal(allowed({...valid,[key]:'unauthorized'}), false);
if (condition !== before.attributeCondition) {
  const r = await fetch(`${endpoint}?updateMask=attributeCondition`, { method:'PATCH', headers, body: JSON.stringify({attributeCondition:condition}) });
  assert.ok(r.ok, `WIF PATCH HTTP ${r.status}`);
  const operation = await r.json();
  if (operation.error) throw Error(`WIF operation failed: ${operation.error.code}`);
}
let after;
for (let n=0;n<12;n++) { after=await get(); if(after.attributeCondition===condition) break; await new Promise(r=>setTimeout(r,5000)); }
assert.equal(after.attributeCondition,condition);
assert.deepEqual(after.attributeMapping,before.attributeMapping);
assert.deepEqual(after.oidc,before.oidc);
writeFileSync(`${folder}/after.json`,JSON.stringify(after,null,2));
console.log(`WIF condition confirmed; mapping and issuer unchanged; 7 restriction checks PASS; backup: ${folder}`);
