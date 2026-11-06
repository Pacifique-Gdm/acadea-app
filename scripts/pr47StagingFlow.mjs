import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';

const ROLES = new Set(['school_admin', 'cashier', 'coordination_admin', 'sub_coordination_admin']);
const FINANCIAL_LABELS = {
  official: 'Montant officiel',
  reduction: 'Réductions et exonérations',
  expected: 'Montant net exigible',
  paid: "Frais de l'année encaissés",
  remaining: 'Montant restant à payer',
};
const CARD_LABELS = [
  "Nombre total d'élèves", 'Nombre de classes', 'Nombre total de parents',
  'Administrateurs', 'Caissiers', 'Directeurs de Discipline',
  ...Object.values(FINANCIAL_LABELS), 'Arriérés',
];
const VIEWPORTS = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440];

const normalized = (value) => String(value ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
const parseNumber = (value) => Number(normalized(value).replace(/\s/g, '').replace(',', '.'));
const amountText = (value, currency) => {
  const formatted = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  return currency === 'CDF' ? `${formatted} FC` : `$${formatted}`;
};
const refreshWarnings = (page) => page.locator('[role="alert"]').filter({ hasText: /actualis|supervision impossible/i });

function assertCards(cards, expected, currencies) {
  for (const label of CARD_LABELS) assert.ok(cards[label], `Carte absente : ${label}`);
  for (const [label, value] of Object.entries(expected.counts ?? {})) {
    assert.ok(CARD_LABELS.includes(label), `Assertion de fixture inconnue : ${label}`);
    assert.equal(parseNumber(cards[label]), value, `Compteur ${label}`);
  }
  for (const currency of currencies) {
    const money = {};
    for (const [key, label] of Object.entries(FINANCIAL_LABELS)) {
      const text = cards[label];
      const match = currency === 'CDF'
        ? text.match(/([\d\s\u00a0\u202f.,]+)\s*FC/i)
        : text.match(/\$\s*([\d\s\u00a0\u202f.,]+)/);
      assert.ok(match, `${label} sans montant ${currency} : ${text}`);
      money[key] = parseNumber(match[1]);
      assert.ok(Number.isFinite(money[key]), `${label} non numérique (${currency})`);
      if (expected.financial?.[currency]?.[key] !== undefined) {
        assert.ok(Math.abs(money[key] - expected.financial[currency][key]) < 0.011,
          `${label} ${currency} : ${money[key]} ≠ ${expected.financial[currency][key]}`);
      }
    }
    assert.ok(Math.abs(money.official - money.reduction - money.expected) < 0.011,
      `Montant officiel − réductions ≠ net exigible (${currency})`);
    assert.ok(Math.abs(money.expected - money.paid - money.remaining) < 0.011,
      `Net exigible − encaissé ≠ reste (${currency})`);
  }
}

async function readCards(dashboard) {
  const entries = await dashboard.locator('article').evaluateAll((articles) => articles.map((article) => {
    const paragraphs = [...article.querySelectorAll(':scope > p')];
    return { label: paragraphs[0]?.textContent?.trim() ?? '', value: paragraphs[1]?.textContent?.trim() ?? '' };
  }));
  return Object.fromEntries(entries.map(({ label, value }) => [normalized(label), normalized(value)]));
}

async function dashboardRoot(page) {
  let heading = page.getByRole('heading', { name: 'Dashboard', exact: true });
  if (await heading.count() === 0) {
    await page.getByRole('button', { name: 'Dashboard', exact: true }).last().click();
    heading = page.getByRole('heading', { name: 'Dashboard', exact: true });
  }
  await expect(heading).toBeVisible({ timeout: 60000 });
  const dashboard = heading.locator('xpath=ancestor::section[1]');
  await expect(dashboard.locator('article').first()).toBeVisible({ timeout: 60000 });
  await expect(dashboard.getByRole('button', { name: 'Exporter PDF', exact: true }))
    .toBeEnabled({ timeout: 90000 });
  return dashboard;
}

async function assertChart(dashboard, currencies, expected) {
  const charts = dashboard.getByRole('img', { name: 'Mouvement des paiements et dépenses par jour' });
  await expect(charts).toHaveCount(currencies.length, { timeout: 90000 });
  const chartText = normalized((await charts.allTextContents()).join(' '));
  assert.ok(chartText.length > 0, 'Axes et valeurs des graphiques absents.');
  for (const currency of currencies) {
    const paid = expected.financial?.[currency]?.paid;
    if (paid > 0) {
      assert.ok(chartText.includes(normalized(amountText(paid, currency))),
        `Paiement ${currency} absent des valeurs de graphique.`);
    }
  }
  if (currencies.includes('CDF')) {
    assert.ok(chartText.includes('0 FC') && chartText.includes('1 500 000 FC'),
      'Graduations CDF 0 / 1 500 000 FC absentes.');
  }
  await expect(dashboard.getByRole('heading', { name: 'Mouvement des transactions par jour' }).first()).toBeVisible();
  await expect(dashboard.getByRole('button', { name: "Aujourd'hui", exact: true }).first()).toBeVisible();
  await dashboard.getByRole('button', { name: 'Semaine en cours', exact: true }).first().click();
  await expect(charts.first()).toBeVisible();
  await dashboard.getByRole('button', { name: '5 derniers jours', exact: true }).first().click();
  return { count: await charts.count(), cdfAxis1500000: currencies.includes('CDF') };
}

async function assertFilters(dashboard, role, expected, baseCards, currencies) {
  const summary = {};
  const section = role === 'school_admin' || role === 'cashier'
    ? dashboard.locator('[data-testid="dashboard-date-controls"] select')
    : dashboard.getByRole('combobox', { name: 'Filtrer par section' });
  await expect(section).toBeVisible();
  const sectionValue = expected.filters?.section?.value
    ?? (await section.locator('option').evaluateAll((options) => options.find((option) => option.value !== 'all')?.value));
  if (sectionValue) {
    await section.selectOption(sectionValue);
    await section.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const filtered = await readCards(dashboard);
    assert.ok(parseNumber(filtered["Nombre total d'élèves"]) <= parseNumber(baseCards["Nombre total d'élèves"]),
      'Le filtre section augmente les effectifs.');
    assertCards(filtered, expected.filters?.section ?? {}, currencies.filter((currency) => filtered[FINANCIAL_LABELS.official].includes(currency === 'CDF' ? 'FC' : '$')));
    summary.section = sectionValue;
    if (role === 'school_admin' || role === 'cashier') {
      // This dashboard's reset button clears only the date range; restore its
      // independent section filter explicitly before comparing base totals.
      await section.selectOption('all');
    } else {
      await dashboard.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
    }
    await expect(section).toHaveValue('all');
  }
  if (role === 'coordination_admin' || role === 'sub_coordination_admin') {
    const school = dashboard.getByRole('combobox', { name: 'Filtrer par école' });
    await expect(school).toBeVisible();
    const schoolValue = expected.filters?.school?.value;
    if (schoolValue) {
      await school.selectOption(schoolValue);
      await school.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const filtered = await readCards(dashboard);
      assertCards(filtered, expected.filters.school, expected.filters.school.currencies ?? currencies);
      summary.school = schoolValue;
    }
  }
  const start = dashboard.getByLabel('Date de début');
  const end = dashboard.getByLabel('Date de fin');
  await start.fill('2020-01-01');
  await end.fill('2020-01-01');
  assert.equal(await start.inputValue(), '2020-01-01');
  assert.equal(await end.inputValue(), '2020-01-01');
  await dashboard.getByRole('button', { name: 'Réinitialiser', exact: true }).click();
  await section.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await expect(section).toHaveValue('all');
  if (role === 'coordination_admin' || role === 'sub_coordination_admin')
    await expect(dashboard.getByRole('combobox', { name: 'Filtrer par école' })).toHaveValue('');
  const resetCards = await readCards(dashboard);
  for (const label of CARD_LABELS) assert.equal(resetCards[label], baseCards[label], `Réinitialisation : ${label}`);
  return summary;
}

async function assertResponsive(page, dashboard, role, outputDir) {
  const initial = page.viewportSize();
  const sizes = [];
  try {
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }));
      assert.ok(metrics.document <= width + 2 && metrics.body <= width + 2,
        `Débordement horizontal ${width}px : document=${metrics.document}, body=${metrics.body}`);
      await expect(dashboard.getByRole('button', { name: 'Exporter PDF', exact: true })).toBeVisible();
      if (width === 320 || width === 1440)
        await page.screenshot({ path: resolve(outputDir, `${role}-dashboard-${width}.png`), fullPage: true });
      sizes.push(metrics);
    }
  } finally {
    if (initial) await page.setViewportSize(initial);
  }
  return sizes;
}

