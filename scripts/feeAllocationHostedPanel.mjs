import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect as baseExpect } from '@playwright/test';
import { guardedRoute, redactRecipeError } from './hostedRecipeSafety.mjs';
import { panelPersonnelFixture } from './feeAllocationPanelFixtures.mjs';
const expect = baseExpect.configure({ timeout: 45000 });

/** Uses the shared hosted recipe's scoped, durable fixture lifecycle. No real
 * account, guessed authorization, or simulated server response is accepted. */
export async function runHostedAllocationPanel({ db, tag, schoolId, yearId, put, api, allocation, manifest, save, output, browser, adminUser, password, origin, record }) {
  assert.equal(db.projectId, 'acadea-staging');
  assert.equal(schoolId, `${tag}-volume`);
  assert.ok(manifest.schools.includes(schoolId));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(60000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(redactRecipeError(error, [password])));
  try {
    await page.goto(origin + '/login');
    await page.getByPlaceholder('email@ecole.com').fill(adminUser.email);
    await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
    await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Répartition des frais', exact: true });
    const panel = drawer.getByRole('region', { name: 'Activation par établissement' });
    await expect(drawer.getByText('Aucune répartition configurée.', { exact: false })).toBeVisible();
    await expect(drawer.getByRole('table')).toHaveCount(0);
    await expect(drawer.getByRole('group', { name: /Justifier/ })).toHaveCount(0);
    await drawer.getByText('Voir les étapes d’activation', { exact: true }).click();
    await expect(drawer.getByText('Activer la répartition avec la confirmation requise.', { exact: true })).toBeVisible();
    const toolbar = drawer.getByRole('region', { name: 'Commandes de répartition' });
    const controls = toolbar.locator('button, select');
    await expect(controls).toHaveCount(4);
    assert.deepEqual(await controls.evaluateAll(nodes => nodes.map(n => n.tagName)), ['BUTTON', 'SELECT', 'SELECT', 'BUTTON']);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const boxes = await controls.evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { y: r.y, height: r.height }; }));
      assert.ok(boxes.every(b => Math.abs(b.y - boxes[0].y) < 2 && Math.abs(b.height - boxes[0].height) < 2), 'Commandes désalignées');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Débordement du panneau');
      await toolbar.focus(); await page.keyboard.press('ArrowRight');
      await page.screenshot({ path: `${output}/panneau-vide-${width}.png`, fullPage: true });
    }
    record('Panneau vide, activation repérable, ordre des quatre commandes, clavier et barre mobile sans débordement');
    await page.getByRole('button', { name: 'Fermer Répartition des frais', exact: true }).click();

    const fee = `${tag}-panel-fee`, teacher = `${tag}-panel-teacher`, student = `${tag}-panel-student`;
    await put('feeTypes', fee, { schoolId, schoolYearId: yearId, name: 'Frais fictif au libellé volontairement très long pour contrôler la barre mobile', className: '1ère Primaire', amount: 100, createdAt: new Date().toISOString() });
    await allocation('save-draft', { feeTypeId: fee, expectedRevision: 0, rubrics: [{ id: 'd'.repeat(32), name: 'Rubrique pilote fictive', mode: 'percent', basisPoints: 10000 }] }, 'volume-admin');
    const prepared = await allocation('prepare-version', { feeTypeId: fee, expectedRevision: 1 }, 'volume-admin');
    await allocation('publish-configuration', { versionId: prepared.version.id }, 'volume-admin');
    await put('students', student, { schoolId, schoolYearId: yearId, nom: 'FICTIF PANNEAU', className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', createdAt: new Date().toISOString() });
    for (let i = 0; i < 34; i++) await put('payments', `${tag}-panel-pay-${String(i).padStart(2, '0')}`, {
      schoolId, schoolYearId: yearId, amount: 2, currency: 'USD', createdAt: new Date().toISOString(),
      paidAt: new Date().toISOString(), studentId: student, feeTypeId: fee, cashierName: 'Caissier fictif',
      provenance: 'financial-api', clientRequestIdHash: `${tag}-synthetic-${i}`, receiptNumber: `FICTIF-${i}`,
    });
    await put('users', teacher, panelPersonnelFixture(tag, schoolId, yearId));
    await api('volume-cashier', { action: 'create-personnel-payment', schoolYearId: yearId, beneficiaryId: teacher,
      kind: 'salary', periodMonth: 11, periodYear: 2026, paidAt: new Date().toISOString().slice(0, 10), amount: 12,
      deduction: 0, cnss: 0, tax: 0, recoveries: [], description: 'Paie fictive recette panneau', clientRequestId: randomUUID() });
    const salaries = await db.collection('personnelPayments').where('schoolId', '==', schoolId).get();
    assert.equal(salaries.size, 1);
    const salary = salaries.docs[0], expenseRef = db.doc(`expenses/${salary.data().expenseId}`), expense = await expenseRef.get();
    assert.equal(expense.data().schoolId, schoolId); assert.equal(expense.data().personnelPaymentId, salary.id);
    manifest.paths.push(expenseRef.path, salary.ref.path); save();
    // Degrade only this newly created, identified fixture to reproduce the
    // observed historical record. The independent payroll proof stays intact.
    await expenseRef.update({ currency: null, createdAt: null }, { lastUpdateTime: expense.updateTime });
    const original = (await expenseRef.get()).data();
    let run = (await allocation('start-reconciliation', {}, 'volume-admin')).run;
    while (run.status === 'RUNNING') run = (await api('volume-admin', { action: 'fee-allocation.advance-reconciliation', runId: run.id, sequence: run.sequence })).run;
    assert.equal(run.scanned, 36); assert.equal(run.blockedCount, 1);
    const view = await api('volume-admin', { action: 'fee-allocation.get-activation' });
    assert.ok(view.evidencePage.rows.every(r => !r.reason));
    assert.equal(view.singleBlocker.nature, 'Paiement de personnel');
    const rejected = await allocation('justify-history', { collection: 'expenses', sourceId: expense.id,
      evidenceType: 'personnelPayments', evidenceId: `${tag}-missing`, reason: 'Preuve volontairement absente pour contrôle' }, 'volume-admin');
    assert.equal(rejected.decision, 'rejected');
    await api('volume-cashier', { action: 'fee-allocation.get-history-proofs', collection: 'expenses', sourceId: expense.id }, 403);
    record('36 sources fictives : un paiement de personnel bloqué hors page, preuve absente et rôle non autorisé refusés');
    await page.getByRole('button', { name: 'Répartition des frais', exact: true }).click();
    await expect(panel.getByText('36 écritures examinées · 1 paiement de personnel à vérifier', { exact: false })).toBeVisible();
    await expect(panel.getByRole('group', { name: /Justifier/ })).toHaveCount(0);
    await page.screenshot({ path: `${output}/un-paiement-personnel-a-verifier.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Voir les pièces vérifiées', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Justifier', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Voir les écritures à vérifier', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Justifier', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Justifier', exact: true }).click();
    const select = panel.getByRole('combobox', { name: 'Preuve autorisée', exact: true });
    await expect(select.locator('option')).not.toHaveCount(1);
    await select.selectOption(`personnelPayments/${salary.id}`);
    await panel.getByRole('textbox', { name: 'Motif de justification', exact: true }).fill('Paie fictive liée vérifiée par le serveur');
    let calls = 0, firstId;
    const transportFailures = [];
    await page.route('**/api/manage-financial-transaction', guardedRoute(async route => {
      const body = route.request().postDataJSON();
      if (body?.action !== 'fee-allocation.justify-history') return route.continue();
      calls++;
      if (!firstId) firstId = body.requestId; else assert.equal(body.requestId, firstId, 'Identifiant changé après réponse perdue');
      const response = await route.fetch(); assert.equal(response.status(), 200);
      await new Promise(resolve => setTimeout(resolve, 1200));
      if (calls === 1) await route.abort('connectionreset'); else await route.fulfill({ response });
    }, transportFailures));
    const button = panel.getByRole('button', { name: 'Vérifier la preuve', exact: true });
    const before = await button.boundingBox();
    await button.evaluate(node => { node.click(); node.click(); });
    const loading = panel.getByRole('button', { name: 'Chargement...', exact: true });
    await expect(loading).toBeDisabled(); const during = await loading.boundingBox();
    assert.equal(before.width, during.width); assert.equal(before.height, during.height);
    await expect(panel.getByRole('button', { name: 'Vérifier la même demande', exact: true })).toBeVisible();
    assert.equal(calls, 1);
    await panel.getByRole('button', { name: 'Vérifier la même demande', exact: true }).click();
    await expect(panel.getByText('Justification vérifiée et conservée.', { exact: false })).toBeVisible();
    // Confirmation precedes the fresh activation read. Await that read too,
    // so a transient old blocker cannot be mistaken for the final UI state.
    await expect(panel.getByRole('button', { name: 'Vérifier le solde de départ', exact: true })).toBeEnabled();
    await expect(panel.getByText('Les écritures ont changé : vérification à actualiser.', { exact: false })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Justifier', exact: true })).toHaveCount(0);
    assert.equal(calls, 2); assert.deepEqual((await expenseRef.get()).data(), original);
    assert.equal(transportFailures.length, 0, 'Transport de justification interrompu');
    await expect(panel.getByRole('group', { name: /Justifier/ })).toHaveCount(0);
    assert.deepEqual(pageErrors, [], 'Erreur JavaScript dans le parcours hébergé');
    await page.screenshot({ path: `${output}/preuve-confirmee-source-preservee.png`, fullPage: true });
    writeFileSync(`${output}/panel-proof.json`, JSON.stringify({ scanned: run.scanned, blocked: run.blockedCount, calls,
      sameRequest: true, sourceUnchanged: true, buttonBefore: before, buttonDuring: during }, null, 2));
    record('Justification reconnue via formulaire, chargement stable, double clic unique, réponse réellement perdue puis rejeu idempotent, source préservée');
  } catch (error) {
    await page.screenshot({ path: `${output}/panel-failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${output}/panel-failure.json`, JSON.stringify({ error: redactRecipeError(error, [password]),
      url: new URL(page.url()).pathname, pageErrors,
      renderedText: (await page.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 1200) }, null, 2));
    throw error;
  } finally { await context.close(); }
}
