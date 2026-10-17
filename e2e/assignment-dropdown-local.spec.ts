import { expect, test } from "@playwright/test";

test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(process.env.ACADEA_E2E_BASE_URL ?? ""), "Fixture Vite locale uniquement.");

test("le sélecteur d'affectation ne couvre pas le champ suivant", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.goto("/e2e/fixtures/assignment-dropdown.html");
  await page.getByText("Classes", { exact: true }).locator("..").getByRole("button").first().click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  const inputBounds = await page.getByRole("spinbutton", { name: "Nombre de périodes hebdomadaires" }).boundingBox();
  expect(menuBounds && inputBounds && menuBounds.y + menuBounds.height <= inputBounds.y).toBeTruthy();
  await page.getByRole("spinbutton", { name: "Nombre de périodes hebdomadaires" }).fill("4");
  await expect(menu).toBeHidden();
  await expect(page.getByRole("spinbutton", { name: "Nombre de périodes hebdomadaires" })).toHaveValue("4");
});

test("sélection multiple, autre liste, clavier et mobile", async ({ page }) => {
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/fixtures/assignment-dropdown.html");
  const classesTrigger = page.getByText("Classes", { exact: true }).locator("..").getByRole("button").first();
  await classesTrigger.click();
  await page.getByRole("option", { name: "1ère" }).click();
  await page.getByRole("option", { name: "2ème" }).click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByText("Cours", { exact: true }).locator("..").getByRole("button").first().click();
  await expect(page.getByRole("option", { name: "Mathématiques" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await classesTrigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.getByRole("spinbutton", { name: "Nombre de périodes hebdomadaires" }).focus();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(classesTrigger).toContainText("1ère");
  await expect(classesTrigger).toContainText("2ème");
});