async function inspectPdf(page, dashboard, role, outputDir, expected, currencies) {
  const exportButton = dashboard.getByRole('button', { name: 'Exporter PDF', exact: true });
  await expect(exportButton).toBeEnabled({ timeout: 90000 });
  await exportButton.click();
  const download = page.locator('[data-pdf-download]');
  await expect(download).toHaveAttribute('href', /^blob:/, { timeout: 90000 });
  const bytes = Buffer.from(await page.evaluate(async () => {
    const anchor = document.querySelector('[data-pdf-download]');
    const response = await fetch(anchor.href);
    return Array.from(new Uint8Array(await response.arrayBuffer()));
  }));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'Export non PDF.');
  writeFileSync(resolve(outputDir, `${role}-dashboard.pdf`), bytes);
  const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const pdf = await loadingTask.promise;
  let worker;
  const pages = [];
  try {
    assert.ok(pdf.numPages >= 1, 'PDF sans page physique.');
    for (let number = 1; number <= pdf.numPages; number++) {
      const pagePdf = await pdf.getPage(number);
      const viewport = pagePdf.getViewport({ scale: 1.65 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await pagePdf.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < pixels.length; i += 16) {
        if (pixels[i] < 245 || pixels[i + 1] < 245 || pixels[i + 2] < 245) ink++;
      }
      assert.ok(ink > canvas.width * canvas.height * 0.0004,
        `Page physique ${number} presque blanche (${ink} pixels échantillonnés).`);
      const png = canvas.toBuffer('image/png');
      writeFileSync(resolve(outputDir, `${role}-dashboard-page-${number}.png`), png);
      let text = normalized((await pagePdf.getTextContent()).items.map((item) => item.str ?? '').join(' '));
      if (text.length < 80) {
        worker ??= await createWorker('fra', undefined, {
          langPath: resolve('node_modules/@tesseract.js-data/fra/4.0.0_best_int'),
          cacheMethod: 'none',
        });
        text = normalized((await worker.recognize(png)).data.text);
      }
      assert.ok(text.length > 40, `Page physique ${number} sans texte détectable.`);
      writeFileSync(resolve(outputDir, `${role}-dashboard-page-${number}.txt`), text);
      pages.push({ number, width: viewport.width, height: viewport.height, ink, text });
    }
    const allText = normalized(pages.map((pagePdf) => pagePdf.text).join(' '));
    assert.match(allText, /Indicateurs/i, 'Section Indicateurs absente du PDF.');
    assert.match(allText, /financi/i, 'Synthèse financière absente du PDF.');
    for (const currency of currencies) {
      assert.ok(allText.includes(currency), `Devise ${currency} absente du PDF.`);
      for (const field of ['official', 'paid']) {
        const amount = expected.financial?.[currency]?.[field];
        if (amount === undefined || amount === 0) continue;
        const digits = Math.trunc(amount).toString();
        const digitsPattern = new RegExp(digits.split('').join('[^0-9]{0,3}'));
        assert.match(allText, digitsPattern, `Montant ${field} ${currency} absent du PDF.`);
      }
    }
    for (const phrase of expected.pdfContains ?? [])
      assert.ok(allText.toLocaleLowerCase('fr').includes(normalized(phrase).toLocaleLowerCase('fr')),
        `Texte attendu absent du PDF : ${phrase}`);
    for (const phrase of expected.pdfExcludes ?? [])
      assert.ok(!allText.toLocaleLowerCase('fr').includes(normalized(phrase).toLocaleLowerCase('fr')),
        `Texte interdit présent dans le PDF : ${phrase}`);
    return { pageCount: pages.length, bytes: bytes.length, pageInk: pages.map((item) => item.ink), ocrUsed: Boolean(worker) };
  } finally {
    await worker?.terminate();
    await loadingTask.destroy();
    await page.locator('[data-pdf-close]').click().catch(() => undefined);
  }
}

