import { expect, test, type Page } from "@playwright/test";

const roles = [
  { name: "Administrateur", email: process.env.E2E_SCHOOL_ADMIN_EMAIL, password: process.env.E2E_SCHOOL_ADMIN_PASSWORD },
  { name: "Secrétaire", email: process.env.E2E_SECRETARY_EMAIL, password: process.env.E2E_SECRETARY_PASSWORD },
] as const;

test.describe("création rapide d'un Parent depuis un élève", () => {
  test.setTimeout(180_000);

  for (const role of roles) {
    test(`${role.name} prépare le Parent, sauvegarde l'élève et conserve la liaison après F5`, async ({ page }) => {
      test.skip(!role.email || !role.password, `Identifiants ${role.name} Staging absents.`);
      const suffix = String(Date.now()).slice(-7);
      const studentLastName = `ParentRapide${suffix}`;
      const studentFirstName = role.name === "Administrateur" ? "Admin" : "Secretaire";
      const parentName = `Parent E2E ${suffix}`;
      const parentPhone = `097${suffix}`;

      await login(page, role.email!, role.password!);
      await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
      await page.getByRole("button", { name: "Ajouter un élève", exact: true }).click();

      const drawer = page.getByRole("dialog", { name: "Ajouter un élève" });
      await drawer.getByLabel("Nom", { exact: true }).fill(studentLastName);
      await drawer.getByLabel("Prénom", { exact: true }).fill(studentFirstName);
      await drawer.getByPlaceholder("Nom complet").fill(parentName);
      await drawer.getByPlaceholder("Téléphone").fill(parentPhone);
      await expect(drawer.getByLabel("Mot de passe temporaire")).toHaveValue(parentPhone);

      const generatedEmail = await drawer.getByPlaceholder("Email").inputValue();
      expect(generatedEmail).toMatch(/@/);
      await drawer.getByRole("button", { name: "Créer et sélectionner" }).click();

      await expect(drawer.getByRole("status")).toHaveText("Parent prêt et sélectionné. Il sera créé lors de l’enregistrement de l’élève.");
      await expect(drawer.getByPlaceholder("Nom complet")).toHaveValue("");
      await expect(drawer.getByPlaceholder("Téléphone")).toHaveValue("");
      await expect(drawer.getByLabel("Mot de passe temporaire")).toHaveValue("");
      await expect(drawer.locator("option:checked").filter({ hasText: `${parentName} - ${parentPhone} (création en attente)` })).toHaveCount(1);

      await drawer.getByRole("button", { name: "Sauver", exact: true }).click();
      await expect(page.getByText("Élève et compte parent enregistrés avec succès.", { exact: true })).toBeVisible({ timeout: 60_000 });

      await page.reload();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
      await page.getByRole("button", { name: "Élèves", exact: true }).last().click();
      await page.getByPlaceholder("Rechercher").fill(studentLastName);
      const row = page.locator("tbody tr").filter({ hasText: studentLastName });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(parentPhone);
    });
  }
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
}
