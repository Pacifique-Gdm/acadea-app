import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { guard, services, prepare, retire, projectId } from './sevenAmendmentsStagingFixture.mjs';

const origin = 'https://acadea-staging.vercel.app';
const output = 'diagnostics/seven-amendments-staging';
const results = [];
const record = (name, result, detail) => { results.push({ name, result, ...(detail ? { detail } : {}) }); console.log(`${result}: ${name}`); };
const checked = async (name, run) => {
  try { await run(); record(name, 'PASS'); }
  catch (error) { record(name, 'FAIL', String(error.message).slice(0, 500)); process.exitCode = 1; }
};
const eventually = (run, expected, label) => expect.poll(run, { timeout: 60000, message: label }).toEqual(expected);

guard();
assert.ok(process.env.STAGING_FIREBASE_API_KEY, 'Configuration Auth Staging absente.');
const expectedSha = process.env.ACADEA_EXPECTED_SHA;
// Ce contrôle précède même l'initialisation des clients Firebase et toute fixture.
const response = await fetch(origin + '/version.json', { redirect: 'manual', signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200, 'SHA Staging inaccessible : aucune fixture créée.');
assert.equal((await response.json()).version, expectedSha, 'SHA Staging différent : aucune fixture créée.');
const home = await (await fetch(origin, { signal: AbortSignal.timeout(15000) })).text();
const asset = home.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
assert.ok(asset, 'Bundle applicatif absent : aucune fixture créée.');
const bundle = await (await fetch(origin + asset, { signal: AbortSignal.timeout(15000) })).text();
assert.ok(bundle.includes(projectId) && !bundle.includes('acadea-production.firebaseapp.com'),
  'Bundle Firebase non conforme au Staging : aucune fixture créée.');
mkdirSync(output, { recursive: true });
record('SHA et Firebase du frontend hébergé avant fixtures', 'PASS');

const s = services();
let m, password, browser;
const tokens = new Map();
async function api(key, action) {
  const response = await fetch(origin + '/api/manage-financial-transaction', {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.get(key)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(action), signal: AbortSignal.timeout(30000),
  });
  return { status: response.status, body: await response.json() };
}
async function withRole(key, run) {
  const account = m.users.find(user => user.key === key);
  assert.ok(account, 'Rôle de fixture absent.');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);
  try {
    await page.goto(origin + '/login');
    await page.getByPlaceholder('email@ecole.com').fill(account.email);
    await page.getByPlaceholder('Votre mot de passe').fill(password);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dashboard', exact: true }).last()).toBeVisible({ timeout: 60000 });
    await run(page, context);
  } catch (error) {
    if (key !== 'platform') await page.screenshot({ path: `${output}/failure-${key}-${results.length}.png`, fullPage: true }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
async function pdfFromPreview(page, label) {
  const anchor = page.locator('[data-pdf-download]');
  await expect(anchor).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
  const values = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(
    document.querySelector('[data-pdf-download]').href)).arrayBuffer())));
  const bytes = Buffer.from(values);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', `Export ${label} invalide.`);
  writeFileSync(`${output}/${label}.pdf`, bytes);
  const loadingTask = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await loadingTask.promise;
  assert.ok(pdf.numPages > 0 && pdf.numPages < 30, `Pagination ${label} anormale.`);
  const extracted = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const pagePdf = await pdf.getPage(index);
    extracted.push((await pagePdf.getTextContent()).items.map(item => item.str ?? '').join(' '));
    // Les petits montants des cartes d'arriérés (page 1) sont illisibles pour
    // l'OCR à 1,5×, bien qu'ils soient présents dans le PDF rasterisé.
    const viewport = pagePdf.getViewport({ scale: index === 1 && label.endsWith('-dashboard') ? 3 : 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    await pagePdf.render({ canvasContext: context, canvas, viewport }).promise;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let offset = 0; offset < pixels.length; offset += 16) if (pixels[offset] < 230 || pixels[offset + 1] < 230 || pixels[offset + 2] < 230) ink++;
    assert.ok(ink > 300, `Page blanche ou presque blanche : ${label}, page ${index}.`);
    const imagePath = `${output}/${label}-page-${index}.png`;
    writeFileSync(imagePath, canvas.toBuffer('image/png'));
    // Les rapports Acadéa sont rasterisés : getTextContent seul ne valide pas leurs données.
    extracted.push(execFileSync('tesseract', [imagePath, 'stdout', '-l', 'fra+eng', '--psm', '11'],
      { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] }));
  }
  const documentText = extracted.join('\n');
  writeFileSync(`${output}/${label}-text.txt`, documentText);
  await loadingTask.destroy();
  if (await page.locator('[data-pdf-close]').count()) await page.locator('[data-pdf-close]').click();
  return documentText;
}

