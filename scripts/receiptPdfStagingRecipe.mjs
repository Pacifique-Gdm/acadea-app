#!/usr/bin/env node
/**
 * Recette staging du reçu de paiement (description, signature, en-tête).
 *
 * Crée sa propre école d'essai (marque e2e-recu-<32 hexadécimaux>), SANS image de
 * logo et avec un sigle long accentué (« GSAGAPÉ », cas du « E » qui débordait
 * sous le carré du bandeau), et un compte Caissier d'essai, puis, dans
 * l'application hébergée :
 *  - enregistre trois paiements par le vrai formulaire : description vide,
 *    courte et longue (1000 caractères) ;
 *  - ouvre chaque reçu sur ordinateur (1440 px) et sur téléphone (390 px),
 *    garde le PDF, ses pages en images et une capture de l'aperçu ;
 *  - vérifie que chaque reçu tient sur une seule page.
 * À la fin, tout ce que la recette a créé est effacé, puis on vérifie qu'il ne
 * reste ni école, ni document, ni compte d'essai.
 *
 * Variables : ACADEA_RECU_STAGING=YES, GOOGLE_CLOUD_PROJECT=acadea-staging,
 * GOOGLE_CLOUD_QUOTA_PROJECT=acadea-staging, ACADEA_STAGING_GCLOUD_AUTH=YES,
 * ACADEA_EXPECTED_SHA=<sha déployé sur le staging>.
 * Option : --step=retire (effacer seulement une recette interrompue).
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth, OAuth2Client } from 'google-auth-library';
import { chromium, devices, expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { stagingOAuthProvider } from './stagingOAuth.mjs';
import { fixtureLeftovers, purgeStagingFixture, stagingRestBucket } from './stagingFixturePurge.mjs';

const projectId = 'acadea-staging';
const origin = 'https://acadea-staging.vercel.app';
const output = `diagnostics/receipt-pdf-staging/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const manifestPath = 'diagnostics/receipt-pdf-staging/manifest.json';
const retireOnly = process.argv.includes('--step=retire');
const results = [];
const logoInk = {};
const record = (name, result, detail = '') => {
  results.push({ name, result, ...(detail ? { detail } : {}) });
  console.log(`${result} : ${name}${detail ? ` — ${detail}` : ''}`);
};

function guard() {
  if (process.env.ACADEA_RECU_STAGING !== 'YES' || process.env.GOOGLE_CLOUD_PROJECT !== projectId
    || process.env.GOOGLE_CLOUD_QUOTA_PROJECT !== projectId || process.env.ACADEA_STAGING_GCLOUD_AUTH !== 'YES'
    || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
    || (!retireOnly && !/^([a-f0-9]{40}|dpl_[A-Za-z0-9]+)$/.test(process.env.ACADEA_EXPECTED_SHA ?? ''))) {
    throw Error('Recette du reçu réservée à acadea-staging, avec le SHA déployé explicite.');
  }
}

function services() {
  const getToken = stagingOAuthProvider();
  const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: (await getToken()).access_token, expires_in: 90 }) } }, `recu-${randomUUID()}`);
  const authClient = new OAuth2Client({ quotaProjectId: projectId, eagerRefreshThresholdMillis: 30000 });
  authClient.refreshHandler = getToken;
  const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
  const bucket = stagingRestBucket(`${projectId}.firebasestorage.app`, getToken);
  return { db, auth: getAuth(app), bucket, close: async () => { await db.terminate(); await deleteApp(app); } };
}

function validateManifest(m) {
  if (m?.projectId !== projectId || !/^e2e-recu-[a-f0-9]{32}$/.test(m.tag) || m.school !== `${m.tag}-school`
    || !Array.isArray(m.users) || m.users.length !== 1 || m.users[0].uid !== `${m.tag}-cashier`
    || m.users[0].email !== `${m.tag}-cashier@example.invalid`) throw Error('Manifeste ambigu : rien n’est effacé.');
}
function saveManifest(m) {
  validateManifest(m);
  mkdirSync('diagnostics/receipt-pdf-staging', { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 });
}

async function prepare(s) {
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Recette précédente non effacée : lancer --step=retire.');
  const tag = `e2e-recu-${randomUUID().replaceAll('-', '')}`;
  const school = `${tag}-school`, year = `${tag}-year`, student = `${tag}-student`, fee = `${tag}-fee`;
  const today = new Date().toISOString().slice(0, 10);
  const start = Number(today.slice(5, 7)) >= 9 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const users = [{ key: 'cashier', role: 'cashier', uid: `${tag}-cashier`, email: `${tag}-cashier@example.invalid`, schoolId: school }];
  const documents = [];
  const add = (collection, id, data) => documents.push({ path: `${collection}/${id}`, data: { id, fixtureId: tag, ...data } });
  add('schools', school, { name: 'G.S AGAPÉ (essai reçu)', acronym: 'GSAGAPÉ', status: 'active', active: true, currency: 'USD',
    address: 'Avenue fictive 1, Kinshasa', phone: '+243 000 000 000', activeSchoolYearId: year,
    schoolOptions: [], schoolType: 'Primaire uniquement', educationLevels: ['Primaire'], subscriptionStatus: 'active', subscriptionPlan: 'premium' });
  add('schoolYears', year, { schoolId: school, name: `${start}-${start + 1}`, status: 'active', currency: 'USD', startsAt: `${start}-09-01`, endsAt: `${start + 1}-07-31` });
  add('classes', `${tag}-class`, { schoolId: school, schoolYearId: year, name: '1ère Primaire', section: 'Primaire', active: true });
  add('students', student, { schoolId: school, schoolYearId: year, nom: 'RECUFICTIF', postnom: 'RECETTE', prenom: 'Grâce',
    matricule: `${tag.slice(-6)}-M`, className: '1ère Primaire', section: 'Primaire', status: 'ACTIVE', sexe: 'F', birthDate: '2016-01-01',
    sortName: 'recufictif recette grâce', searchArchived: false });
  add('feeTypes', fee, { schoolId: school, schoolYearId: year, name: 'Minerval', amount: 300, className: '1ère Primaire' });
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: school, name: 'Josée RECETTE-FICTIVE', email: u.email,
    active: true, status: 'active', activeSchoolYearId: year });
  const m = { projectId, tag, school, year, student, fee, today, users, documents: documents.map(row => row.path), createdAt: new Date().toISOString(), retired: false };
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error(`Collision de document ${row.path}`);
  for (const u of users) {
    try { await s.auth.getUser(u.uid); throw Error('Collision de compte.'); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }
  saveManifest(m); // Plan durable (sans mot de passe) avant la première écriture.
  const password = `Ephemeral-${randomUUID()}${randomUUID()}`;
  for (const row of documents) await s.db.doc(row.path).create(row.data);
  for (const u of users) {
    await s.auth.createUser({ uid: u.uid, email: u.email, password });
    await s.auth.setCustomUserClaims(u.uid, { role: u.role, schoolId: u.schoolId });
  }
  return { m, password };
}

async function retire(s) {
  if (!existsSync(manifestPath)) return;
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  validateManifest(m);
  if (m.retired) return;
  const schoolDoc = await s.db.doc(`schools/${m.school}`).get();
  if (schoolDoc.exists && schoolDoc.data().fixtureId !== m.tag) throw Error('École étrangère : rien n’est effacé.');
  await purgeStagingFixture({ db: s.db, auth: s.auth, bucket: s.bucket, projectId, tag: m.tag, extraUids: m.users.map(u => u.uid), knownSchoolIds: [m.school] });
  for (const path of m.documents) if ((await s.db.doc(path).get()).exists) await s.db.doc(path).delete();
  const leftovers = await fixtureLeftovers(s.db, m.tag, [m.school]);
  if (leftovers.length) throw Error('Effacement incomplet : ' + leftovers.join(', '));
  for (const u of m.users) {
    try { await s.auth.getUser(u.uid); throw Error(`Compte d'essai encore présent : ${u.uid}`); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }
  m.retired = true; m.deleted = true; m.closedAt = new Date().toISOString(); saveManifest(m);
}

async function pdfFromPreview(page, label) {
  const anchor = page.locator('[data-pdf-download]').last();
  await expect(anchor).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
  const values = await page.evaluate(async () => {
    const links = document.querySelectorAll('[data-pdf-download]');
    return Array.from(new Uint8Array(await (await fetch(links[links.length - 1].href)).arrayBuffer()));
  });
  const bytes = Buffer.from(values);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', `PDF ${label} invalide.`);
  writeFileSync(`${output}/${label}.pdf`, bytes);
  const pdf = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const sheet = await pdf.getPage(index);
    const viewport = sheet.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await sheet.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
    writeFileSync(`${output}/${label}-page${index}.png`, canvas.toBuffer('image/png'));
    if (index === 1) {
      // École sans image de logo : les lettres du sigle doivent être dessinées dans le carré (deux exemplaires).
      const context = canvas.getContext('2d');
      const ink = [0.052, 0.503].map((top) => {
        const pixels = context.getImageData(Math.round(canvas.width * 0.09), Math.round(canvas.height * top),
          Math.round(canvas.width * 0.035), Math.round(canvas.height * 0.026)).data;
        let count = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 160 && pixels[offset + 1] < 160) count += 1;
        return count;
      });
      assert.ok(ink.every((value) => value >= 40), `${label} : lettres du logo de secours absentes ou rognées (${ink.join(' / ')}).`);
      logoInk[label] = ink;
    }
  }
  return pdf.numPages;
}

async function login(context, account, password) {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);
  await page.goto(`${origin}/login`);
  await page.getByPlaceholder('email@ecole.com').fill(account.email);
  await page.getByPlaceholder('Votre mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true }).last()).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Contrôle', exact: true }).last().click();
  return page;
}

const notes = {
  vide: '',
  courte: 'Tranche 2 – septembre',
  longue: ('Paiement de la deuxième tranche des frais scolaires, versé par l’oncle de l’élève au guichet, '
    + 'avec un reliquat à régler au prochain trimestre selon l’accord passé avec la direction. ').repeat(6).slice(0, 1000),
};

guard();
mkdirSync(output, { recursive: true });
const s = services();
let browser;
try {
  if (!retireOnly) {
    const version = await fetch(`${origin}/version.json`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(version.status, 200, 'Staging inaccessible : aucune école d’essai créée.');
    assert.equal((await version.json()).version, process.env.ACADEA_EXPECTED_SHA, 'SHA du staging différent : aucune école d’essai créée.');
    record('Version déployée sur le staging', 'PASS', process.env.ACADEA_EXPECTED_SHA);

    const { m, password } = await prepare(s);
    record('École et compte Caissier d’essai créés', 'PASS', m.tag);
    const account = m.users[0];
    browser = await chromium.launch({ headless: true });

    // 1. Trois paiements par le vrai formulaire du Caissier (ordinateur).
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    let page = await login(desktop, account, password);
    for (const [index, [kind, note]] of Object.entries(notes).entries()) {
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).first().click();
      await page.getByPlaceholder('Rechercher par nom, postnom, prénom ou matricule').fill('RECUFICTIF');
      await page.getByRole('button', { name: /RECUFICTIF RECETTE Grâce/ }).first().click();
      await page.getByLabel('Type de frais').selectOption(m.fee);
      await page.getByPlaceholder('Montant').fill(String(10 * (index + 1)));
      await page.getByPlaceholder('Description du paiement (facultatif)').fill(note);
      await page.getByRole('button', { name: 'Enregistrer', exact: true }).last().click();
      await expect.poll(async () => (await s.db.collection('payments').where('schoolId', '==', m.school).get()).size,
        { timeout: 60000 }).toBe(index + 1);
      const close = page.getByRole('button', { name: /^Fermer / }).last();
      if (await close.isVisible().catch(() => false)) await close.click();
      record(`Paiement avec description ${kind}`, 'PASS');
    }
    const saved = (await s.db.collection('payments').where('schoolId', '==', m.school).get()).docs.map(doc => doc.data());
    for (const note of Object.values(notes)) {
      assert.ok(saved.some(payment => (payment.note ?? '') === note), `Description non enregistrée : « ${note.slice(0, 30)} ».`);
    }
    record('Descriptions enregistrées telles que saisies', 'PASS');

    // 2. Les reçus, sur ordinateur puis sur téléphone.
    const phone = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    for (const [device, context] of [['ordinateur', desktop], ['telephone', phone]]) {
      if (device === 'telephone') page = await login(context, account, password);
      await page.getByRole('button', { name: 'Historique', exact: true }).first().click();
      const buttons = page.getByTitle('Voir le reçu PDF');
      await expect(buttons).toHaveCount(3, { timeout: 60000 });
      // Historique du plus récent au plus ancien : longue, courte, vide.
      for (const [position, kind] of ['longue', 'courte', 'vide'].entries()) {
        await buttons.nth(position).click();
        const label = `recu-${device}-description-${kind}`;
        const pages = await pdfFromPreview(page, label);
        await page.screenshot({ path: `${output}/${label}-apercu.png`, fullPage: false });
        assert.equal(pages, 1, `${label} : ${pages} pages au lieu d’une seule.`);
        record(`Reçu ${device}, description ${kind} : une seule page, sigle dessiné dans le carré`, 'PASS', `encre ${logoInk[label].join(" / ")}`);
        await page.locator('[data-pdf-close]').last().click();
      }
    }
    await desktop.close();
    await phone.close();
  }
} catch (error) {
  record('Recette du reçu', 'FAIL', String(error?.message ?? error).slice(0, 500));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try {
    await retire(s);
    record('Effacement complet : aucune école, aucun document, aucun compte d’essai restant', 'PASS');
  } catch (error) {
    record('Effacement complet', 'FAIL', String(error?.message ?? error).slice(0, 500));
    process.exitCode = 1;
  }
  await s.close();
  writeFileSync(`${output}/resultats.json`, JSON.stringify({ sha: process.env.ACADEA_EXPECTED_SHA, results }, null, 2));
}
