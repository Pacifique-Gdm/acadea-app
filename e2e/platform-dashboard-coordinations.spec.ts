import { expect, test, type Locator, type Page } from "@playwright/test";

const email = process.env.E2E_SUPER_ADMIN_EMAIL;
const password = process.env.E2E_SUPER_ADMIN_PASSWORD;
const stagingProjectId = "acadea-staging";

test.skip(!email || !password, "Identifiants Super Administrateur Staging manquants.");
test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("email@ecole.com").fill(email!);
  await page.getByPlaceholder("Votre mot de passe").fill(password!);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/platform/, { timeout: 60_000 });
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

async function realCoordinationStatuses(page: Page) {
  const token = await currentIdToken(page);
  const response = await page.request.get(
    `https://firestore.googleapis.com/v1/projects/${stagingProjectId}/databases/(default)/documents/coordinations?pageSize=300`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as { documents?: Array<{ fields?: { status?: { stringValue?: string } } }> };
  return (payload.documents ?? []).map((document) => document.fields?.status?.stringValue ?? "");
}

function dashboardCard(page: Page, title: string): Locator {
  return page.getByRole("heading", { name: title, exact: true }).locator("xpath=../../..");
}

test("compare la répartition des Coordinations à Firestore et conserve le responsive", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await login(page);

  const statuses = await realCoordinationStatuses(page);
  const expected = {
    Actives: statuses.filter((status) => status === "active").length,
    Inactives: statuses.filter((status) => status === "inactive").length,
    Archivées: statuses.filter((status) => status === "archived").length,
    Autres: statuses.filter((status) => !["active", "inactive", "archived"].includes(status)).length,
  };
  const schoolCard = dashboardCard(page, "Répartition des écoles par statut");
  const coordinationCard = dashboardCard(page, "Répartition des Coordinations par statut");
  await expect(coordinationCard).toContainText(`${statuses.length} Coordination(s)`);
  for (const [label, value] of Object.entries(expected)) {
    if (label === "Autres" && value === 0) {
      await expect(coordinationCard.getByText(label, { exact: true })).toHaveCount(0);
      continue;
    }
    const row = coordinationCard.getByText(label, { exact: true }).locator("..");
    await expect(row.getByText(String(value), { exact: true })).toBeVisible();
  }

  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(schoolCard).toBeVisible();
    await expect(coordinationCard).toBeVisible();
    const [schoolBox, coordinationBox] = await Promise.all([schoolCard.boundingBox(), coordinationCard.boundingBox()]);
    expect(schoolBox).not.toBeNull();
    expect(coordinationBox).not.toBeNull();
    for (const box of [schoolBox!, coordinationBox!]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(horizontalOverflow).toBe(false);
    if (width >= 1024) {
      expect(Math.abs(schoolBox!.y - coordinationBox!.y)).toBeLessThan(2);
      expect(coordinationBox!.x).toBeGreaterThan(schoolBox!.x);
    } else {
      expect(coordinationBox!.y).toBeGreaterThan(schoolBox!.y);
    }
  }
  expect(consoleErrors).toEqual([]);
});
