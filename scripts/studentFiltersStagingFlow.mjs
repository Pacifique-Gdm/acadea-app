import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { expect } from '@playwright/test';

/**
 * Authenticated, read-only student-filter exercise against the hosted candidate.
 * The caller must sign in with one of the fixture's ordinary school accounts.
 * Nothing here seeds data, mocks an API, or bypasses Firebase authentication.
 */
export async function runStudentFilters({ page, role, fixture, evidenceDir }) {
  assert.ok(['school_admin', 'secretary', 'study_director'].includes(role));
  assert.equal(fixture?.projectId, 'acadea-staging');
  assert.match(fixture?.tag ?? '', /^e2e-social-[a-f0-9]{32}$/);
  mkdirSync(evidenceDir, { recursive: true });

  await page.getByRole('button', { name: 'Élèves', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Élèves', exact: true })).toBeVisible({ timeout: 60_000 });

  const search = page.getByPlaceholder('Rechercher', { exact: true });
  const filterBar = search.locator('xpath=../..');
  const selectors = filterBar.locator('select');
  await expect(selectors).toHaveCount(4);
  const archive = selectors.nth(0);
  const section = selectors.nth(1);
  const schoolClass = selectors.nth(2);
  const option = selectors.nth(3);
  const table = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Nom complet' }) });
  const social = table.locator('tbody tr').filter({ hasText: 'SOCIAL FICTIF' });
  const unpaid = table.locator('tbody tr').filter({ hasText: 'IMPAYE FICTIF' });
  const commercial = table.locator('tbody tr').filter({ hasText: 'COMMERCIAL FICTIF' });
  const sciences = table.locator('tbody tr').filter({ hasText: 'SCIENCES FICTIF' });
  const foreign = table.locator('tbody tr').filter({ hasText: 'ÉTRANGER FICTIF' });

  await expect(social).toHaveCount(1, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(1, { timeout: 60_000 });
  await expect(commercial).toHaveCount(1, { timeout: 60_000 });
  await expect(sciences).toHaveCount(1, { timeout: 60_000 });
  await expect(foreign).toHaveCount(0);
  await expect(page.getByText('Impossible de charger les élèves :', { exact: false })).toHaveCount(0);

  // Individual and combined filters must requery within the same school/year.
  await section.selectOption('Primaire');
  await expect(social).toHaveCount(1, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(1, { timeout: 60_000 });
  await expect(commercial).toHaveCount(0, { timeout: 60_000 });
  await expect(sciences).toHaveCount(0, { timeout: 60_000 });

  await schoolClass.selectOption({ label: '2ème Primaire' });
  await expect(social).toHaveCount(0, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(0, { timeout: 60_000 });

  await search.fill('SOCIAL');
  await expect(social).toHaveCount(0, { timeout: 60_000 });
  await schoolClass.selectOption({ label: '1ère Primaire' });
  await expect(social).toHaveCount(1, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(0, { timeout: 60_000 });

  await search.fill('ÉTRANGER');
  await expect(foreign).toHaveCount(0, { timeout: 60_000 });
  await search.fill('');
  await expect(unpaid).toHaveCount(1, { timeout: 60_000 });

  await archive.selectOption('archived');
  await expect(social).toHaveCount(0, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(0, { timeout: 60_000 });
  await archive.selectOption('active');
  await expect(social).toHaveCount(1, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(1, { timeout: 60_000 });

  await section.selectOption('Secondaire');
  await expect(commercial).toHaveCount(1, { timeout: 60_000 });
  await expect(sciences).toHaveCount(1, { timeout: 60_000 });
  await expect(social).toHaveCount(0, { timeout: 60_000 });
  await schoolClass.selectOption({ label: '3ème Humanité' });
  await expect(option).toBeEnabled({ timeout: 60_000 });
  await option.selectOption({ label: 'Commerciale' });
  await expect(commercial).toHaveCount(1, { timeout: 60_000 });
  await expect(sciences).toHaveCount(0, { timeout: 60_000 });
  await option.selectOption({ label: 'Sciences' });
  await expect(sciences).toHaveCount(1, { timeout: 60_000 });
  await expect(commercial).toHaveCount(0, { timeout: 60_000 });
  await option.selectOption('');
  await expect(commercial).toHaveCount(1, { timeout: 60_000 });
  await expect(sciences).toHaveCount(1, { timeout: 60_000 });
  await schoolClass.selectOption('');
  await section.selectOption('all');
  await expect(social).toHaveCount(1, { timeout: 60_000 });
  await expect(unpaid).toHaveCount(1, { timeout: 60_000 });
  await expect(commercial).toHaveCount(1, { timeout: 60_000 });
  await expect(sciences).toHaveCount(1, { timeout: 60_000 });
  await expect(foreign).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/${role}-student-filters.png`, fullPage: true });
  return {
    role,
    individualFilters: ['section', 'class', 'option', 'search', 'status'],
    combinedFilters: ['section+class+search'],
    reset: true,
    foreignSchoolStudentHidden: true,
    optionFilter: 'commerciale-and-sciences-exercised',
  };
}
