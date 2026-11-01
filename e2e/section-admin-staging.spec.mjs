import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deleteApp } from 'firebase-admin/app';
import { jsPDF } from 'jspdf';
import { manifest, services } from '../scripts/sectionStagingFixture.mjs';
import { roles, sections } from '../scripts/sectionStagingPlan.mjs';

let m, s, witness;
const tokens = new Map();
const origin = process.env.ACADEA_SECTION_PREVIEW_URL;
const protection = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
const provision = '/api/provision-school-account', finance = '/api/manage-financial-transaction';
async function token(key) {
  if (tokens.has(key)) return tokens.get(key);
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.STAGING_FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: m.users[key].email, password: process.env.ACADEA_E2E_PASSWORD, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Connexion fictive refusée (${response.status}).`);
  const result = await response.json(); tokens.set(key, result.idToken); return result.idToken;
}
async function api(key, path, body, extra = {}) {
  const response = await fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', redirect: 'error',
    headers: { ...protection, Authorization: `Bearer ${await token(key)}`, 'Content-Type': 'application/json', ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function ok(key, path, body) { const r = await api(key, path, body); expect(r.status).toBe(200); return r.body; }
async function denied(key, path, body) { expect((await api(key, path, body)).status).toBe(403); }
async function direct(key, path, method, fields) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/acadea-staging/databases/(default)/documents/${path}`, {
    method, headers: { Authorization: `Bearer ${await token(key)}`, 'Content-Type': 'application/json' },
    ...(fields ? { body: JSON.stringify({ fields }) } : {}),
  });
  return response.status;
}
test.beforeAll(async () => {
  m = manifest(); s = await services();
  for (const [key, user] of Object.entries(m.users).filter(([, u]) => roles[u.role])) {
    const data = { action: 'manage-section-administrator', operation: 'activate', schoolId: user.schoolId, userId: user.uid, confirmation: 'ACTIVER CET UTILISATEUR' };
    expect((await api('super_admin', provision, { ...data, confirmation: 'NON' })).status).toBe(400);
    await ok('super_admin', provision, data);
    await token(key);
  }
  witness = await Promise.all(m.documents.filter(d => d.data.schoolId === m.schools[1] || d.path === `schools/${m.schools[1]}`).map(async d => [d.path, (await s.db.doc(d.path).get()).data()]));
});
test.afterAll(async () => {
  try { for (const [path, data] of witness ?? []) expect((await s.db.doc(path).get()).data()).toEqual(data); }
  finally { tokens.clear(); if (s) await deleteApp(s.app); }
});

