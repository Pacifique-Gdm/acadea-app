import { expect, test, type Page } from "@playwright/test";

const roles = [
  { name: "Administrateur", email: process.env.E2E_SCHOOL_ADMIN_EMAIL, password: process.env.E2E_SCHOOL_ADMIN_PASSWORD },
  { name: "Secrétaire", email: process.env.E2E_SECRETARY_EMAIL, password: process.env.E2E_SECRETARY_PASSWORD },
] as const;

async function expectStudentsLoaded(page: Page) {
  await expect(page.getByPlaceholder("Rechercher")).toBeVisible();
  await expect(page.getByText("Chargement des élèves…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Impossible de charger les élèves", { exact: false })).toHaveCount(0);
}

for (const role of roles) {
  test(`${role.name} charge et filtre les élèves sans index manquant`, async ({ page }) => {
    test.skip(!role.email || !role.password, `Identifiants E2E ${role.name} absents.`);
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await page.getByPlaceholder("email@ecole.com").fill(role.email!);
    await page.getByPlaceholder("Votre mot de passe").fill(role.password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
    await expectStudentsLoaded(page);

    const matricule = (await page.locator("tbody tr").first().locator("td").first().innerText()).trim();
    await page.getByPlaceholder("Rechercher").fill(matricule);
    await expectStudentsLoaded(page);
    await page.getByPlaceholder("Rechercher").fill("");

    const archiveFilter = page.locator("select").filter({ has: page.locator('option[value="archived"]') }).first();
    await archiveFilter.selectOption("active");
    await expect(page.getByText("Chargement des élèves…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Impossible de charger les élèves", { exact: false })).toHaveCount(0);
    await archiveFilter.selectOption("archived");
    await expect(page.getByText("Chargement des élèves…", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText("Impossible de charger les élèves", { exact: false })).toHaveCount(0);
    await archiveFilter.selectOption("all");
    await expectStudentsLoaded(page);

    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
    await expectStudentsLoaded(page);
    expect(pageErrors).toEqual([]);
  });
}
