import { expect, test } from "@playwright/test";

const email = process.env.E2E_STUDY_DIRECTOR_EMAIL;
const password = process.env.E2E_STUDY_DIRECTOR_PASSWORD;

test.skip(!email || !password, "Identifiants E2E Directeur des études Staging absents.");
test.setTimeout(180_000);

for (const width of [390, 768, 1440]) {
  test(`Salaire/Prime reste cliquable dans le menu Directeur des études à ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(email!);
    await page.getByPlaceholder("Votre mot de passe").fill(password!);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page).toHaveURL(/\/studies/, { timeout: 60_000 });

    const menu = page.getByRole("button", { name: "Menu", exact: true }).last();
    await menu.click();
    const payroll = page.getByRole("button", { name: "Salaire/Prime", exact: true });
    const bottomNavigation = page.getByRole("navigation", { name: "Navigation Direction des études" });
    await expect(payroll).toBeVisible();
    await payroll.click({ timeout: 6_000 });
    const drawer = page.getByRole("dialog", { name: "Salaire/Prime" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/Aucun salaire ou prime enregistré|Net payé/).first()).toBeVisible({ timeout: 30_000 });
    await drawer.getByRole("button", { name: "Fermer mes salaires et primes" }).click();

    expect(await payroll.evaluate((element) => Boolean(element.closest("main")))).toBe(true);
    await payroll.scrollIntoViewIfNeeded();
    const card = await payroll.boundingBox();
    const bar = await bottomNavigation.boundingBox();
    expect(card).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(card!.y + card!.height).toBeLessThanOrEqual(bar!.y);
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    await payroll.focus();
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Fermer mes salaires et primes" }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/studies/);
    await menu.click();
    await payroll.click();
    await expect(drawer).toBeVisible();
  });
}
