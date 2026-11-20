import { expect, test } from '@playwright/test';
import { fixture } from './support/emulatorRecipe';

// P4, lot 1 : une déconnexion faite SANS RÉSEAU doit vraiment fermer la session.
// Avant la correction, le retrait du jeton de notifications attendait Firestore sans fin :
// `signOut` n'était jamais appelé et, au rechargement, le compte précédent revenait tout seul.
test('Déconnexion sans réseau : au rechargement, la page de connexion reste affichée', async ({ browser }) => {
  test.setTimeout(180000);
  const f = fixture();
  try {
    await f.seed(['cashier']);
    const { page, context } = await f.session(browser, 'cashier', {});
    try {
      // Appareil qui a activé les notifications : le retrait du jeton sera tenté à la déconnexion.
      await page.evaluate(() => window.localStorage.setItem('acadea:push-device-id', 'appareil-essai-p4'));
      await page.getByRole('button', { name: 'Menu', exact: true }).last().click();
      const logout = page.getByRole('button', { name: 'Déconnexion', exact: true });
      await expect(logout).toBeVisible();
      await context.setOffline(true);
      await logout.click();
      await expect(page).toHaveURL(/\/login/);
      // Laisse passer le délai maximum du retrait du jeton (3 s), puis revient en ligne et recharge.
      await page.waitForTimeout(4500);
      await context.setOffline(false);
      await page.reload();
      await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible({ timeout: 30000 });
      // Le compte précédent ne doit pas revenir tout seul.
      await page.waitForTimeout(5000);
      await expect(page).toHaveURL(/\/login/);
      await expect(page.getByPlaceholder('email@ecole.com')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('deconnexion-sans-reseau.png'), fullPage: true });
    } finally { await context.close(); }
  } finally { await f.cleanup(); }
});
