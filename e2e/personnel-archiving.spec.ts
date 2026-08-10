import { expect, test, type Page } from "@playwright/test";

const adminEmail = process.env.E2E_SCHOOL_ADMIN_EMAIL;
const adminPassword = process.env.E2E_SCHOOL_ADMIN_PASSWORD;
const directorEmail = process.env.E2E_STUDY_DIRECTOR_EMAIL;
const directorPassword = process.env.E2E_STUDY_DIRECTOR_PASSWORD;
const cashierEmail = process.env.E2E_CASHIER_EMAIL;
const cashierPassword = process.env.E2E_CASHIER_PASSWORD;

async function login(page: Page, email: string, password: string, route: RegExp) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(route, { timeout: 60_000 });
}

async function openPersonnel(page: Page) {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Menu", exact: true }).last().click();
  await page.getByRole("button", { name: /Personnels/ }).click();
  await expect(page.getByRole("dialog", { name: "Personnels" })).toBeVisible();
}

test.describe("Phase 2 — archivage Personnels", () => {
  test.skip(!adminEmail || !adminPassword || !directorEmail || !directorPassword, "Identifiants Staging requis.");
  test.setTimeout(300_000);

  test("archive un Enseignant, bloque sa session, conserve son historique puis le réactive", async ({ browser }) => {
    const adminContext = await browser.newContext();
    const directorContext = await browser.newContext();
    const teacherContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const directorPage = await directorContext.newPage();
    const teacherPage = await teacherContext.newPage();
    const suffix = String(Date.now()).slice(-7);
    const teacherName = `Archive Enseignant ${suffix}`;
    const phone = `099${suffix}`;
    const teacherPassword = `Phase2${suffix}`;
    let archived = false;

    try {
      await login(directorPage, directorEmail!, directorPassword!, /\/studies/);
      await directorPage.getByRole("button", { name: "Enseignants", exact: true }).last().click();

      await login(adminPage, adminEmail!, adminPassword!, /\/dashboard/);
      await adminPage.getByRole("button", { name: "Menu", exact: true }).last().click();
      await adminPage.getByRole("button", { name: /Créer un utilisateur/ }).click();
      await adminPage.getByLabel("Type d'utilisateur").selectOption("teacher");
      await adminPage.getByLabel("Nom complet").fill(teacherName);
      await adminPage.getByLabel("Téléphone").fill(phone);
      await adminPage.getByLabel("Mot de passe temporaire").fill(teacherPassword);
      await expect(adminPage.getByLabel("Mot de passe temporaire")).toHaveValue(teacherPassword);
      await adminPage.getByRole("button", { name: "Créer l'utilisateur" }).click();
      await expect(adminPage.getByText(/Compte enseignant créé avec succès/)).toBeVisible({ timeout: 30_000 });
      const teacherLink = directorPage.getByRole("button", { name: teacherName, exact: true });
      await expect(teacherLink).toBeVisible({ timeout: 30_000 });
      await teacherLink.click();
      const teacherCard = directorPage.getByRole("dialog", { name: `Fiche pédagogique — ${teacherName}` });
      const teacherEmail = (await teacherCard.textContent())?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.com/i)?.[0];
      expect(teacherEmail).toBeTruthy();
      await teacherCard.getByRole("button", { name: "Fermer la fiche pédagogique" }).click();

      await login(teacherPage, teacherEmail!, teacherPassword, /\/dashboard/);
      await expect(teacherPage.getByRole("heading", { name: /Votre session reste active|Accès refusé/ })).toBeVisible();

      await openPersonnel(adminPage);
      const personnelDialog = adminPage.getByRole("dialog", { name: "Personnels" });
      await expect(personnelDialog.getByRole("button", { name: "Actifs", exact: true })).toHaveAttribute("class", /primary-button/);
      await expect(personnelDialog.getByText("Parent", { exact: true })).toHaveCount(0);
      await personnelDialog.getByRole("button", { name: teacherName, exact: true }).click();
      const teacherPersonnelCard = adminPage.getByRole("dialog", { name: `Personnel — ${teacherName}` });
      await expect(teacherPersonnelCard).toBeVisible();
      await teacherPersonnelCard.getByRole("button", { name: "Modifier", exact: true }).click();
      const editDialog = adminPage.getByRole("dialog", { name: "Modifier le personnel" });
      const updatedPhone = `098${suffix}`;
      await editDialog.getByLabel("Téléphone").fill(updatedPhone);
      await editDialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(teacherPersonnelCard.getByText(updatedPhone, { exact: true })).toBeVisible({ timeout: 20_000 });
      await teacherPersonnelCard.getByRole("button", { name: "Archiver", exact: true }).click();
      const archiveConfirmation = adminPage.getByRole("heading", { name: "Archiver ce personnel ?" }).locator("xpath=ancestor::*[@role='dialog'][1]");
      await expect(archiveConfirmation).toBeVisible();
      const archivedAt = Date.now();
      await archiveConfirmation.getByRole("button", { name: "Archiver", exact: true }).click();
      archived = true;

      await expect(directorPage.getByRole("button", { name: teacherName, exact: true })).toHaveCount(0, { timeout: 30_000 });
      console.log(`PHASE2_ARCHIVE_PROPAGATION_MS=${Date.now() - archivedAt}`);
      await expect(directorPage.getByText(/Historique des enseignants archivés/)).toBeVisible();
      await directorPage.getByText(/Historique des enseignants archivés/).click();
      await expect(directorPage.getByRole("button", { name: new RegExp(teacherName) })).toContainText("affectation(s) historique(s)");
      await expect(teacherPage).toHaveURL(/\/login/, { timeout: 30_000 });

      await teacherPage.getByPlaceholder("email@ecole.com").fill(teacherEmail!);
      await teacherPage.getByPlaceholder("Votre mot de passe").fill(teacherPassword);
      await teacherPage.getByRole("button", { name: "Se connecter" }).click();
      await expect(teacherPage.getByText(/compte.*(actif|désactivé)|plus actif/i)).toBeVisible({ timeout: 20_000 });
      await expect(teacherPage).toHaveURL(/\/login/);

      await openPersonnel(adminPage);
      const archiveList = adminPage.getByRole("dialog", { name: "Personnels" });
      await archiveList.getByRole("button", { name: "Archivés", exact: true }).click();
      await archiveList.getByRole("button", { name: teacherName, exact: true }).click();
      await adminPage.getByRole("button", { name: "Réactiver", exact: true }).click();
      await adminPage.getByRole("dialog", { name: "Réactiver ce personnel ?" }).getByRole("button", { name: "Réactiver", exact: true }).click();
      archived = false;

      await expect(directorPage.getByRole("button", { name: teacherName, exact: true })).toBeVisible({ timeout: 30_000 });
      await login(teacherPage, teacherEmail!, teacherPassword, /\/dashboard/);
      await expect(teacherPage.getByRole("heading", { name: /Votre session reste active|Accès refusé/ })).toBeVisible();
    } finally {
      if (archived) {
        await openPersonnel(adminPage).catch(() => undefined);
        const dialog = adminPage.getByRole("dialog", { name: "Personnels" });
        await dialog.getByRole("button", { name: "Archivés", exact: true }).click().catch(() => undefined);
        await dialog.getByRole("button", { name: teacherName, exact: true }).click().catch(() => undefined);
        await adminPage.getByRole("button", { name: "Réactiver", exact: true }).click().catch(() => undefined);
        await adminPage.getByRole("dialog", { name: "Réactiver ce personnel ?" }).getByRole("button", { name: "Réactiver", exact: true }).click().catch(() => undefined);
      }
      await Promise.all([adminContext.close(), directorContext.close(), teacherContext.close()]);
    }
  });

  test("archive puis réactive un Caissier dans une session déjà ouverte", async ({ browser }) => {
    test.skip(!cashierEmail || !cashierPassword, "Identifiants Caissier Staging requis.");
    const adminContext = await browser.newContext();
    const cashierContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const cashierPage = await cashierContext.newPage();
    let archived = false;

    try {
      await login(adminPage, adminEmail!, adminPassword!, /\/dashboard/);
      await login(cashierPage, cashierEmail!, cashierPassword!, /\/dashboard/);
      await openPersonnel(adminPage);
      const personnelDialog = adminPage.getByRole("dialog", { name: "Personnels" });
      const cashierRow = personnelDialog.locator("article").filter({ hasText: cashierEmail! });
      await expect(cashierRow).toBeVisible();
      await cashierRow.getByRole("button").click();
      const cashierCard = adminPage.getByRole("dialog", { name: /Personnel —/ }).last();
      await expect(cashierCard.getByText("Caissier", { exact: true })).toBeVisible();
      await cashierCard.getByRole("button", { name: "Archiver", exact: true }).click();
      await adminPage.getByRole("dialog", { name: "Archiver ce personnel ?" }).getByRole("button", { name: "Archiver", exact: true }).click();
      archived = true;

      await expect(cashierPage).toHaveURL(/\/login/, { timeout: 30_000 });
      await cashierPage.getByPlaceholder("email@ecole.com").fill(cashierEmail!);
      await cashierPage.getByPlaceholder("Votre mot de passe").fill(cashierPassword!);
      await cashierPage.getByRole("button", { name: "Se connecter" }).click();
      await expect(cashierPage.getByText(/compte.*(actif|désactivé)|plus actif/i)).toBeVisible({ timeout: 20_000 });

      await openPersonnel(adminPage);
      const archivedList = adminPage.getByRole("dialog", { name: "Personnels" });
      await archivedList.getByRole("button", { name: "Archivés", exact: true }).click();
      const archivedCashierRow = archivedList.locator("article").filter({ hasText: cashierEmail! });
      await archivedCashierRow.getByRole("button").click();
      await adminPage.getByRole("dialog", { name: /Personnel —/ }).last().getByRole("button", { name: "Réactiver", exact: true }).click();
      await adminPage.getByRole("dialog", { name: "Réactiver ce personnel ?" }).getByRole("button", { name: "Réactiver", exact: true }).click();
      archived = false;

      await login(cashierPage, cashierEmail!, cashierPassword!, /\/dashboard/);
    } finally {
      if (archived) {
        await openPersonnel(adminPage).catch(() => undefined);
        const dialog = adminPage.getByRole("dialog", { name: "Personnels" });
        await dialog.getByRole("button", { name: "Archivés", exact: true }).click().catch(() => undefined);
        const row = dialog.locator("article").filter({ hasText: cashierEmail! });
        await row.getByRole("button").click().catch(() => undefined);
        await adminPage.getByRole("dialog", { name: /Personnel —/ }).last().getByRole("button", { name: "Réactiver", exact: true }).click().catch(() => undefined);
        await adminPage.getByRole("dialog", { name: "Réactiver ce personnel ?" }).getByRole("button", { name: "Réactiver", exact: true }).click().catch(() => undefined);
      }
      await Promise.all([adminContext.close(), cashierContext.close()]);
    }
  });
});
