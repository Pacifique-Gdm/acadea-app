import { expect, test, type Page } from "@playwright/test";

type RoleCase = {
  name: string;
  prefix: string;
  expectedPath: RegExp;
  forbiddenPath: string;
  defaultPortalText: RegExp;
};

const roles: RoleCase[] = [
  { name: "Super Administrateur", prefix: "SUPER_ADMIN", expectedPath: /\/platform/, forbiddenPath: "/dashboard", defaultPortalText: /Plateforme|Écoles|Acadéa/i },
  { name: "Administrateur", prefix: "SCHOOL_ADMIN", expectedPath: /\/dashboard/, forbiddenPath: "/platform", defaultPortalText: /Dashboard|Élèves|Acadéa/i },
  { name: "Caissier", prefix: "CASHIER", expectedPath: /\/dashboard/, forbiddenPath: "/platform", defaultPortalText: /Contrôle|Paiement|Acadéa/i },
  { name: "Parent", prefix: "PARENT", expectedPath: /\/dashboard/, forbiddenPath: "/platform", defaultPortalText: /Enfant|Messages|Acadéa/i },
  { name: "Directeur de Discipline", prefix: "DISCIPLINE_DIRECTOR", expectedPath: /\/dashboard/, forbiddenPath: "/platform", defaultPortalText: /Discipline|Présence|Acadéa/i },
];

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

for (const role of roles) {
  test.describe(`connexion ${role.name}`, () => {
    const email = process.env[`E2E_${role.prefix}_EMAIL`];
    const password = process.env[`E2E_${role.prefix}_PASSWORD`];
    test.skip(!email || !password, `Secrets Staging manquants pour ${role.name}.`);

    test("connexion, portail, interdiction et persistance après actualisation", async ({ page }) => {
      await login(page, email!, password!);
      await expect(page).toHaveURL(role.expectedPath);
      await expect(page.getByText(role.defaultPortalText).first()).toBeVisible();

      await page.reload();
      await expect(page).toHaveURL(role.expectedPath);
      await expect(page.getByRole("button", { name: /Déconnexion|Se déconnecter/i }).first()).toBeVisible();

      await page.goto(role.forbiddenPath);
      if (role.prefix === "SUPER_ADMIN") await expect(page).toHaveURL(/\/platform/);
      else await expect(page).not.toHaveURL(/\/platform/);
    });
  });
}
