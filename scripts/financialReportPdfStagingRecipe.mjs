#!/usr/bin/env node
/**
 * Recette staging du PDF « Rapport Financier » (toutes les lignes, colonne Classe).
 *
 * Crée sa propre école d'essai (marque e2e-rapport-<32 hexadécimaux>), primaire et
 * secondaire, avec :
 *  - un élève du primaire, un élève du secondaire avec option et sous-classe,
 *    un ancien élève d'une année passée (année archivée) ;
 *  - 60 paiements (dont 2 de l'ancien élève) et 30 dépenses dans la période ;
 *  - un compte Administrateur d'essai.
 * Dans l'application hébergée, sur ordinateur (1440 px) puis sur téléphone (iPhone 13) :
 * Menu → Rapport financier → période → « Export PDF ». La recette garde le PDF, ses
 * pages en images et une capture de l'aperçu, et lit le contenu mis en page juste
 * avant sa conversion en image (le PDF lui-même ne contient que des images) pour
 * vérifier : 60 paiements et 30 dépenses présents, colonne « Classe » remplie,
 * lignes « Total » égales à la synthèse.
 * À la fin, tout ce que la recette a créé est effacé, puis on vérifie qu'il ne
 * reste ni école, ni document, ni compte d'essai.
 *
 * Variables : ACADEA_RAPPORT_STAGING=YES, GOOGLE_CLOUD_PROJECT=acadea-staging,
 * GOOGLE_CLOUD_QUOTA_PROJECT=acadea-staging, ACADEA_STAGING_GCLOUD_AUTH=YES,
 * ACADEA_EXPECTED_SHA=<version servie par /version.json>.
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
const root = 'diagnostics/financial-report-pdf-staging';
const output = `${root}/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const manifestPath = `${root}/manifest.json`;
const retireOnly = process.argv.includes('--step=retire');
const results = [];
const record = (name, result, detail = '') => {
  results.push({ name, result, ...(detail ? { detail } : {}) });
  console.log(`${result} : ${name}${detail ? ` — ${detail}` : ''}`);
};

function guard() {
  if (process.env.ACADEA_RAPPORT_STAGING !== 'YES' || process.env.GOOGLE_CLOUD_PROJECT !== projectId
    || process.env.GOOGLE_CLOUD_QUOTA_PROJECT !== projectId || process.env.ACADEA_STAGING_GCLOUD_AUTH !== 'YES'
    || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST
    || (!retireOnly && !/^([a-f0-9]{40}|dpl_[A-Za-z0-9]+)$/.test(process.env.ACADEA_EXPECTED_SHA ?? ''))) {
    throw Error('Recette du rapport financier réservée à acadea-staging, avec la version déployée explicite.');
  }
}

function services() {
  const getToken = stagingOAuthProvider();
  const app = initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: (await getToken()).access_token, expires_in: 90 }) } }, `rapport-${randomUUID()}`);
  const authClient = new OAuth2Client({ quotaProjectId: projectId, eagerRefreshThresholdMillis: 30000 });
  authClient.refreshHandler = getToken;
  const db = new Firestore({ projectId, preferRest: true, auth: new GoogleAuth({ projectId, authClient }) });
  const bucket = stagingRestBucket(`${projectId}.firebasestorage.app`, getToken);
  return { db, auth: getAuth(app), bucket, close: async () => { await db.terminate(); await deleteApp(app); } };
}

function validateManifest(m) {
  if (m?.projectId !== projectId || !/^e2e-rapport-[a-f0-9]{32}$/.test(m.tag) || m.school !== `${m.tag}-school`
    || !Array.isArray(m.users) || m.users.length !== 1 || m.users[0].uid !== `${m.tag}-admin`
    || m.users[0].email !== `${m.tag}-admin@example.invalid`) throw Error('Manifeste ambigu : rien n’est effacé.');
}
function saveManifest(m) {
  validateManifest(m);
  mkdirSync(root, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2), { mode: 0o600 });
}

const money = (value) => Math.round(value * 100) / 100;

async function prepare(s) {
  if (existsSync(manifestPath) && !JSON.parse(readFileSync(manifestPath, 'utf8')).retired) throw Error('Recette précédente non effacée : lancer --step=retire.');
  const tag = `e2e-rapport-${randomUUID().replaceAll('-', '')}`;
  const school = `${tag}-school`, year = `${tag}-year`, oldYear = `${tag}-oldyear`;
  const today = new Date().toISOString().slice(0, 10);
  const start = Number(today.slice(5, 7)) >= 9 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  const firstDay = new Date(Date.parse(`${today}T12:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10);
  const from = firstDay < `${start}-09-01` ? `${start}-09-01` : firstDay;
  const dayAt = (index) => {
    const span = Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000));
    return new Date(Date.parse(`${from}T12:00:00Z`) + (index % (span + 1)) * 86400000).toISOString().slice(0, 10);
  };
  const users = [{ key: 'admin', role: 'school_admin', uid: `${tag}-admin`, email: `${tag}-admin@example.invalid`, schoolId: school }];
  const documents = [];
  const add = (collection, id, data) => documents.push({ path: `${collection}/${id}`, data: { id, fixtureId: tag, ...data } });
  add('schools', school, { name: 'Complexe scolaire RAPPORT (essai)', acronym: 'CSR', status: 'active', active: true, currency: 'USD',
    address: 'Avenue fictive 2, Kinshasa', phone: '+243 000 000 000', activeSchoolYearId: year,
    schoolOptions: ['Sciences', 'Littéraire'], schoolType: 'Mixte', educationLevels: ['Primaire', 'Secondaire'], subscriptionStatus: 'active', subscriptionPlan: 'premium' });
  add('schoolYears', oldYear, { schoolId: school, name: `${start - 1}-${start}`, status: 'archived', currency: 'USD', startsAt: `${start - 1}-09-01`, endsAt: `${start}-07-31` });
  add('schoolYears', year, { schoolId: school, name: `${start}-${start + 1}`, status: 'active', currency: 'USD', startsAt: `${start}-09-01`, endsAt: `${start + 1}-07-31` });
  // Classes de l'année : 4ème Primaire ; 3ème Humanité avec la sous-classe A de l'option Sciences.
  const c4p = `${tag}-c4p`, c3h = `${tag}-c3h`, c3hA = `${tag}-c3h-a`, sciences = `${tag}-c3h::sciences`;
  add('classes', c4p, { schoolId: school, schoolYearId: year, name: '4ème Primaire', section: 'Primaire', active: true });
  add('classes', c3h, { schoolId: school, schoolYearId: year, name: '3ème Humanité', section: 'Secondaire', active: true });
  add('classes', c3hA, { schoolId: school, schoolYearId: year, name: '3ème Humanité A', section: 'Secondaire', active: true,
    parentClassId: c3h, classOptionKey: sciences, subClassLabel: 'A' });
  add('classes', `${tag}-c2h-old`, { schoolId: school, schoolYearId: oldYear, name: '2ème Humanité', section: 'Secondaire', active: true });
  const identity = { sexe: 'F', birthDate: '2012-01-01', address: 'Avenue fictive', phone: '', searchArchived: false };
  const primary = `${tag}-eleve-pri`, secondary = `${tag}-eleve-sec`, former = `${tag}-eleve-ancien`;
  add('students', primary, { ...identity, schoolId: school, schoolYearId: year, nom: 'PRIMAIRE', postnom: 'RAPPORT', prenom: 'Josué',
    matricule: `${tag.slice(-6)}-P`, className: '4ème Primaire', classId: c4p, section: 'Primaire', status: 'ACTIVE', sortName: 'primaire rapport josué' });
  add('students', secondary, { ...identity, schoolId: school, schoolYearId: year, nom: 'SECONDAIRE', postnom: 'RAPPORT', prenom: 'Grâce',
    matricule: `${tag.slice(-6)}-S`, className: '3ème Humanité', classId: c3h, subClassId: c3hA, classOptionKey: sciences, option: 'Sciences',
    section: 'Secondaire', status: 'ACTIVE', sortName: 'secondaire rapport grâce' });
  add('students', former, { ...identity, schoolId: school, schoolYearId: oldYear, nom: 'ANCIEN', postnom: 'RAPPORT', prenom: 'Élie',
    matricule: `${tag.slice(-6)}-A`, className: '2ème Humanité', option: 'Littéraire', section: 'Secondaire', status: 'TRANSFERRED',
    exitReason: 'Mutation', searchArchived: true, sortName: 'ancien rapport élie' });
  const fee = `${tag}-fee`, oldFee = `${tag}-oldfee`;
  add('feeTypes', fee, { schoolId: school, schoolYearId: year, name: 'Minerval', amount: 5000 });
  add('feeTypes', oldFee, { schoolId: school, schoolYearId: oldYear, name: 'Minerval', amount: 500 });
  const payments = [];
  for (let index = 0; index < 60; index += 1) {
    const isFormer = index >= 58;
    const studentId = isFormer ? former : index % 2 ? primary : secondary;
    const amount = money(10 + index + (index % 3) * 0.25);
    const paidAt = dayAt(index);
    const id = `${tag}-pay-${String(index).padStart(2, '0')}`;
    const receiptNumber = `RAP-${tag.slice(-4).toUpperCase()}-${String(index + 1).padStart(4, '0')}`;
    payments.push({ id, amount, receiptNumber });
    add('payments', id, { schoolId: school, schoolYearId: isFormer ? oldYear : year, studentId, feeTypeId: isFormer ? oldFee : fee,
      amount, currency: 'USD', paidAt, createdAt: `${paidAt}T10:${String(index % 60).padStart(2, '0')}:00.000Z`, updatedAt: `${paidAt}T10:00:00.000Z`,
      receiptNumber, cashierName: 'Caissier RECETTE', provenance: 'financial-api',
      ...(isFormer ? { collectionSchoolYearId: year, formerStudent: true, formerStudentId: former, debtSchoolYearName: `${start - 1}-${start}`, feeName: 'Minerval' } : {}) });
  }
  const expenses = [];
  for (let index = 0; index < 30; index += 1) {
    const id = `${tag}-dep-${String(index).padStart(2, '0')}`;
    const amount = money(5 + index * 1.5);
    const spentAt = dayAt(index);
    const description = `Dépense d'essai numéro ${index + 1}`;
    expenses.push({ id, amount, description });
    add('expenses', id, { schoolId: school, schoolYearId: year, amount, currency: 'USD', spentAt, createdAt: `${spentAt}T11:00:00.000Z`,
      category: index % 2 ? 'Fournitures' : 'Entretien', description, cashierName: 'Caissier RECETTE' });
  }
  for (const u of users) add('users', u.uid, { role: u.role, schoolId: school, name: 'Admin RECETTE-FICTIVE', email: u.email,
    active: true, status: 'active', activeSchoolYearId: year });
  const m = { projectId, tag, school, year, oldYear, from, today, users, documents: documents.map(row => row.path),
    expected: { payments, expenses }, createdAt: new Date().toISOString(), retired: false };
  for (const row of documents) if ((await s.db.doc(row.path).get()).exists) throw Error(`Collision de document ${row.path}`);
  for (const u of users) {
    try { await s.auth.getUser(u.uid); throw Error('Collision de compte.'); }
    catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
  }
  saveManifest(m); // Plan durable (sans mot de passe) avant la première écriture.
  const password = `Ephemeral-${randomUUID()}${randomUUID()}`;
  for (let start = 0; start < documents.length; start += 400) {
    const batch = s.db.batch();
    for (const row of documents.slice(start, start + 400)) batch.create(s.db.doc(row.path), row.data);
    await batch.commit();
  }
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

/** Garde le texte du document mis en page juste avant qu'il soit retiré de la page. */
async function watchPdfLayout(page) {
  await page.evaluate(() => {
    window.__rapportLayouts = [];
    new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement && node.querySelector?.('table')) {
          window.__rapportLayouts.push({
            text: node.innerText || node.textContent || '',
            tables: Array.from(node.querySelectorAll('.pdf-section, section')).map((section) => ({
              title: section.querySelector('h2')?.textContent?.trim() ?? '',
              headers: Array.from(section.querySelectorAll('thead th')).map((th) => th.textContent.trim()),
              rows: Array.from(section.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim())),
              footer: Array.from(section.querySelectorAll('tfoot tr')).map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()),
            })),
          });
        }
      }
    }).observe(document.body, { childList: true });
  });
}

