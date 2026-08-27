import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_SCHOOL_ADMIN_EMAIL;
const password = process.env.E2E_SCHOOL_ADMIN_PASSWORD;
const viewports = [
  { name: "320", width: 320, height: 740 },
  { name: "360", width: 360, height: 800 },
  { name: "375", width: 375, height: 812 },
  { name: "390", width: 390, height: 844 },
  { name: "412", width: 412, height: 915 },
  { name: "430", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

test.describe("responsive Administrateur", () => {
  test.skip(!email || !password, "Identifiants Administrateur Staging absents.");
  test.setTimeout(180_000);

  test("Élèves et Contrôle restent utilisables sans débordement global", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await login(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await openAdminTab(page, "Élèves");
      await expect(page.getByPlaceholder("Rechercher")).toBeVisible();
      await expect(page.getByRole("button", { name: "Exporter PDF" })).toBeVisible();
      await expectNoGlobalOverflow(page, `Élèves ${viewport.name}`);
      await expectLocalTableOverflow(page);

      await openAdminTab(page, "Contrôle");
      await expectControlToolbar(page);
      await expectNoGlobalOverflow(page, `Contrôle ${viewport.name}`);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await validateStudentsInteractions(page);
    await validateControlInteractions(page);
    expect(pageErrors).toEqual([]);
  });
});

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email!);
  await page.getByPlaceholder("Votre mot de passe").fill(password!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Élèves", exact: true }).last()).toBeVisible({ timeout: 30_000 });
}

async function openAdminTab(page: Page, name: "Élèves" | "Contrôle") {
  await page.getByRole("button", { name, exact: true }).last().click();
  if (name === "Élèves") await expect(page.getByPlaceholder("Rechercher")).toBeVisible({ timeout: 30_000 });
  else await expect(page.getByLabel("Montant payé")).toBeVisible({ timeout: 30_000 });
}

async function expectNoGlobalOverflow(page: Page, context: string) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect.soft(dimensions.documentWidth, `${context}: document`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  expect.soft(dimensions.bodyWidth, `${context}: body`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function expectLocalTableOverflow(page: Page) {
  const table = page.locator("table").first();
  if (!(await table.count())) return;
  const overflow = await table.locator("..").evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(overflow.scrollWidth).toBeGreaterThanOrEqual(overflow.clientWidth);
}

async function expectControlToolbar(page: Page) {
  await expect(page.getByLabel("Classe")).toBeVisible();
  await expect(page.getByLabel("Montant payé")).toBeVisible();
  await expect(page.getByLabel("Filtre")).toBeVisible();
  await expect(page.getByRole("button", { name: "Exporter PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réinitialiser" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Avertissement" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Historique", exact: true })).toBeVisible();
}

async function validateStudentsInteractions(page: Page) {
  await openAdminTab(page, "Élèves");
  const search = page.getByPlaceholder("Rechercher");
  await search.fill("validation responsive");
  await search.fill("");
  const filters = page.locator("section select");
  if (await filters.count()) await filters.first().selectOption({ index: 0 });

  const firstStudent = page.locator("tbody tr button").first();
  if (await firstStudent.count()) {
    await firstStudent.click();
    await expect(page).toHaveURL(/\/admin\/eleves\//);
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard/);
    await openAdminTab(page, "Élèves");
  }

  await page.getByRole("button", { name: "Exporter PDF" }).click();
  await expect(page.locator("iframe[data-pdf-frame]")).toBeVisible();
  await page.locator("button[data-pdf-close]").click();
}

async function validateControlInteractions(page: Page) {
  await openAdminTab(page, "Contrôle");
  const classSelect = page.getByLabel("Classe");
  if (await classSelect.locator("option").count() > 1) await classSelect.selectOption({ index: 1 });
  const amountSelect = page.getByLabel("Montant payé");
  if (await amountSelect.locator("option").count() > 1) await amountSelect.selectOption({ index: 1 });
  await page.getByLabel("Filtre").fill("1");
  await page.getByRole("button", { name: "Réinitialiser" }).click();

  await page.getByRole("button", { name: "Avertissement" }).click();
  const closeWarning = page.getByRole("button", { name: /Fermer l'avertissement/ });
  await expect(closeWarning).toBeVisible();
  await closeWarning.click();

  await page.getByRole("button", { name: "Historique", exact: true }).click();
  const historyDrawer = page.getByRole("dialog", { name: "Historique" });
  await expect(historyDrawer.getByLabel("Type d'historique")).toHaveValue("payments");
  await historyDrawer.getByLabel("Type d'historique").selectOption("expenses");
  await expect(historyDrawer.getByLabel("Rechercher dans l'historique des dépenses")).toBeVisible();
  await historyDrawer.getByLabel("Type d'historique").selectOption("payments");
  await expect(historyDrawer.getByPlaceholder("Rechercher par nom ou matricule")).toBeVisible();
  await page.getByRole("button", { name: /Fermer l'historique/ }).click();

  await page.getByRole("button", { name: "Exporter PDF" }).click();
  await expect(page.locator("iframe[data-pdf-frame]")).toBeVisible();
  await page.locator("button[data-pdf-close]").click();
}
