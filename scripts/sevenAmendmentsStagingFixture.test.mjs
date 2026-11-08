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

test("l'école neuve possède une classe ciblable sans frais précréé", () => {
  const fixture = readFileSync('scripts/sevenAmendmentsStagingFixture.mjs', 'utf8');
  assert.match(fixture, /add\('students', `\$\{tag\}-c-student`, \{ schoolId: schoolEmpty, schoolYearId: year\('c'\)/);
  assert.doesNotMatch(fixture, /add\('feeTypes', `\$\{tag\}-c-/);
});

test('les PDF rasterisés sont clôturés via leur tâche de chargement', () => {
  const recipe = readFileSync('scripts/sevenAmendmentsStagingRecipe.mjs', 'utf8');
  assert.match(recipe, /const loadingTask = getDocument\(/);
  assert.match(recipe, /await loadingTask\.destroy\(\)/);
  assert.doesNotMatch(recipe, /pdf\.destroy\(/);
});

test('la recette cible la bonne coordination et confirme explicitement le nouveau frais', () => {
  const fixture = readFileSync('scripts/sevenAmendmentsStagingFixture.mjs', 'utf8');
  const recipe = readFileSync('scripts/sevenAmendmentsStagingRecipe.mjs', 'utf8');
  assert.match(fixture, /name: `Coordination fictive PR48 \$\{tag\}`/);
  assert.match(recipe, /name: `Coordination fictive PR48 \$\{m\.tag\} Active · 3 écoles`, exact: true/);
  assert.match(recipe, /getByRole\('dialog', \{ name: 'Ajouter le type de frais' \}\)/);
  assert.match(recipe, /getByRole\('textbox', \{ name: 'Phrase de confirmation' \}\)\.fill\('AJOUTER CE FRAIS'\)/);
  assert.match(recipe, /getByRole\('button', \{ name: "Confirmer l'ajout" \}\)\.click\(\)/);
  assert.match(recipe, /locator\('option', \{ hasText: 'Bibliothèque fictive PR48' \}\)\)\.toHaveCount\(1\)/);
});

test("l'OCR vérifie la catégorie et l'archive sans exiger les accents lus imparfaitement", () => {
  const recipe = readFileSync('scripts/sevenAmendmentsStagingRecipe.mjs', 'utf8');
  assert.match(recipe, /assertPdfContains\(report, 'Frais de fonctionnement', 'coordination-other-inflows'\)/);
  assert.match(recipe, /assertPdfContains\(report, 'Archive fictive', 'coordination-other-inflows'\)/);
  assert.match(recipe, /assertPdfContains\(report, '12,50', 'coordination-other-inflows'\)/);
});
