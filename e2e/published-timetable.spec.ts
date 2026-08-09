import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const accounts = [
  { role: "Administrateur", prefix: "SCHOOL_ADMIN" },
  { role: "Secrétaire", prefix: "SECRETARY" },
  { role: "Directeur de discipline", prefix: "DISCIPLINE_DIRECTOR" },
] as const;

async function login(context: BrowserContext, prefix: string) {
  const page = await context.newPage();
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(process.env[`E2E_${prefix}_EMAIL`]!);
  await page.getByPlaceholder("Votre mot de passe").fill(process.env[`E2E_${prefix}_PASSWORD`]!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  return page;
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: /Menu/i }).last().click();
  await expect(page.getByRole("heading", { name: "Horaire publié" })).toBeVisible({ timeout: 30_000 });
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
        await expect(page.getByText(/Version \d+|Aucun horaire publié/).first()).toBeVisible();
        await page.reload();
        await openMenu(page);
        await expect(page.getByText(/Version \d+|Aucun horaire publié/).first()).toBeVisible();
        await expect(page.getByRole("button", { name: /Publier|Modifier|Valider l'horaire/i })).toHaveCount(0);
      }
    } finally {
      await Promise.all(sessions.map(({ context }) => context.close()));
    }
  });
});
