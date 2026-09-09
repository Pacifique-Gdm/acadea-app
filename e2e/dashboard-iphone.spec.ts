import { expect, test, type Page } from "@playwright/test";

const roles = [
  { name: "Administrateur", email: process.env.E2E_SCHOOL_ADMIN_EMAIL, password: process.env.E2E_SCHOOL_ADMIN_PASSWORD },
  { name: "Caissier", email: process.env.E2E_CASHIER_EMAIL, password: process.env.E2E_CASHIER_PASSWORD },
] as const;
const mobileWidths = [320, 375, 390, 393, 414, 430] as const;

test.describe("Dashboard Administrateur/Caissier — champs date iPhone", () => {
  test.setTimeout(180_000);

  for (const role of roles) {
    test(`${role.name} conserve les dates dans le Dashboard à toutes les largeurs iPhone`, async ({ browser }) => {
      test.skip(!role.email || !role.password, `Identifiants ${role.name} Staging absents.`);
      const page = await browser.newPage({ deviceScaleFactor: 3, hasTouch: true, isMobile: true, locale: "fr-FR" });
      await login(page, role.email!, role.password!);

      for (const width of mobileWidths) {
        await page.setViewportSize({ width, height: 932 });
        const layout = await page.getByTestId("dashboard-date-controls").evaluate((dateControls) => {
          const controlsRect = dateControls.getBoundingClientRect();
          const fields = [...dateControls.querySelectorAll<HTMLElement>('[data-testid="dashboard-date-field"]')];
          const inputs = [...dateControls.querySelectorAll<HTMLInputElement>('input[type="date"]')];
          return {
            fields: fields.map((field) => {
              const rect = field.getBoundingClientRect();
              return { left: rect.left, right: rect.right, width: rect.width, clientWidth: field.clientWidth, scrollWidth: field.scrollWidth };
            }),
            inputs: inputs.map((input) => {
              const rect = input.getBoundingClientRect();
              const style = getComputedStyle(input);
              return { left: rect.left, right: rect.right, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight };
            }),
            controls: { left: controlsRect.left, right: controlsRect.right, clientWidth: dateControls.clientWidth, scrollWidth: dateControls.scrollWidth },
            document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
          };
        });

        expect(layout.fields).toHaveLength(2);
        expect(layout.inputs).toHaveLength(2);
        expect(layout.controls.scrollWidth).toBeLessThanOrEqual(layout.controls.clientWidth + 1);
        expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.document.clientWidth + 1);
        for (const field of layout.fields) {
          expect(field.left).toBeGreaterThanOrEqual(layout.controls.left - 1);
          expect(field.right).toBeLessThanOrEqual(layout.controls.right + 1);
          expect(field.scrollWidth).toBeLessThanOrEqual(field.clientWidth + 1);
        }
        for (const input of layout.inputs) {
          expect(input.left).toBeGreaterThanOrEqual(layout.controls.left - 1);
          expect(input.right).toBeLessThanOrEqual(layout.controls.right + 1);
          expect(input.paddingLeft).toBe("0px");
          expect(input.paddingRight).toBe("0px");
        }
      }

      await page.getByLabel("Date de début").fill("2026-01-02");
      await page.getByLabel("Date de fin").fill("2026-01-03");
      await expect(page.getByLabel("Date de début")).toHaveValue("2026-01-02");
      await expect(page.getByLabel("Date de fin")).toHaveValue("2026-01-03");
      await page.close();
    });
  }
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email);
  await page.getByPlaceholder("Votre mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
  const retry = page.getByRole("button", { name: "Réessayer" });
  if (await retry.isVisible({ timeout: 5_000 }).catch(() => false)) await retry.click();
  await expect(page.getByTestId("dashboard-date-controls")).toBeVisible({ timeout: 60_000 });
}