async function pdfFromPreview(page, label) {
  const anchor = page.locator('[data-pdf-download]').last();
  await expect(anchor).toHaveAttribute('href', /^blob:/, { timeout: 180000 });
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
    const viewport = sheet.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await sheet.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
    writeFileSync(`${output}/${label}-page${index}.png`, canvas.toBuffer('image/png'));
  }
  return pdf.numPages;
}

async function login(context, account, password) {
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(60000);
  await page.goto(`${origin}/login`);
  await page.getByPlaceholder('email@ecole.com').fill(account.email);
  await page.getByPlaceholder('Votre mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true }).last()).toBeVisible({ timeout: 90000 });
  return page;
}

const usd = (value) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value).replace(/\s/g, ' ');
const normalize = (value) => String(value).replace(/[\s  ]+/g, ' ').trim();

function checkLayout(layout, m, device) {
  const section = (title) => layout.tables.find((table) => table.title === title);
  const payments = section('Paiements');
  const expenses = section('Dépenses');
  assert.ok(payments && expenses, `${device} : tableaux Paiements/Dépenses introuvables.`);
  assert.ok(payments.headers.includes('Classe') && !payments.headers.includes('Option'), `${device} : colonne Classe absente.`);
  const classIndex = payments.headers.indexOf('Classe');
  assert.equal(payments.rows.length, 60, `${device} : ${payments.rows.length} paiements au lieu de 60.`);
  assert.equal(expenses.rows.length, 30, `${device} : ${expenses.rows.length} dépenses au lieu de 30.`);
  for (const payment of m.expected.payments) assert.ok(payments.rows.some((row) => row.includes(payment.receiptNumber)), `${device} : reçu ${payment.receiptNumber} absent.`);
  for (const expense of m.expected.expenses) assert.ok(expenses.rows.some((row) => row.includes(expense.description)), `${device} : dépense « ${expense.description} » absente.`);
  const classes = new Map();
  for (const row of payments.rows) classes.set(row[1].split(' ')[0], new Set([...(classes.get(row[1].split(' ')[0]) ?? []), row[classIndex]]));
  assert.deepEqual([...(classes.get('SECONDAIRE') ?? [])], ['3ème Sciences A'], `${device} : classe du secondaire ${[...(classes.get('SECONDAIRE') ?? [])]}.`);
  assert.deepEqual([...(classes.get('PRIMAIRE') ?? [])], ['4ème Primaire'], `${device} : classe du primaire ${[...(classes.get('PRIMAIRE') ?? [])]}.`);
  assert.deepEqual([...(classes.get('ANCIEN') ?? [])], ['2ème Littéraire'], `${device} : classe de l'ancien élève ${[...(classes.get('ANCIEN') ?? [])]}.`);
  assert.ok(payments.rows.every((row) => row[classIndex] && row[classIndex] !== '—'), `${device} : une classe vide.`);
  const paidTotal = money(m.expected.payments.reduce((sum, item) => sum + item.amount, 0));
  const spentTotal = money(m.expected.expenses.reduce((sum, item) => sum + item.amount, 0));
  const footerPay = normalize(payments.footer.join(' '));
  const footerExp = normalize(expenses.footer.join(' '));
  assert.ok(footerPay.includes('Total des 60 paiements') && footerPay.includes(normalize(usd(paidTotal))), `${device} : total paiements « ${footerPay} » (attendu ${usd(paidTotal)}).`);
  assert.ok(footerExp.includes('Total des 30 dépenses') && footerExp.includes(normalize(usd(spentTotal))), `${device} : total dépenses « ${footerExp} » (attendu ${usd(spentTotal)}).`);
  const synthese = normalize(layout.text);
  assert.ok(synthese.includes(normalize(usd(paidTotal))) && synthese.includes(normalize(usd(spentTotal))), `${device} : totaux de la synthèse différents.`);
  return { paidTotal, spentTotal, footerPay, footerExp };
}

