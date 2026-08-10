import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const accounts = [
  { role: "Administrateur", prefix: "SCHOOL_ADMIN" },
  { role: "Secrétaire", prefix: "SECRETARY" },
  { role: "Directeur de discipline", prefix: "DISCIPLINE" },
] as const;
const consoleErrors = new WeakMap<Page, string[]>();

async function login(context: BrowserContext, prefix: string) {
  const page = await context.newPage();
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(process.env[`E2E_${prefix}_EMAIL`]!);
  await page.getByPlaceholder("Votre mot de passe").fill(process.env[`E2E_${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  return page;
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /Menu/i }).last().click();
  await page.getByRole("button", { name: /Horaire publié/ }).click();
  await expect(page.getByRole("dialog", { name: "Horaire publié" })).toBeVisible({ timeout: 30_000 });
}

test.describe("publication d'horaire multi-session", () => {
  test.skip(accounts.some(({ prefix }) => !process.env[`E2E_${prefix}_EMAIL`] || !process.env[`E2E_${prefix}_PASSWORD`]), "Trois comptes Staging de la même école sont requis.");

  test("les trois rôles consultent uniquement la publication active et la conservent après actualisation", async ({ browser }) => {
    const sessions = await Promise.all(accounts.map(async ({ prefix }) => {
      const context = await browser.newContext();
      return { context, page: await login(context, prefix) };
    }));
    try {
      for (const { page } of sessions) {
        await openMenu(page);
        await expect(page.getByText("Impossible d’actualiser l’horaire publié.")).toHaveCount(0);
        await expect(page.getByText(/Version \d+|Aucun horaire publié/).first()).toBeVisible();
        await page.getByRole("button", { name: "Fermer l’horaire publié" }).click();
        await expect(page.getByRole("dialog", { name: "Horaire publié" })).toHaveCount(0);
        await page.reload();
        await openMenu(page);
        await expect(page.getByText(/Version \d+|Aucun horaire publié/).first()).toBeVisible();
        await expect(page.getByRole("button", { name: /Publier|Modifier|Valider l'horaire/i })).toHaveCount(0);
        expect(consoleErrors.get(page)).toEqual([]);
      }
    } finally {
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });

  test("le Caissier ne voit pas l'entrée réservée aux lecteurs d'horaires", async ({ browser }) => {
    test.skip(!process.env.E2E_CASHIER_EMAIL || !process.env.E2E_CASHIER_PASSWORD, "Compte Caissier Staging requis.");
    const context = await browser.newContext();
    try {
      const page = await login(context, "CASHIER");
      await page.getByRole("button", { name: /Menu/i }).last().click();
      await expect(page.getByRole("button", { name: /Horaire publié/ })).toHaveCount(0);
      expect(consoleErrors.get(page)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
