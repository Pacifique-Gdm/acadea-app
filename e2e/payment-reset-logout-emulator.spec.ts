import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import financial from '../api/manage-financial-transaction.js';
import { fixture } from './support/emulatorRecipe';

test('Caissier : formulaire neuf après confirmation, seconde saisie indépendante et échec conservé', async ({ browser }) => {
  test.setTimeout(180000);
  const f = fixture();
  try {
    await f.seed(['cashier']);
    for (const name of ['ALPHA', 'BETA']) await f.put(`students/${f.tag}-${name}`, { id: `${f.tag}-${name}`, schoolId: f.school, schoolYearId: f.year,
      nom: name, postnom: 'FICTIF', prenom: 'TEST', matricule: name, className: '1ère Secondaire', status: 'ACTIVE' });
    await f.put(`feeTypes/${f.tag}-fee`, { id: `${f.tag}-fee`, schoolId: f.school, schoolYearId: f.year, name: 'Frais fictif', className: '1ère Secondaire', amount: 100 });
    const diagnostics: string[] = [];
    const { page, context } = await f.session(browser, 'cashier', { '/api/manage-financial-transaction': financial }, undefined, async context => {
      context.on('page', page => {
        page.on('pageerror', error => diagnostics.push(error.message));
        page.on('console', message => { if (['warning', 'error'].includes(message.type())) diagnostics.push(message.text()); });
      });
    });
    try {
      await page.getByRole('button', { name: 'Contrôle', exact: true }).last().click();
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Enregistrer', exact: true });
      const search = form.getByPlaceholder('Rechercher par nom, postnom, prénom ou matricule');
      const amount = form.getByPlaceholder('Montant', { exact: true });
      await search.fill('ALPHA'); await form.getByRole('button', { name: /ALPHA FICTIF TEST/ }).click();
      await form.getByLabel('Type de frais', { exact: true }).selectOption(`${f.tag}-fee`);
      await amount.fill('10'); await form.getByLabel('Description', { exact: true }).fill('PREMIER');
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect.poll(async () => (await f.db.collection('payments').where('schoolId', '==', f.school).get()).size).toBe(1);
      await expect(search).toHaveValue(''); await expect(amount).toHaveValue('');
      await expect(form.getByText(/Élève sélectionné/)).toHaveCount(0);
      await expect(form.getByLabel('Description', { exact: true })).toHaveValue('');
      await search.fill('BETA'); await form.getByRole('button', { name: /BETA FICTIF TEST/ }).click();
      await expect(form.getByText(/ALPHA/)).toHaveCount(0);
      await expect(amount).toHaveValue(''); await expect(form.getByLabel('Description', { exact: true })).toHaveValue('');
      await form.getByLabel('Type de frais', { exact: true }).selectOption(`${f.tag}-fee`);
      await amount.fill('12'); await form.getByLabel('Description', { exact: true }).fill('SECOND');
      let dropped = false;
      await page.route('**/api/manage-financial-transaction', async route => {
        if (!dropped && route.request().postDataJSON()?.action === 'create-payment') { dropped = true; return route.abort('connectionreset'); }
        return route.fallback();
      });
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect.poll(() => dropped).toBe(true);
      await expect(form.getByRole('button', { name: 'Enregistrer', exact: true })).toBeEnabled();
      await expect(amount).toHaveValue('12'); await expect(form.getByLabel('Description', { exact: true })).toHaveValue('SECOND');
      await expect(form.getByText(/Élève sélectionné : BETA/)).toBeVisible();
      expect((await f.db.collection('payments').where('schoolId', '==', f.school).get()).size).toBe(1);
      await form.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await expect.poll(async () => (await f.db.collection('payments').where('schoolId', '==', f.school).get()).size).toBe(2);
      await expect(search).toHaveValue('');
      const payments = (await f.db.collection('payments').where('schoolId', '==', f.school).get()).docs.map(d => d.data());
      expect(payments.find(p => p.studentId === `${f.tag}-BETA`)?.amount).toBe(12);
      await page.screenshot({ path: test.info().outputPath('cashier-reset.png'), fullPage: true });
    } catch (error) {
      // Isolated emulator fixtures only; never record authentication headers.
      await page.screenshot({ path: test.info().outputPath('cashier-failure.png'), fullPage: true });
      const directRead = await page.evaluate(async ({ user, year }) => {
        const modulePath = '/src/services/firestoreData.ts';
        const service = await import(modulePath);
        const result = await service.loadFirestoreData(user, year);
        return { students: result.students.map((s: { id: string }) => s.id), fees: result.feeTypes.length };
      }, { user: { id: f.accounts.cashier.uid, role: 'cashier', schoolId: f.school }, year: f.year }).catch(error => ({ error: String(error.message) }));
      const renderedData = await page.locator('main').evaluate(element => {
        type Fiber = { return?: Fiber; memoizedProps?: { yearData?: { students?: { id: string }[]; feeTypes?: unknown[] } }; memoizedState?: Hook };
        type Hook = { memoizedState?: unknown; next?: Hook };
        const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
        let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
        const snapshots: unknown[] = [];
        while (fiber) {
          let hook = fiber.memoizedState;
          while (hook) {
            const state = hook.memoizedState as { students?: { id: string }[]; feeTypes?: unknown[]; schoolYears?: { id: string }[] } | undefined;
            if (Array.isArray(state?.students) && Array.isArray(state?.feeTypes)) snapshots.push({ students: state.students.map(s => s.id), fees: state.feeTypes.length, years: state.schoolYears?.map(y => y.id) });
            hook = hook.next;
          }
          fiber = fiber.return;
        }
        return snapshots;
      });
      await writeFile(test.info().outputPath('cashier-visible-state.json'), JSON.stringify({ url: page.url(), text: await page.locator('body').innerText(), diagnostics, directRead, renderedData }));
      throw error;
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});

test('Déconnexion : mêmes styles Administrateur/Super Administrateur, bloc isolé et session fermée', async ({ browser }) => {
  test.setTimeout(180000);
  const f = fixture(); const styles: Record<string, unknown> = {};
  try {
    await f.seed(['school_admin', 'super_admin']);
    for (const role of ['school_admin', 'super_admin']) {
      const { page, context } = await f.session(browser, role, {});
      try {
        await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
        const logout = page.getByRole('button', { name: 'Déconnexion', exact: true });
        await expect(logout).toHaveCount(1);
        if (role === 'super_admin') await expect(page.getByLabel('Session Super Administrateur').locator('button')).toHaveCount(1);
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          const style = await logout.evaluate(button => {
            const s = getComputedStyle(button), icon = button.querySelector('svg')!;
            return { color: s.color, background: s.backgroundColor, padding: s.padding, border: s.border, font: s.font, gap: s.gap, height: button.getBoundingClientRect().height, icon: [icon.getBoundingClientRect().width, icon.getBoundingClientRect().height] };
          });
          if (role === 'school_admin') styles[String(width)] = style; else expect(style).toEqual(styles[String(width)]);
          await logout.scrollIntoViewIfNeeded();
          await page.screenshot({ path: test.info().outputPath(`${role}-logout-${width}.png`), fullPage: true });
        }
        await logout.click();
        await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Se connecter', exact: true })).toBeVisible();
      } finally { await context.close(); }
    }
  } finally { await f.cleanup(); }
});
