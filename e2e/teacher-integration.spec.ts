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
  test.setTimeout(300_000);

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
      const createButton = adminPage.getByRole("button", { name: "Créer l'utilisateur" });
      await expect(createButton).toBeEnabled();
      const email = await adminPage.getByLabel("Email").inputValue();
      expect(email).toMatch(/^enseignant\d{3}@.+\.com$/);
      await expect(adminPage.getByLabel("Mot de passe temporaire")).toHaveValue(phone);
      const creationStartedAt = Date.now();
      await createButton.click();
      await expect(adminPage.getByText(/Compte enseignant créé avec succès/)).toBeVisible({ timeout: 30_000 });

      const teacherLink = directorPage.getByRole("button", { name: teacherName, exact: true });
      await expect(teacherLink).toHaveCount(1, { timeout: 30_000 });
      console.log(`PHASE1_PROPAGATION_MS=${Date.now() - creationStartedAt}`);
      await teacherLink.click();
      const teacherDialog = directorPage.getByRole("dialog", { name: `Fiche pédagogique — ${teacherName}` });
      await expect(teacherDialog).toContainText(email);
      await expect(teacherDialog).toContainText(phone);
      await expect(teacherDialog.getByRole("heading", { name: `Fiche pédagogique — ${teacherName}` })).toBeVisible();

      await teacherDialog.getByRole("button", { name: "Ajouter", exact: true }).click();
      let assignmentDialog = directorPage.getByRole("dialog").last();
      await expect(assignmentDialog.getByRole("heading", { name: "Ajouter une affectation" })).toBeVisible();
      const firstSubject = await assignmentDialog.locator("select").nth(1).locator("option").nth(1).getAttribute("value");
      const firstClass = await assignmentDialog.locator("select").nth(2).locator("option").nth(1).getAttribute("value");
      expect(firstSubject).toBeTruthy();
      expect(firstClass).toBeTruthy();
      await assignmentDialog.locator("select").nth(1).selectOption(firstSubject!);
      await assignmentDialog.locator("select").nth(2).selectOption(firstClass!);
      await assignmentDialog.getByLabel("Nombre de périodes hebdomadaires").fill("2");
      await assignmentDialog.getByRole("button", { name: "Enregistrer" }).click();
      await expect(directorPage.getByRole("heading", { name: "Ajouter une affectation" })).toBeHidden({ timeout: 20_000 });

      await teacherDialog.getByRole("button", { name: "Ajouter", exact: true }).click();
      assignmentDialog = directorPage.getByRole("dialog").last();
      await expect(assignmentDialog.getByRole("heading", { name: "Ajouter une affectation" })).toBeVisible();
      const secondSubjectName = `Matière Phase 1 ${suffix}`;
      await assignmentDialog.getByLabel("Nouvelle matière").fill(secondSubjectName);
      await assignmentDialog.getByRole("button", { name: "Ajouter la matière" }).click();
      await expect(assignmentDialog.locator("select").nth(1).locator("option", { hasText: secondSubjectName })).toHaveCount(1);
      const secondClass = await assignmentDialog.locator("select").nth(2).locator("option").nth(2).getAttribute("value");
      expect(secondClass).toBeTruthy();
      await assignmentDialog.locator("select").nth(1).selectOption({ label: secondSubjectName });
      await assignmentDialog.locator("select").nth(2).selectOption(secondClass!);
      await assignmentDialog.getByLabel("Nombre de périodes hebdomadaires").fill("2");
      await assignmentDialog.getByRole("button", { name: "Enregistrer" }).click();
      await expect(directorPage.getByRole("heading", { name: "Ajouter une affectation" })).toBeHidden({ timeout: 20_000 });
      await expect(teacherDialog.locator("article")).toHaveCount(2);

      await teacherDialog.getByRole("button", { name: "Configurer" }).click();
      const availabilityHeading = directorPage.getByRole("heading", { name: `Configurer les disponibilités — ${teacherName}` });
      await expect(availabilityHeading).toBeVisible();
      const availabilityDialog = availabilityHeading.locator("xpath=ancestor::*[@role='dialog'][1]");
      await availabilityDialog.locator("select").nth(1).selectOption("rest");
      const availabilitySave = directorPage.getByRole("button", { name: "Enregistrer", exact: true });
      await expect(availabilitySave).toBeEnabled();
      await availabilitySave.click();
      await expect(directorPage.getByRole("heading", { name: `Configurer les disponibilités — ${teacherName}` })).toBeHidden({ timeout: 20_000 });
      await expect(teacherDialog).toContainText("Repos");
    } finally {
      await Promise.all([directorContext.close(), adminContext.close()]);
    }
  });
});
