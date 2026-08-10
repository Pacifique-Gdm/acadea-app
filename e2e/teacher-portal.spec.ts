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

test.describe("Phase 3 — Espace Enseignant", () => {
  test.skip(!adminEmail || !adminPassword || !directorEmail || !directorPassword, "Comptes Administrateur et Directeur des études Staging requis.");
  test.setTimeout(360_000);

  test("provisionne un Enseignant, isole son portail et reçoit une publication sans refresh", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const directorContext = await browser.newContext();
    const teacherContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const directorPage = await directorContext.newPage();
    const teacherPage = await teacherContext.newPage();
    const errors: string[] = [];
    teacherPage.on("pageerror", (error) => errors.push(error.message));
    const suffix = String(Date.now()).slice(-7);
    const teacherName = `Validation Portail ${suffix}`;
    const password = `Phase3${suffix}`;

    try {
      await login(directorPage, directorEmail!, directorPassword!, /\/studies/);
      await directorPage.getByRole("button", { name: "Enseignants", exact: true }).last().click();

      await login(adminPage, adminEmail!, adminPassword!, /\/dashboard/);
      await adminPage.getByRole("button", { name: "Menu", exact: true }).last().click();
      await adminPage.getByRole("button", { name: /Créer un utilisateur/ }).click();
      await adminPage.getByLabel("Type d'utilisateur").selectOption("teacher");
      await adminPage.getByLabel("Nom complet").fill(teacherName);
      await adminPage.getByLabel("Téléphone").fill(`097${suffix}`);
      await adminPage.getByLabel("Mot de passe temporaire").fill(password);
      const teacherEmail = await adminPage.getByLabel("Email").inputValue();
      await adminPage.getByRole("button", { name: "Créer l'utilisateur" }).click();
      await expect(adminPage.getByText(/Compte enseignant créé avec succès/)).toBeVisible({ timeout: 30_000 });

      const teacherLink = directorPage.getByRole("button", { name: teacherName, exact: true });
      await expect(teacherLink).toBeVisible({ timeout: 30_000 });
      await teacherLink.click();
      const teacherDialog = directorPage.getByRole("dialog", { name: `Fiche pédagogique — ${teacherName}` });
      for (let index = 0; index < 2; index += 1) {
        await teacherDialog.getByRole("button", { name: "Ajouter", exact: true }).click();
        const assignmentDialog = directorPage.getByRole("dialog").last();
        const subject = await assignmentDialog.locator("select").nth(1).locator("option").nth(index + 1).getAttribute("value");
        const classroom = await assignmentDialog.locator("select").nth(2).locator("option").nth(index + 1).getAttribute("value");
        expect(subject).toBeTruthy();
        expect(classroom).toBeTruthy();
        await assignmentDialog.locator("select").nth(1).selectOption(subject!);
        await assignmentDialog.locator("select").nth(2).selectOption(classroom!);
        await assignmentDialog.getByLabel("Nombre de périodes hebdomadaires").fill("2");
        await assignmentDialog.getByRole("button", { name: "Enregistrer" }).click();
        await expect(assignmentDialog).toBeHidden({ timeout: 20_000 });
      }
      await teacherDialog.getByRole("button", { name: "Fermer la fiche pédagogique" }).click();

      await login(teacherPage, teacherEmail, password, /\/teacher/);
      await expect(teacherPage.getByRole("heading", { name: "Tableau de bord Enseignant" })).toBeVisible();
      for (const label of ["Tableau de bord", "Mes cours", "Mon horaire", "Menu"]) {
        await expect(teacherPage.getByRole("button", { name: label, exact: true })).toHaveCount(1);
      }
      await expect(teacherPage.locator('nav[aria-label="Navigation Enseignant"] button')).toHaveCount(4);

      await teacherPage.getByRole("button", { name: "Mes cours", exact: true }).click();
      await expect(teacherPage.getByRole("heading", { name: "Mes cours" })).toBeVisible();
      await expect(teacherPage.locator("main article")).toHaveCount(2);
      await expect(teacherPage.getByRole("button", { name: /Ajouter|Modifier|Supprimer|Désactiver/ })).toHaveCount(0);

      await teacherPage.getByRole("button", { name: "Mon horaire", exact: true }).click();
      await expect(teacherPage.getByRole("heading", { name: "Mon horaire" })).toBeVisible();

      await directorPage.getByRole("button", { name: "Horaires", exact: true }).last().click();
      await directorPage.getByRole("button", { name: "Générer automatiquement" }).click();
      await expect(directorPage.getByText(/Brouillon version \d+ généré/)).toBeVisible({ timeout: 60_000 });
      await directorPage.getByRole("button", { name: "Valider", exact: true }).click();
      await expect(directorPage.getByText("Horaire validé.")).toBeVisible({ timeout: 30_000 });
      await directorPage.getByRole("button", { name: "Publier", exact: true }).click();
      const confirmation = directorPage.getByRole("dialog", { name: "Publier cet horaire ?" });
      const publicationStartedAt = Date.now();
      await confirmation.getByRole("button", { name: "Publier", exact: true }).click();
      await expect(teacherPage.locator("main article").first()).toBeVisible({ timeout: 60_000 });
      console.log(`PHASE3_TEACHER_PROPAGATION_MS=${Date.now() - publicationStartedAt}`);
      await expect(teacherPage.getByRole("button", { name: /Ajouter|Modifier|Supprimer|Publier|Valider/ })).toHaveCount(0);

      await teacherPage.reload();
      await expect(teacherPage).toHaveURL(/\/teacher/);
      await expect(teacherPage.getByRole("heading", { name: "Tableau de bord Enseignant" })).toBeVisible({ timeout: 30_000 });
      await teacherPage.goto("/studies");
      await expect(teacherPage.getByText("Accès refusé")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await Promise.all([adminContext.close(), directorContext.close(), teacherContext.close()]);
    }
  });
});