async function observeStudentCount(dashboard) {
  await dashboard.evaluate((root) => {
    const read = () => {
      const card = [...root.querySelectorAll('article')]
        .find((article) => article.querySelector(':scope > p')?.textContent?.trim() === "Nombre total d'élèves");
      return card?.querySelectorAll(':scope > p')[1]?.textContent?.trim() ?? 'absent';
    };
    const seen = [read()];
    const observer = new MutationObserver(() => {
      const value = read();
      if (value !== seen.at(-1)) seen.push(value);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    root.__acadeaCountObservation = { observer, seen };
  });
  return async () => dashboard.evaluate((root) => {
    const current = root.__acadeaCountObservation;
    current.observer.disconnect();
    delete root.__acadeaCountObservation;
    return current.seen;
  });
}

async function assertRefresh(page, context, dashboard, role) {
  const button = page.getByRole('button', { name: 'Actualiser', exact: true }).first();
  await expect(button).toBeVisible();
  const before = await readCards(dashboard);
  const expectPreservedCards = (message, timeout = 20000) => expect(async () => {
    assert.deepEqual(await readCards(dashboard), before, message);
  }).toPass({ timeout, intervals: [250, 500, 1000] });
  const finishCountObservation = await observeStudentCount(dashboard);
  await button.click();
  const normalObservedBusy = await expect(button).toBeDisabled({ timeout: 3000 }).then(() => true, () => false);
  await expect(button).toBeEnabled({ timeout: 60000 });
  await expect(refreshWarnings(page)).toHaveCount(0, { timeout: 10000 });
  const seenCounts = await finishCountObservation();
  assert.deepEqual(seenCounts, [before["Nombre total d'élèves"]],
    'Actualisation normale : compteur élèves clignotant ou remis à zéro.');
  // Do not retry this assertion: a just-finished refresh must not flash zero
  // totals while root listeners re-subscribe.
  assert.deepEqual(await readCards(dashboard), before,
    'Actualisation normale : valeurs modifiées immédiatement après la fin.');

  let slowProtected = false;
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 1500, downloadThroughput: 48 * 1024, uploadThroughput: 48 * 1024,
    });
    await button.click();
    await expect(button).toBeDisabled({ timeout: 5000 });
    slowProtected = await button.isDisabled();
    assert.ok(slowProtected, 'Actualisation lente : double clic non neutralisé.');
    await expect(button).toBeEnabled({ timeout: 90000 });
    await expect(refreshWarnings(page)).toHaveCount(0, { timeout: 10000 });
    assert.deepEqual(await readCards(dashboard), before,
      'Actualisation lente : valeurs modifiées immédiatement après la fin.');
  } finally {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await cdp.detach();
  }

  let offlineWarning = false;
  try {
    await context.setOffline(true);
    await button.click();
    await expect(button).toBeEnabled({ timeout: 90000 });
    offlineWarning = await refreshWarnings(page).count() > 0;
    await expectPreservedCards('La coupure Internet a effacé ou modifié les données affichées.');
  } finally {
    await context.setOffline(false);
  }
  await button.click();
  await expect(button).toBeEnabled({ timeout: 90000 });
  await expect(refreshWarnings(page)).toHaveCount(0, { timeout: 15000 });
  await expectPreservedCards('Retour en ligne : valeurs modifiées sans écriture.');
  return { normal: true, normalObservedBusy, slow: true, concurrentClickBlocked: slowProtected,
    offlineDataPreserved: true, offlineWarningObserved: offlineWarning,
    warningClearedAfterReconnect: offlineWarning ? true : 'non applicable (aucun avertissement émis)', role };
}

