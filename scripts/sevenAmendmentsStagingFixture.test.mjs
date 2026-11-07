import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { guard, validateManifest } from './sevenAmendmentsStagingFixture.mjs';

function validManifest() {
  const tag = `e2e-seven-${'a'.repeat(32)}`;
  const schools = ['a', 'b', 'c', 'd'].map(suffix => `${tag}-${suffix}`);
  const rows = [
    ['admin', 'school_admin', schools[0]], ['cashier', 'cashier', schools[0]],
    ['empty_admin', 'school_admin', schools[2]], ['coordination', 'coordination_admin', ''],
    ['sub_coordination', 'sub_coordination_admin', ''], ['platform', 'super_admin', ''],
    ['teacher', 'teacher', schools[0]],
  ];
  return { projectId: 'acadea-staging', tag, schools, users: rows.map(([key, role, schoolId]) => ({
    key, role, schoolId, uid: `${tag}-${key}`, email: `${tag}-${key}@example.invalid`,
  })), documents: [{ path: `schools/${schools[0]}`, data: { id: schools[0], fixtureId: tag } }] };
}

test('la fixture refuse tout projet, compte ou document étranger', () => {
  const m = validManifest();
  assert.doesNotThrow(() => validateManifest(m));
  for (const change of [
    row => { row.projectId = 'acadea-production'; },
    row => { row.users[0].role = 'super_admin'; },
    row => { row.users[0].schoolId = row.schools[1]; },
    row => { row.documents[0].path = 'schools/real-school'; },
    row => { row.documents[0].data.fixtureId = 'foreign'; },
  ]) {
    const altered = structuredClone(m); change(altered);
    assert.throws(() => validateManifest(altered), /ambigu/);
  }
});

test('aucune recette sans cible et SHA Staging explicites', () => {
  const old = process.env.ACADEA_SEVEN_STAGING;
  delete process.env.ACADEA_SEVEN_STAGING;
  try { assert.throws(() => guard(), /Staging/); }
  finally { if (old === undefined) delete process.env.ACADEA_SEVEN_STAGING; else process.env.ACADEA_SEVEN_STAGING = old; }
});

test('le workflow vérifie le SHA avant WIF et conserve la clôture systématique', () => {
  const workflow = readFileSync('.github/workflows/seven-amendments-staging-recipe.yml', 'utf8');
  assert.ok(workflow.indexOf('Garde SHA et projet') < workflow.indexOf('google-github-actions/auth@v3'));
  assert.ok(workflow.indexOf('google-github-actions/auth@v3') < workflow.indexOf('Sept parcours authentifiés'));
  assert.match(workflow, /if: always\(\) && steps\.cleanup-auth\.outcome == 'success'/);
  assert.match(workflow, /sudo apt-get update && sudo apt-get install -y poppler-utils/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/codex\/acadea-seven-ui-finance-amendments-20261106'/);
  assert.match(workflow, /GOOGLE_CLOUD_PROJECT: acadea-staging/);
});