for (const [role, allowed] of Object.entries(roles)) test(`${role} — cinq onglets, autorisations et refus réels`, async ({ browser }) => {
  const key = `0-${role}`, school = m.schools[0], year = m.years[0];
  const indexes = sections.flatMap((section, i) => allowed.includes(section) ? [i] : []);
  const forbidden = sections.findIndex(section => !allowed.includes(section));
  const bootstrap = await ok(key, provision, { action: 'load-section-school-bootstrap' });
  expect(bootstrap.schools.map(row => row.id)).toEqual([school]);
  const dashboard = await ok(key, provision, { action: 'load-section-dashboard', schoolYearId: year });
  expect(dashboard.students).toBe(indexes.length);
  expect(dashboard.financialStats.paid).toBe(indexes.reduce((sum, i) => sum + (i + 1) * 100, 0));
  for (const kind of ['students', 'classes', 'feeTypes', 'personnel', 'servicePersonnel', 'medicalRecords', 'valves']) {
    const result = await ok(key, provision, { action: 'list-section-school-records', kind, schoolYearId: year });
    expect(result.schoolId).toBe(school);
    if (kind === 'students') expect(result.items.map(row => row.id).sort()).toEqual(indexes.map(i => `${school}-student-${i}`).sort());
  }
  await denied(key, provision, { action: 'load-section-dashboard', schoolYearId: m.years[1] });
  for (const action of ['create-parent', 'delete-parent', 'delete-student', 'create-school-user', 'delete-school-user']) {
    await denied(key, provision, { action, schoolId: school, userId: m.users[key].uid, studentId: `${school}-student-${indexes[0]}` });
  }
  for (const kind of ['payments', 'expenses', 'cashInflows']) {
    const result = await ok(key, finance, { action: 'list-section-financial-history', kind, schoolYearId: year });
    expect(result.items.length).toBe(kind === 'payments' ? indexes.length : 1);
    if (kind === 'payments') expect(result.items.every(row => indexes.some(i => row.studentId === `${school}-student-${i}`))).toBe(true);
  }
  const balance = await ok(key, finance, { action: 'list-cash-balance', schoolYearId: year });
  expect(balance.schoolId).toBe(school); expect(balance.availableCents).toBeGreaterThanOrEqual(190000);
  const payroll = await ok(key, finance, { action: 'list-payroll-history', schoolId: school });
  expect(payroll.payments.some(row => row.id === `${school}-payroll`)).toBe(true);
  for (const action of ['create-expense', 'update-expense', 'delete-expense', 'create-cash-inflow', 'create-personnel-payment', 'update-personnel-payment', 'delete-personnel-payment', 'delete-payment']) {
    await denied(key, finance, { action, schoolYearId: year, transactionId: `${school}-payment-${indexes[0]}`, amount: 100, clientRequestId: randomUUID() });
  }
  // Genuine financial write, replay and authoritative result, only on the fixture.
  const payment = { action: 'create-payment', schoolYearId: year, studentId: `${school}-student-${indexes[0]}`, feeTypeId: `${school}-fee`, amount: 10, expectedCurrency: 'CDF', expectedFeeAmount: 10000, clientRequestId: randomUUID() };
  const first = await ok(key, finance, payment), replay = await ok(key, finance, payment);
  expect(replay.payment?.id).toBe(first.payment?.id); expect(first.payment?.id).toBeTruthy();
  expect((await s.db.doc(`payments/${first.payment.id}`).get()).data().amount).toBe(10);
  await denied(key, finance, { ...payment, studentId: `${school}-student-${forbidden}`, clientRequestId: randomUUID() });
  const invalidCorrection = await api(key, finance, { action: 'update-payment', transactionId: first.payment.id, amount: 0, reason: 'Annulation fictive', confirmation: 'MODIFIER CE PAIEMENT', expectedUpdatedAt: first.payment.updatedAt ?? first.payment.createdAt, clientRequestId: randomUUID() });
  expect(invalidCorrection.status).toBe(400);
  expect((await s.db.doc(`payments/${first.payment.id}`).get()).data().amount).toBe(10);
  for (const path of [`users/${m.users[key].uid}`, `parents/${school}-parent`, `expenses/${school}-expense`, `cashInflows/${school}-inflow`]) {
    expect(await direct(key, path, 'PATCH', { active: { booleanValue: false } })).toBe(403);
  }
  expect(await direct(key, `students/${school}-student-${indexes[0]}`, 'DELETE')).toBe(403);
  expect(await direct(key, `students/${m.schools[1]}-student-0`, 'GET')).toBe(403);
  const pupil = (await s.db.doc(`students/${school}-student-${indexes[0]}`).get()).data();
  await ok(key, provision, { action: 'save-manual-student', intent: 'update', student: { ...pupil, address: 'Adresse fictive modifiée' } });
  expect((await s.db.doc(`students/${pupil.id}`).get()).data().address).toBe('Adresse fictive modifiée');
  const foreignClass = (await s.db.doc(`classes/${school}-class-${forbidden}`).get()).data();
  await denied(key, provision, { action: 'save-manual-student', intent: 'update', student: { ...pupil, classId: foreignClass.id, className: foreignClass.name, section: foreignClass.section } });
  expect((await s.db.doc(`students/${pupil.id}`).get()).data().section).toBe(pupil.section);

  const recipients = await ok(key, `/api/message-recipients?schoolYearId=${year}`);
  expect(recipients.recipients.some(row => row.uid === m.users['0-parent'].uid)).toBe(true);
  expect(recipients.recipients.some(row => row.uid === m.users['1-parent'].uid)).toBe(false);
  const send = async (sender, recipient, section) => {
    const r = await api(sender, '/api/send-school-message', { schoolYearId: year, section, subject: 'B08 fictif', body: 'Échange fictif contrôlé', draftId: randomUUID(), recipientRoles: [m.users[recipient].role], recipientIds: [m.users[recipient].uid], attachments: [] }, { 'x-idempotency-key': randomUUID() });
    expect(r.status).toBe(200); return r.body.message;
  };
  const outgoing = await send(key, '0-parent', allowed[0]);
  const incoming = await send('0-parent', key, allowed[0]);
  expect(incoming.participantIds).toContain(m.users[key].uid);
  expect(await direct(key, `messages/${incoming.id}`, 'GET')).toBe(200);
  expect(await direct('1-primary_admin', `messages/${incoming.id}`, 'GET')).toBe(403);
  const notifications = await s.db.collection('notifications').where('messageId', '==', incoming.id).get();
  expect(notifications.size).toBe(1);
  await ok(key, '/api/message-recipients', { action: 'mark-section-notifications-read', schoolYearId: year, notificationId: notifications.docs[0].id });
  expect((await notifications.docs[0].ref.get()).data().read).toBe(true);
  const otherNotifications = await s.db.collection('notifications').where('messageId', '==', outgoing.id).get();
  expect(otherNotifications.docs[0].data().read).toBe(false);
  await denied(key, '/api/message-recipients', { action: 'mark-section-notifications-read', schoolYearId: year, notificationId: otherNotifications.docs[0].id });

  // Fixture-only message file, no public token, downloaded through the deployed secured Function.
  const pdf = new jsPDF(); pdf.text('Piece jointe B08 fictive', 20, 20);
  const bytes = Buffer.from(pdf.output('arraybuffer'));
  const path = `messages/${school}/${incoming.conversationId}/${incoming.id}/fixture.pdf`;
  await s.bucket.file(path).save(bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'application/pdf', metadata: { fixtureId: m.tag } } });
  await s.db.doc(`messages/${incoming.id}`).update({ attachments: [{ path, name: 'fixture.pdf', type: 'application/pdf', size: bytes.length }] });
  const download = async who => fetch('https://europe-west1-acadea-staging.cloudfunctions.net/messageAttachmentFile', { method: 'POST', headers: { Authorization: `Bearer ${await token(who)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { messageId: incoming.id, path } }) });
  const fileResponse = await download(key);
  expect(fileResponse.status).toBe(200);
  const filePayload = await fileResponse.json();
  expect(Buffer.from((filePayload.result ?? filePayload.data).dataBase64, 'base64').equals(bytes)).toBe(true);
  expect((await download('1-primary_admin')).status).toBe(403);

  const context = await browser.newContext({ baseURL: origin });
  // Only the official Vercel header is added, and only to this exact origin. No API response mocking.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (decodeURIComponent(url.href).includes('acadea-production') || (route.request().postData() ?? '').includes('acadea-production') || url.hostname === 'acadea-app.vercel.app') return route.abort('blockedbyclient');
    if (url.origin === new URL(origin).origin) return route.continue({ headers: { ...route.request().headers(), ...protection } });
    return route.continue();
  });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await page.getByPlaceholder('email@ecole.com').fill(m.users[key].email);
    await page.getByPlaceholder('Votre mot de passe').fill(process.env.ACADEA_E2E_PASSWORD);
    await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 40000 });
    mkdirSync('test-results/section-evidence', { recursive: true });
    const capturePdf = async (button, name) => {
      await button.click();
      await expect(page.locator('[data-pdf-download]')).toHaveAttribute('aria-disabled', 'false', { timeout: 60000 });
      const pdfBytes = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector('[data-pdf-download]').href)).arrayBuffer())));
      expect(Buffer.from(pdfBytes).subarray(0, 5).toString()).toBe('%PDF-');
      writeFileSync(`test-results/section-evidence/${role}-${name}.pdf`, Buffer.from(pdfBytes));
      await page.locator('[data-pdf-close]').click();
    };
    for (const tab of ['Dashboard', 'Élèves', 'Contrôle', 'Message', 'Menu']) {
      await page.getByRole('button', { name: tab, exact: true }).last().click();
      await expect(page.getByText('Accès refusé', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Créer un utilisateur', exact: true })).toHaveCount(0);
      if (tab === 'Dashboard') await capturePdf(page.getByRole('button', { name: 'Exporter PDF', exact: true }), 'dashboard');
      if (tab === 'Élèves') {
        for (let i = 0; i < 4; i++) {
          const row = page.getByRole('row').filter({ hasText: `FICTIF0${i}` });
          if (indexes.includes(i)) await expect(row).toBeVisible(); else await expect(row).toHaveCount(0);
        }
        await capturePdf(page.getByRole('button', { name: 'Exporter PDF', exact: true }), 'students');
      }
      if (tab === 'Menu') {
        for (const title of ['Types de frais', 'Rapport financier', 'Personnels', 'Empreintes et Cartes', 'Valves']) {
          await page.getByRole('button').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).click();
          await expect(page.getByRole('button', { name: /Créer un personnel|Supprimer|Enregistrer/ })).toHaveCount(0);
          await expect(page.getByText('Accès refusé', { exact: true })).toHaveCount(0);
          if (title === 'Rapport financier') await capturePdf(page.getByRole('button', { name: 'Export PDF', exact: true }), 'financial');
          await page.screenshot({ path: `test-results/section-evidence/${role}-menu-${title}.png`, fullPage: true });
          await page.getByRole('button', { name: `Fermer ${title}`, exact: true }).click();
        }
      }
      await page.screenshot({ path: `test-results/section-evidence/${role}-${tab}.png`, fullPage: true });
    }
  } finally { await context.close(); }
});
