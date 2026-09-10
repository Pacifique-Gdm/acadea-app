import { expect, test, type Page } from "@playwright/test";
import type { SchoolLevelChoice } from "../src/utils/schoolConfig";

const email = process.env.E2E_SUPER_ADMIN_EMAIL;
const password = process.env.E2E_SUPER_ADMIN_PASSWORD;
const confirmation = "MODIFIER INFORMATIONS ÉCOLE";

test.skip(!email || !password, "Identifiants Super Administrateur Staging manquants.");
test.setTimeout(180_000);

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email!);
  await page.getByPlaceholder("Votre mot de passe").fill(password!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/platform/, { timeout: 60_000 });
}

async function openFirstSchool(page: Page) {
  await page.getByRole("button", { name: "Écoles", exact: true }).click();
  const card = page.locator("article").first();
  const schoolButton = card.getByRole("button");
  const schoolName = (await schoolButton.textContent())?.trim() ?? "";
  expect(schoolName).not.toBe("");
  await schoolButton.click();
  await page.getByRole("button", { name: "Informations", exact: true }).click();
  return schoolName;
}

async function currentIdToken(page: Page) {
  return page.evaluate(async () => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open("firebaseLocalStorageDb");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("firebaseLocalStorage", "readonly");
      const values = transaction.objectStore("firebaseLocalStorage").getAll();
      values.onerror = () => reject(values.error);
      values.onsuccess = () => {
        const token = values.result
          .map((entry) => entry?.value?.stsTokenManager?.accessToken)
          .find((value) => typeof value === "string");
        database.close();
        if (token) resolve(token);
        else reject(new Error("Jeton Staging Firebase introuvable."));
      };
    };
  }));
}

test("modifie puis restaure atomiquement les informations, la devise institutionnelle et le logo", async ({ page, baseURL }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await login(page);
  const schoolName = await openFirstSchool(page);

  await expect(page.getByText("Devise", { exact: true }).first()).toBeVisible();
  const annualCurrency = await page.getByLabel("Devise monétaire de l'année active").inputValue();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  let drawer = page.getByRole("dialog", { name: "Modifier les informations de l'école" });
  await expect(drawer).toBeVisible();

  const originalLogo = drawer.locator("img").first();
  const original = {
    name: await drawer.getByLabel("Nom de l'école").inputValue(),
    address: await drawer.getByLabel("Adresse").inputValue(),
    phone: await drawer.getByLabel("Téléphone").inputValue(),
    email: await drawer.getByLabel("Email").inputValue(),
    motto: await drawer.getByLabel("Devise", { exact: true }).inputValue(),
    logoUrl: await originalLogo.count() ? await originalLogo.getAttribute("src") ?? "" : "",
    level: await drawer.getByLabel("Niveau de l'école").inputValue() as SchoolLevelChoice,
  };
  expect(original.name).toBe(schoolName);

  const save = drawer.getByRole("button", { name: "Enregistrer", exact: true });
  await drawer.getByLabel(/Saisissez exactement/).fill("modifier informations école");
  await expect(save).toBeDisabled();

  await drawer.locator('input[type="file"]').setInputFiles({ name: "interdit.txt", mimeType: "text/plain", buffer: Buffer.from("interdit") });
  await expect(drawer.getByText(/Format non pris en charge/)).toBeVisible();
  await drawer.getByLabel(/Saisissez exactement/).fill(confirmation);
  await expect(save).toBeDisabled();
  await drawer.getByRole("button", { name: "Annuler", exact: true }).click();

  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  drawer = page.getByRole("dialog", { name: "Modifier les informations de l'école" });
  await expect(drawer.getByLabel("Devise", { exact: true })).toHaveValue(original.motto);

  const marker = `Devise E2E ${Date.now()}`;
  await drawer.getByLabel("Devise", { exact: true }).fill(marker);
  await drawer.locator('input[type="file"]').setInputFiles("public/acadea-icon.png");
  await expect(drawer.locator('img[src^="data:image/webp;base64,"]')).toBeVisible();
  await drawer.getByLabel(/Saisissez exactement/).fill(confirmation);

  let schoolId = "";
  try {
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/manage-school") && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const payload = await response.json() as { school?: { id?: string } };
    schoolId = payload.school?.id ?? "";
    expect(schoolId).not.toBe("");

    const success = page.getByText("Informations de l'école enregistrées avec succès.");
    await expect(success).toBeVisible();
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Devise monétaire de l'année active")).toHaveValue(annualCurrency);

    await page.reload();
    await expect(page).toHaveURL(/\/platform/);
    await openFirstSchool(page);
    await expect(page.getByText(marker, { exact: true })).toBeVisible();
  } finally {
    if (schoolId) {
      const token = await currentIdToken(page);
      const restore = await page.request.post(new URL("/api/manage-school", baseURL).toString(), {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          action: "update",
          schoolId,
          confirmation,
          patch: {
            name: original.name,
            address: original.address,
            phone: original.phone,
            email: original.email,
            motto: original.motto,
            logoUrl: original.logoUrl,
          },
        },
      });
      expect(restore.status()).toBe(200);
    }
  }

  await page.reload();
  await openFirstSchool(page);
  await expect(page.getByText(original.motto || "-", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("Devise monétaire de l'année active")).toHaveValue(annualCurrency);
  expect(consoleErrors).toEqual([]);
});

test("le Drawer reste contenu et utilisable sur toutes les largeurs demandées", async ({ page }) => {
  await login(page);
  await openFirstSchool(page);
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Modifier les informations de l'école" });

  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    const box = await drawer.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    const overflows = await drawer.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflows).toBe(false);
    await expect(drawer.getByRole("button", { name: "Annuler", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Enregistrer", exact: true })).toBeVisible();
  }
});