function assertPdfContains(text, expected, label) {
  // OCR peut changer les espaces fines insécables utilisés par la locale fr.
  const comparable = text.normalize('NFKD').replace(/[\u0300-\u036f\s\u00a0\u202f]/g, '').toLowerCase();
  assert.ok(comparable.includes(expected.normalize('NFKD').replace(/[\u0300-\u036f\s\u00a0\u202f]/g, '').toLowerCase()),
    `Contenu attendu absent du PDF ${label} : ${expected}`);
}

try {
  ({ m, password } = await prepare(s));
  for (const account of m.users) {
    const result = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: account.email, password, returnSecureToken: true }), signal: AbortSignal.timeout(30000),
    });
    assert.equal(result.status, 200, `Authentification Firebase officielle refusée pour ${account.key}.`);
    tokens.set(account.key, (await result.json()).idToken);
  }
  record('Authentification Firebase des sept comptes fictifs', 'PASS');
  browser = await chromium.launch({ headless: true });

  // 5. Caissier : nature personnalisée, ancienne archive et refus serveur.
  await checked('5 — Autres entrées Caissier, nature libre et archive', async () => {
    const invalid = await api('cashier', { action: 'create-cash-inflow', schoolYearId: m.years.a,
      category: 'Autres', categoryDetail: ' ', amount: 10, entryDate: m.today,
      source: 'Fixture PR48', paymentMethod: 'Espèces', description: 'Écriture fictive PR48', clientRequestId: m.tag + '-invalid' });
    assert.equal(invalid.status, 400);
    const teacher = await api('teacher', { action: 'create-cash-inflow', schoolYearId: m.years.a,
      category: 'Don', amount: 10, entryDate: m.today, source: 'Fixture PR48', paymentMethod: 'Espèces',
      description: 'Écriture fictive PR48', clientRequestId: m.tag + '-forbidden' });
    assert.equal(teacher.status, 403);
    await withRole('cashier', async page => {
      await page.getByRole('button', { name: 'Contrôle', exact: true }).last().click();
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      await page.getByLabel("Type d'enregistrement").selectOption('inflow');
      const form = page.getByRole('form', { name: 'Autres entrées de caisse', exact: true });
      await expect(form.getByLabel("Nature de l'entrée", { exact: true }).locator('option')).toHaveText(['Subvention', 'Don', 'Autres']);
      await form.getByLabel("Nature de l'entrée", { exact: true }).selectOption('Autres');
      await form.getByLabel("Précisez la nature de l'entrée").fill('Recette exceptionnelle fictive');
      await form.getByLabel('Montant', { exact: true }).fill('12,50');
      await form.getByLabel('Provenance des fonds').fill('Association fictive');
      await form.getByLabel('Mode de paiement').fill('Espèces');
      await form.getByLabel('Description', { exact: true }).fill('Entrée fictive PR48 contrôlée');
      await form.getByRole('button', { name: 'Enregistrer cette entrée' }).click();
      await eventually(async () => (await s.db.collection('cashInflows').where('schoolId', '==', m.schools[0]).get()).size, 2, 'Une seule nouvelle entrée fictive');
      const rows = await s.db.collection('cashInflows').where('schoolId', '==', m.schools[0]).get();
      const custom = rows.docs.find(doc => doc.data().categoryDetail === 'Recette exceptionnelle fictive');
      assert.ok(custom && custom.data().amount === 12.5 && custom.data().currency === 'USD');
      const idempotentRequest = { action: 'create-cash-inflow', schoolYearId: m.years.a,
        category: 'Don', amount: 3, entryDate: m.today, source: 'Association fictive', paymentMethod: 'Espèces',
        description: 'Réessai idempotent fictif PR48', clientRequestId: m.tag + '-inflow-repeat' };
      const once = await api('cashier', idempotentRequest);
      const twice = await api('cashier', idempotentRequest);
      assert.equal(once.status, 200); assert.equal(twice.status, 200);
      assert.ok(once.body.cashInflow?.id);
      assert.equal(twice.body.cashInflow?.id, once.body.cashInflow.id);
      await eventually(async () => (await s.db.collection('cashInflows').where('schoolId', '==', m.schools[0]).get()).size, 3,
        'Deux demandes identiques ne créent qu’une entrée supplémentaire');
      await page.getByRole('button', { name: 'Fermer Enregistrer', exact: true }).click();
      await page.getByRole('button', { name: 'Historique', exact: true }).click();
      await page.getByLabel("Type d'historique").selectOption('cashInflows');
      const history = page.getByRole('dialog', { name: 'Historique' });
      await expect(history.getByText('Recette exceptionnelle fictive', { exact: false }).first()).toBeVisible();
      await expect(history.getByText('Frais de fonctionnement reçus', { exact: false }).first()).toBeVisible();
      await page.screenshot({ path: `${output}/cashier-inflows.png`, fullPage: true });
    });
  });

  // 1. Une coordination couvre USD et CDF ; chaque devise reste visible même à zéro.
  for (const key of ['coordination', 'sub_coordination']) await checked(`1 — Arriérés Dashboard ${key}`, async () => {
    await withRole(key, async page => {
      const card = page.getByText('Arriérés', { exact: true }).first().locator('..');
      await expect(card).toContainText('80,00', { timeout: 60000 });
      await expect(card).toContainText('10 000,00', { timeout: 60000 });
      await expect(card).not.toContainText('USD :');
      await expect(card).not.toContainText('CDF :');
      await page.getByRole('button', { name: 'Exporter PDF', exact: true }).first().click();
      const report = await pdfFromPreview(page, `${key}-dashboard`);
      assertPdfContains(report, '80,00', `${key}-dashboard`);
      assertPdfContains(report, '10 000,00', `${key}-dashboard`);
      const schoolFilter = page.getByLabel('Filtrer par école').first();
      await schoolFilter.selectOption(m.schools[0]);
      await expect(card).toContainText('80,00');
      await expect(card).not.toContainText('FC');
      await schoolFilter.selectOption(m.schools[1]);
      await expect(card).toContainText('10 000,00');
      await expect(card).not.toContainText('$');
      await schoolFilter.selectOption(m.schools[2]);
      await expect(card).toContainText('0,00');
      await expect(card).not.toContainText('FC');
      await page.screenshot({ path: `${output}/${key}-arrears.png`, fullPage: true });
    });
  });

  // 2. Affichage Administrateur/Caissier sans préfixes mais avec devise et montant.
  for (const key of ['admin', 'cashier']) await checked(`2 — Arriérés Dashboard ${key}`, async () => {
    await withRole(key, async page => {
      const card = page.getByText('Arriérés', { exact: true }).first().locator('..');
      await expect(card).toContainText('80,00', { timeout: 60000 });
      await expect(card).toContainText('$');
      await expect(card).not.toContainText('USD :');
      await expect(card).not.toContainText('CDF :');
      await page.screenshot({ path: `${output}/${key}-arrears.png`, fullPage: true });
    });
  });

  // 3. L'historique Coordination contient l'ancienne et la nouvelle nature, avec PDF.
  await checked('3 — Historique Autres entrées Coordination et PDF', async () => {
    await withRole('coordination', async page => {
      await page.getByRole('button', { name: 'Contrôle', exact: true }).last().click();
      await page.getByRole('button', { name: 'Historique', exact: true }).click();
      const history = page.getByRole('dialog', { name: 'Historique du contrôle' });
      const toolbar = history.getByRole('button');
      const labels = await toolbar.allTextContents();
      assert.ok(labels.indexOf('Autres entrées') >= 0 && labels.indexOf('Autres entrées') < labels.indexOf('Salaire/Prime'));
      await history.getByRole('button', { name: 'Autres entrées', exact: true }).click();
      await expect(history.getByText('Recette exceptionnelle fictive', { exact: false })).toBeVisible({ timeout: 60000 });
      await expect(history.getByText('Frais de fonctionnement reçus', { exact: false })).toBeVisible();
      await history.getByRole('button', { name: 'Exporter PDF' }).click();
      const report = await pdfFromPreview(page, 'coordination-other-inflows');
      assertPdfContains(report, 'Recette exceptionnelle fictive', 'coordination-other-inflows');
      // L'OCR raster peut perdre les accents ou des lettres, mais les mots et la ligne d'archive restent contrôlés.
      assertPdfContains(report, 'Frais de fonctionnement', 'coordination-other-inflows');
      assertPdfContains(report, 'Archive fictive', 'coordination-other-inflows');
      assertPdfContains(report, '12,50', 'coordination-other-inflows');
      await page.screenshot({ path: `${output}/coordination-history.png`, fullPage: true });
    });
  });

  // 4. Le libellé Super Administrateur n'exécute aucune suppression pendant la recette.
  await checked('4 — Super Administrateur : Retirer et confirmation non exécutée', async () => {
    await withRole('platform', async page => {
      await page.getByRole('button', { name: 'Coordinations', exact: true }).last().click();
      await page.getByRole('button', { name: `Coordination fictive PR48 ${m.tag} Active · 3 écoles`, exact: true }).click();
      const management = page.getByRole('region', { name: 'Gestion de la Coordination' });
      const remove = management.getByRole('button', { name: /Retirer École fictive PR48 A de la coordination/ });
      await expect(remove).toBeVisible();
      await expect(management.getByRole('button', { name: /Retirer de la Coordination/ })).toHaveCount(0);
      await remove.click();
      await expect(management.getByText(/confirmer/i).first()).toBeVisible();
      assert.equal((await s.db.doc(`coordinationSchools/${m.coordinationId}__${m.schools[0]}`).get()).data().active, true);
      await management.screenshot({ path: `${output}/super-admin-retirer.png` });
    });
  });

  // 6. Une école neuve n'a aucun type de frais implicite ; création manuelle via l'interface.
  await checked('6 — Types de frais : école neuve, ajout manuel et école historique intacte', async () => {
    assert.equal((await s.db.collection('feeTypes').where('schoolId', '==', m.schools[2]).get()).size, 0);
    await withRole('empty_admin', async page => {
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      await page.getByRole('button', { name: /Types de frais/ }).click();
      await expect(page.getByText("Aucun type de frais n'a encore été ajouté pour cet établissement.")).toBeVisible();
      const editor = page.getByTestId('fee-editor');
      await expect(editor.getByLabel('Frais')).not.toContainText('Minerval');
      await expect(editor.getByLabel('Frais')).not.toContainText('Fourniture');
      await editor.getByLabel('Frais').selectOption('__add_fee__');
      await page.getByPlaceholder('Nom du frais').fill('Bibliothèque fictive PR48');
      await page.getByRole('button', { name: 'Ajouter le frais' }).click();
      await expect(editor.getByLabel('Frais')).toHaveValue('Bibliothèque fictive PR48');
      await editor.getByRole('checkbox').first().check();
      await editor.getByLabel('Montant ($)').fill('15');
      await editor.getByRole('button', { name: 'Enregistrer', exact: true }).click();
      const confirmation = page.getByRole('dialog', { name: 'Ajouter le type de frais' });
      await expect(confirmation).toBeVisible();
      await expect(confirmation.getByRole('button', { name: "Confirmer l'ajout" })).toBeDisabled();
      await confirmation.getByRole('textbox', { name: 'Phrase de confirmation' }).fill('AJOUTER CE FRAIS');
      await confirmation.getByRole('button', { name: "Confirmer l'ajout" }).click();
      await expect(confirmation).toBeHidden();
      await eventually(async () => (await s.db.collection('feeTypes').where('schoolId', '==', m.schools[2]).get()).size, 1, 'Frais créé une seule fois');
      await page.reload();
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      await page.getByRole('button', { name: /Types de frais/ }).click();
      await expect(page.getByTestId('fee-editor').getByLabel('Frais').locator('option', { hasText: 'Bibliothèque fictive PR48' })).toHaveCount(1);
      await page.screenshot({ path: `${output}/new-school-fee.png`, fullPage: true });
    });
    assert.equal((await s.db.doc(`feeTypes/${m.fees.a}`).get()).data().name, 'Minerval');
  });

  // 7. Identifiant du bénéficiaire immuable, y compris via une requête forgée.
  await checked('7 — Décision sociale : bénéficiaire figé, modification autorisée, transfert refusé', async () => {
    const base = { action: 'save-social-support', studentId: m.students.a, schoolYearId: m.years.a,
      reason: 'social', nature: 'fixed', observation: 'Justification fictive PR48',
      lines: [{ feeTypeId: m.fees.a, value: 100 }], clientRequestId: m.tag + '-social-create' };
    const first = await api('admin', base);
    assert.equal(first.status, 200);
    const decision = first.body.decision;
    assert.ok(decision?.id && decision?.studentId === m.students.a);
    const forged = await api('admin', { ...base, decisionId: decision.id, expectedVersion: decision.version,
      studentId: m.students.aOther, confirmation: 'JE CONFIRME LA MODIFICATION',
      clientRequestId: m.tag + '-social-forged' });
    assert.equal(forged.status, 409);
    await withRole('admin', async page => {
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      await page.getByRole('button', { name: /Cas sociaux et prises en charge/ }).click();
      await page.getByRole('tab', { name: 'Bénéficiaires', exact: true }).click();
      await page.getByRole('button', { name: 'Modifier', exact: true }).first().click();
      const editor = page.getByRole('dialog', { name: 'Modifier la décision sociale' });
      await expect(editor.getByTestId('social-support-beneficiary')).toContainText('FICTIF-A');
      await expect(editor.getByRole('combobox', { name: 'Rechercher un élève' })).toHaveCount(0);
      await editor.getByLabel('Minerval — Montant').fill('80');
      await editor.getByRole('button', { name: 'Modifier', exact: true }).click();
      await editor.getByLabel('Saisissez JE CONFIRME LA MODIFICATION').fill('incorrect');
      await expect(editor.getByRole('button', { name: 'Confirmer la modification' })).toBeDisabled();
      await editor.getByLabel('Saisissez JE CONFIRME LA MODIFICATION').fill('JE CONFIRME LA MODIFICATION');
      await editor.getByRole('button', { name: 'Confirmer la modification' }).click();
      await expect(editor).toHaveCount(0);
      await page.screenshot({ path: `${output}/social-editor.png`, fullPage: true });
    });
    const updated = await s.db.doc(`socialSupportDecisions/${decision.id}`).get();
    assert.equal(updated.data().studentId, m.students.a);
    assert.equal(updated.data().lines[m.fees.a].reductionMinor, 8000);
  });

  // Permissions croisées et écriture financière directe par le client.
  await checked('Permissions — établissements étrangers et écriture client interdite', async () => {
    const allowed = await api('cashier', { action: 'list-arrears', studentId: m.students.a, schoolYearId: m.years.a });
    assert.equal(allowed.status, 200, 'La lecture autorisée doit fonctionner avant le test de refus.');
    const foreign = await api('cashier', { action: 'list-arrears', studentId: m.students.foreign, schoolYearId: m.years.a });
    assert.ok(foreign.status >= 400 && foreign.status < 500);
    const direct = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/cashInflows/${m.tag}-forged`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${tokens.get('cashier')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { schoolId: { stringValue: m.schools[0] }, amount: { doubleValue: 999 } } }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(direct.status, 403);
    assert.equal((await s.db.doc(`cashInflows/${m.tag}-forged`).get()).exists, false);
    assert.equal((await s.db.collection('cashInflows').where('schoolId', '==', m.schools[3]).get()).size, 0);
  });
} catch (error) {
  record('Initialisation ou fixture hébergée', 'FAIL', String(error.message).slice(0, 500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try { await retire(s); record('Clôture Auth et écoles fictives', 'PASS'); }
  catch (error) { record('Clôture Auth et écoles fictives', 'FAIL', String(error.message).slice(0, 500)); process.exitCode = 1; }
  if (m) try {
    const retained = [];
    for (const collection of ['payments', 'cashInflows', 'feeTypes', 'socialSupportDecisions',
      'auditLogs', 'financialIdempotency', 'financialCashLocks', 'socialSupportAudit',
      'socialSupportRequests', 'socialSupportFeeLocks', 'feeKindRequests', 'feeTypeRequests', 'feeTypeKeys']) {
      for (const schoolId of m.schools) {
        const rows = await s.db.collection(collection).where('schoolId', '==', schoolId).get();
        retained.push(...rows.docs.map(row => ({ path: `${collection}/${row.id}`, schoolId })));
      }
    }
    // Le limiteur conserve uniquement un hachage de l'école, sans schoolId en clair.
    for (const schoolId of m.schools) {
      const schoolIdHash = createHash('sha256').update(`school\u001f${schoolId}\u001f`).digest('hex');
      // Le hachage réel inclut l'action ; seules les actions effectivement jouées sont inspectées.
      for (const action of ['finance.create-cash-inflow', 'finance.list-arrears', 'finance.save-social-support',
        'finance.add-fee-kind', 'finance.save-fee-types']) {
        const hash = createHash('sha256').update(`school\u001f${schoolId}\u001f${action}`).digest('hex');
        const rows = await s.db.collection('_rateLimits').where('schoolIdHash', '==', hash).get();
        retained.push(...rows.docs.map(row => ({ path: `_rateLimits/${row.id}`, schoolId })));
      }
      void schoolIdHash;
    }
    const unique = [...new Map(retained.map(row => [row.path, row])).values()];
    writeFileSync(`${output}/retained-fixtures.json`, JSON.stringify({ fixtureTag: m.tag, retained: unique }, null, 2));
    record('Inventaire des documents fictifs conservés sans suppression', 'PASS');
  } catch (error) {
    record('Inventaire des documents fictifs conservés sans suppression', 'FAIL', String(error.message).slice(0, 500));
    process.exitCode = 1;
  }
  await s.close();
  writeFileSync(`${output}/results.json`, JSON.stringify({ sha: expectedSha, results }, null, 2));
}
