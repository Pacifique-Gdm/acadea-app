import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_SCHOOL_ADMIN_EMAIL;
const adminPassword = process.env.E2E_SCHOOL_ADMIN_PASSWORD;
const directorEmail = process.env.E2E_STUDY_DIRECTOR_EMAIL;
const directorPassword = process.env.E2E_STUDY_DIRECTOR_PASSWORD;

async function login(page: Page, email: string, password: string, route: RegExp) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(route, { timeout: 60_000 });
}

test.describe("Phase 1 — intégration Enseignant", () => {
  test.skip(!adminEmail || !adminPassword || !directorEmail || !directorPassword, "Identifiants Staging requis.");
  test.setTimeout(180_000);

  test("Administrateur crée Enseignant et Direction des études le reçoit sans actualisation", async ({ browser }) => {
    const directorContext = await browser.newContext();
    const adminContext = await browser.newContext();
    const directorPage = await directorContext.newPage();
    const adminPage = await adminContext.newPage();
    const suffix = String(Date.now()).slice(-7);
    const teacherName = `Validation Enseignant ${suffix}`;
    const phone = `099${suffix}`;

    try {
      await login(directorPage, directorEmail!, directorPassword!, /\/studies/);
      await directorPage.getByRole("button", { name: "Enseignants", exact: true }).last().click();
      await expect(directorPage.getByRole("heading", { name: "Enseignants" })).toBeVisible();

      await login(adminPage, adminEmail!, adminPassword!, /\/dashboard/);
      await adminPage.getByRole("button", { name: "Menu", exact: true }).last().click();
      await adminPage.getByRole("button", { name: /Créer un utilisateur/ }).click();
      await adminPage.getByLabel("Type d'utilisateur").selectOption("teacher");
      await adminPage.getByLabel("Nom complet").fill(teacherName);
      await adminPage.getByLabel("Téléphone").fill(phone);
      const email = await adminPage.getByLabel("Email").inputValue();
      expect(email).toMatch(/^enseignant\d{3}@.+\.com$/);
      await expect(adminPage.getByLabel("Mot de passe temporaire")).toHaveValue(phone);
      await adminPage.getByRole("button", { name: "Créer l'utilisateur" }).click();
      await expect(adminPage.getByText(/Compte enseignant créé avec succès/)).toBeVisible({ timeout: 30_000 });

      const teacherLink = directorPage.getByRole("button", { name: teacherName, exact: true });
      await expect(teacherLink).toHaveCount(1, { timeout: 30_000 });
      await teacherLink.click();
      await expect(directorPage.getByText(email, { exact: true })).toBeVisible();
      await expect(directorPage.getByText(phone, { exact: true })).toBeVisible();
      await expect(directorPage.getByRole("heading", { name: `Fiche pédagogique — ${teacherName}` })).toBeVisible();
    } finally {
      await Promise.all([directorContext.close(), adminContext.close()]);
    }
  });
});