/**
 * Hosted, read-only PR #47 dashboard recipe. The caller must authenticate normally
 * and verify /version.json + the staging Firebase project before calling this.
 * `expectedSummary` describes only isolated fixture data, never real school data.
 * No API response is mocked and this function performs no Staging writes.
 *
 * expectedSummary = {
 *   counts: { "Nombre total d'élèves": 4, ... },
 *   financial: { USD: { official: 600, reduction: 0, expected: 600, paid: 120, remaining: 480 },
 *                CDF: { official: 1500000, reduction: 0, expected: 1500000, paid: 500000, remaining: 1000000 } },
 *   filters: { section: { value: 'Primaire', counts: {...}, financial: {...} },
 *              school: { value: '<fictive school ID>', currencies: ['CDF'], counts: {...}, financial: {...} } },
 *   pdfContains: ['...'], pdfExcludes: ['...']
 * }
 */
export async function runPr47StagingFlow({ page, context, role, outputDir, expectedCurrencies, expectedSummary,
  runNetworkChecks = true }) {
  assert.ok(ROLES.has(role), `Profil Dashboard inconnu : ${role}`);
  assert.ok(Array.isArray(expectedCurrencies) && expectedCurrencies.length > 0
    && expectedCurrencies.every((currency) => currency === 'USD' || currency === 'CDF'), 'Devises de fixture requises.');
  assert.ok(expectedSummary?.counts && expectedSummary?.financial,
    'Attendus chiffrés de la fixture requis : aucun PASS implicite.');
  mkdirSync(outputDir, { recursive: true });
  const dashboard = await dashboardRoot(page);
  let cards;
  await expect(async () => {
    cards = await readCards(dashboard);
    assertCards(cards, expectedSummary, expectedCurrencies);
  }).toPass({ timeout: 60000, intervals: [500, 1000, 2000] });
  const chart = await assertChart(dashboard, expectedCurrencies, expectedSummary);
  const filters = await assertFilters(dashboard, role, expectedSummary, cards, expectedCurrencies);
  const responsive = await assertResponsive(page, dashboard, role, outputDir);
  const pdf = await inspectPdf(page, dashboard, role, outputDir, expectedSummary, expectedCurrencies);
  const refresh = runNetworkChecks ? await assertRefresh(page, context, dashboard, role) : { notExecuted: true };
  const result = { role, cards, chart, filters, responsive, pdf, refresh };
  writeFileSync(resolve(outputDir, `${role}-dashboard-result.json`), JSON.stringify(result, null, 2));
  return result;
}