guard();
mkdirSync(output, { recursive: true });
const s = services();
let browser;
try {
  if (!retireOnly) {
    const version = await fetch(`${origin}/version.json`, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    assert.equal(version.status, 200, 'Staging inaccessible : aucune école d’essai créée.');
    const served = await version.json();
    assert.ok([served.version, served.deploymentId, served.sha].includes(process.env.ACADEA_EXPECTED_SHA), 'Version du staging différente : aucune école d’essai créée.');
    record('Version déployée sur le staging', 'PASS', process.env.ACADEA_EXPECTED_SHA);

    const { m, password } = await prepare(s);
    record('École, 60 paiements, 30 dépenses et compte Administrateur d’essai créés', 'PASS', m.tag);
    const account = m.users[0];
    browser = await chromium.launch({ headless: true });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const phone = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
    for (const [device, context] of [['ordinateur', desktop], ['telephone', phone]]) {
      const page = await login(context, account, password);
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      await page.getByRole('button', { name: /Rapport financier/ }).first().click();
      await expect(page.getByRole('heading', { name: 'Rapport financier' })).toBeVisible();
      await page.getByLabel('Date début').fill(m.from);
      await page.getByLabel('Date fin').fill(m.today);
      const exportButton = page.getByRole('button', { name: /Export PDF/ });
      await expect(exportButton).toBeEnabled({ timeout: 90000 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${output}/rapport-${device}-ecran.png`, fullPage: true });
      await watchPdfLayout(page);
      await exportButton.click();
      const label = `rapport-${device}`;
      const pages = await pdfFromPreview(page, label);
      await page.screenshot({ path: `${output}/${label}-apercu.png`, fullPage: false });
      const layouts = await page.evaluate(() => window.__rapportLayouts);
      writeFileSync(`${output}/${label}-mise-en-page.json`, JSON.stringify(layouts, null, 2));
      const layout = layouts.find((item) => item.tables.some((table) => table.title === 'Paiements'));
      assert.ok(layout, `${device} : mise en page du rapport non lue.`);
      const totals = checkLayout(layout, m, device);
      assert.ok(pages >= 2, `${device} : ${pages} page(s) seulement.`);
      record(`Rapport ${device} : 60 paiements, 30 dépenses, colonne Classe remplie, totaux = synthèse`, 'PASS',
        `${pages} pages ; ${totals.footerPay} ; ${totals.footerExp}`);
      const alert = page.getByRole('alert');
      if (await alert.count()) record(`Message d'erreur affiché (${device})`, 'FAIL', await alert.first().innerText());
      await page.locator('[data-pdf-close]').last().click().catch(() => undefined);
    }
    await desktop.close();
    await phone.close();
  }
} catch (error) {
  record('Recette du rapport financier', 'FAIL', String(error?.message ?? error).slice(0, 600));
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
