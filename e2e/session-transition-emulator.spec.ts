import { expect, test, type Page } from '@playwright/test';
import { fixture } from './support/emulatorRecipe';

// P4, lot 3 (corrections 4 et 5) : la session qui change SANS appui sur « Déconnexion » nettoie l'appareil.
// Avant la correction : le billet hors ligne et les caches du compte précédent restaient sur l'appareil.

/** Nombre de billets hors ligne enregistrés sur l'appareil (0 ou 1). */
async function offlineTickets(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('acadea-offline-access-v1', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const count = database.transaction('access', 'readonly').objectStore('access').count();
      count.onsuccess = () => { database.close(); resolve(count.result); };
      count.onerror = () => { database.close(); reject(count.error); };
    };
  }));
}

const currencyKey = (uid: string) => `acadea.expenseCurrencies.v2:${uid}`;

test('Compte désactivé pendant la session (en ligne) : billet hors ligne et caches effacés', async ({ browser }) => {
  test.setTimeout(180000);
  const f = fixture();
  try {
    await f.seed(['cashier']);
    const uid = f.accounts.cashier.uid;
    const { page, context } = await f.session(browser, 'cashier', {});
    try {
      await expect.poll(() => offlineTickets(page), { timeout: 30000 }).toBe(1);
      await page.evaluate((key) => window.localStorage.setItem(key, '{"essai":"P4 lot 3"}'), currencyKey(uid));

      // Simple mise à jour du profil (même identifiant) : rien n'est vidé.
      await f.db.doc('users/' + uid).update({ name: 'Compte fictif caissier renommé' });
      await page.waitForTimeout(3000);
      expect(await offlineTickets(page)).toBe(1);
      expect(await page.evaluate((key) => window.localStorage.getItem(key), currencyKey(uid))).not.toBeNull();
      await expect(page).not.toHaveURL(/\/login/);

      // Le compte est désactivé côté serveur pendant la session : Acadéa le déconnecte tout seul.
      await f.db.doc('users/' + uid).update({ status: 'inactive', active: false });
      await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
      await expect.poll(() => offlineTickets(page), { timeout: 15000 }).toBe(0);
      await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), currencyKey(uid)), { timeout: 15000 }).toBeNull();
      await page.screenshot({ path: test.info().outputPath('compte-desactive-nettoye.png'), fullPage: true });
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});

test('Changement de compte dans un autre onglet : l\'ancien onglet repart de zéro', async ({ browser }) => {
  test.setTimeout(420000);
  const f = fixture();
  try {
    await f.seed(['cashier', 'study_director']);
    const cashier = f.accounts.cashier.uid;
    const { page, context } = await f.session(browser, 'cashier', {});
    try {
      await expect.poll(() => offlineTickets(page), { timeout: 30000 }).toBe(1);
      await page.evaluate((key) => window.localStorage.setItem(key, '{"essai":"P4 lot 3"}'), currencyKey(cashier));
      await page.evaluate(() => window.sessionStorage.setItem('acadea:essai-p4-lot3', 'onglet du caissier'));

      // Deuxième onglet du même navigateur (session Firebase partagée, encore celle du caissier) : un autre compte
      // s'y connecte DIRECTEMENT, sans passer par « déconnecté » (fonction de connexion de l'application elle-même).
      const second = await context.newPage();
      second.setDefaultTimeout(30000);
      await second.goto('/dashboard');
      const director = f.accounts.study_director;
      await second.evaluate(async ({ modulePath, email, password }) => {
        const authModule = await import(modulePath) as { signIn: (email: string, password: string) => Promise<void> };
        await authModule.signIn(email, password);
      }, { modulePath: '/src/services/auth.ts', email: director.email, password: director.password });
      await expect(second).toHaveURL(/\/studies/, { timeout: 60000 });

      // Le premier onglet suit le nouveau compte et ne garde rien du caissier.
      await expect(page).toHaveURL(/\/studies/, { timeout: 30000 });
      await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), currencyKey(cashier)), { timeout: 15000 }).toBeNull();
      await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('acadea:essai-p4-lot3')), { timeout: 15000 }).toBeNull();
      // Le directeur des études n'a pas de billet hors ligne : celui du caissier est effacé, pas remplacé.
      await expect.poll(() => offlineTickets(page), { timeout: 15000 }).toBe(0);
      await page.screenshot({ path: test.info().outputPath('changement-de-compte-onglet.png'), fullPage: true });
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});

/**
 * Fait disparaître la session Firebase de l'appareil (comme une session expirée) sans exécuter Acadéa :
 * la page /favicon.svg est sur la même origine mais ne charge pas l'application.
 */
async function dropFirebaseSession(page: Page) {
  await page.goto('/favicon.svg');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('firebaseLocalStorageDb');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Base Firebase encore ouverte.'));
  }));
}

test('Session disparue : hors ligne la reprise hors ligne marche toujours ; en ligne le billet resté est effacé', async ({ browser }) => {
  test.setTimeout(180000);
  const f = fixture();
  try {
    await f.seed(['cashier']);
    const { page, context } = await f.session(browser, 'cashier', {}, undefined, async (ctx) => {
      // « Hors ligne » simulé pour l'application seulement (le serveur de test local reste joignable).
      await ctx.addInitScript(() => {
        if (window.localStorage.getItem('essai-p4-hors-ligne') === '1') {
          Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
        }
      });
    });
    try {
      await expect.poll(() => offlineTickets(page), { timeout: 30000 }).toBe(1);

      // 1) Hors ligne, sans session Firebase : l'écran hors ligne s'ouvre et rien n'est effacé (non-régression).
      await dropFirebaseSession(page);
      await page.evaluate(() => window.localStorage.setItem('essai-p4-hors-ligne', '1'));
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { name: 'Acadéa hors connexion' })).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(3000);
      expect(await offlineTickets(page)).toBe(1);
      await page.screenshot({ path: test.info().outputPath('reprise-hors-ligne-intacte.png'), fullPage: true });

      // 2) En ligne, sans session Firebase : le billet d'une session mal fermée est effacé.
      await page.goto('/favicon.svg');
      await page.evaluate(() => window.localStorage.removeItem('essai-p4-hors-ligne'));
      await page.goto('/login');
      await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible({ timeout: 30000 });
      await expect.poll(() => offlineTickets(page), { timeout: 15000 }).toBe(0);
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});
